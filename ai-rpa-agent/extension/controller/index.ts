import type { AgentEvent, Intent, ScheduleResult } from "@ai-rpa/schemas";
import { ActionPlan, DomAction, LlmInterpretation, SERVICE_DISPLAY_NAMES, ClinicalService } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { newCorrelationId, nowIso } from "../shared/correlation.js";
import type { CarePlanPreview, MessageOf } from "../shared/messages.js";
import { decideAction } from "./decision.js";
import { planActions } from "./planner.js";
import { BackendClient } from "./backend-client.js";
import { attachContext } from "./context.js";
import { validateLlmOutput } from "./validate.js";
import { interpretUtterance } from "../llm/interpret.js";
import {
  preprocessAudio,
  transcribeAudio,
  normalizeUtterance,
  type NormalizedUtteranceEvent,
} from "../voice/index.js";
import type { TranscribedTextEvent } from "../voice/transcribe.js";
import type { VoiceCapturedEvent } from "../voice/recorder.js";
import {
  tryBuildScheduleRequestFromContext,
  DEFAULT_SCHEDULE_CONTEXT,
  type ValidatedScheduleContext,
} from "./schedule-request-from-context.js";
import {
  createCarePlan,
  confirmPlan,
  expandConfirmedPlan,
  confirmAndExpand,
  buildScheduleRequestFromSessions,
  commitScheduleResult,
  markSessionCompleted,
  getCarePlan,
  getNextPendingSession,
  getSessionsForPlan,
  getConfirmedCarePlans,
  getAllCarePlans,
  CarePlanDomainViolation,
} from "./care-plan-manager.js";

const log = createLogger("controller");
const backend = new BackendClient();

/** Mock UI dev server (Vite); must match `npm run dev` for mock-ui. */
const MOCK_SCHEDULE_PAGE_URL = "http://localhost:5173/schedule.html";
const SCHEDULE_INJECTION_SETTLE_MS = 1500;

async function navigateActiveTabToScheduleForInjection(correlationId: string): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    log.warn("navigate_schedule: no active tab", undefined, correlationId);
    return;
  }
  try {
    await chrome.tabs.update(activeTab.id, { url: MOCK_SCHEDULE_PAGE_URL });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SCHEDULE_INJECTION_SETTLE_MS);
    });
  } catch (err: unknown) {
    log.warn("navigate_schedule: tabs.update failed", String(err), correlationId);
  }
}

async function executeScheduleBackendAndInject(
  correlationId: string,
  intent: Extract<Intent, { kind: "schedule" }>,
): Promise<void> {
  await emit(makeEvent("schedule_requested", correlationId, { request: intent.request }));
  try {
    const result = await backend.schedule(intent.request, correlationId);
    if (result === null) {
      log.warn("schedule unavailable; skipping injection", undefined, correlationId);
      return;
    }
    await emit(makeEvent("schedule_generated", correlationId, { result }));
    await dispatchExecution(correlationId, intent, result);
  } catch (err: unknown) {
    log.error("schedule failed", String(err), correlationId);
  }
}

// Policy allowlists. Zod enforces structural shape (non-empty strings);
// these enums enforce the controller-side allowlist. Fill slot fields are
// validated against `context.availableFields` from live DOM discovery
// (`attachContext`). Keep navigate/status lists aligned with mock-ui `data-nav`
// / status entities.
const ALLOWED_NAV_TARGETS: ReadonlySet<string> = new Set([
  "assignments_stub",
  "diagnoses_stub",
  "diary",
  "digital_docs_stub",
  "epicrisis",
  "lab_results_stub",
  "patient_list",
  "primary_exam",
  "schedule",
  "specialist_exam",
]);
const ALLOWED_STATUS_ENTITIES: ReadonlySet<string> = new Set([
  "primary_exam",
  "epicrisis",
  "lfk",
  "massage",
  "psychologist",
  "speech_therapy",
]);
const ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "submitted",
  "final",
  "completed",
]);
/** Allowed clinical services for assign intents. */
const ALLOWED_ASSIGN_SERVICES: ReadonlySet<string> = new Set([
  "lfk",
  "massage",
  "psychologist",
  "speech_therapy",
  "physio",
]);

function checkIntentPolicy(
  intent: Intent,
  context?: ValidatedScheduleContext,
): string | null {
  if (intent.kind === "navigate") {
    if (!ALLOWED_NAV_TARGETS.has(intent.target)) {
      return `navigate_target:${intent.target}`;
    }
  }
  if (intent.kind === "set_status") {
    if (!ALLOWED_STATUS_ENTITIES.has(intent.entity)) {
      return `set_status_entity:${intent.entity}`;
    }
    if (!ALLOWED_STATUSES.has(intent.status)) {
      return `set_status_status:${intent.status}`;
    }
  }
  if (intent.kind === "fill") {
    const available = context?.availableFields?.map((f) => f.field) ?? [];
    if (available.length === 0) {
      return null;
    }
    const bad = intent.slots.find((s) => !available.includes(s.field));
    if (bad) {
      return `fill_field:${bad.field}`;
    }
  }
  if (intent.kind === "assign") {
    if (!ALLOWED_ASSIGN_SERVICES.has(intent.service)) {
      return `assign_service:${intent.service}`;
    }
  }
  return null;
}

interface PendingDecision {
  correlationId: string;
  interpretation: LlmInterpretation;
}

const pendingConfirmations = new Map<string, PendingDecision>();
/** Maps correlationId → carePlanId for assign confirmation flow. */
const pendingCarePlanIds = new Map<string, string>();

async function emit(event: AgentEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "event", event });
  } catch (err: unknown) {
    log.warn("emit failed", String(err), event.correlationId);
  }
}

// ------------------------------------------------------------------ //
// CarePlan → UI state projection                                     //
//                                                                    //
// The schedule page displays a *preview* of assignments (clinical    //
// decisions) independently from the calendar (execution). The        //
// projection below is the ONLY view that leaves the decision layer   //
// for rendering. It intentionally omits ids, timestamps, createdBy   //
// and any field that would mix the two concerns (UX rule).           //
// ------------------------------------------------------------------ //

// ------------------------------------------------------------------ //
// Human-readable confirmation summary                                 //
//                                                                    //
// Produces the *clinician-facing* text of a `user_confirmation_      //
// requested` event. Internal identifiers (intent.kind, decision      //
// reason codes like `high_risk_operation`, `low_confidence`) are     //
// never shown — they remain in audit logs only. Accept/reject button //
// labels are chosen by the sidepanel based on `intentKind`.          //
// ------------------------------------------------------------------ //
function pageRu(page: string): string {
  const map: Record<string, string> = {
    primary_exam: "Первичный осмотр",
    diary: "Дневник",
    schedule: "Расписание",
    care_plan: "План лечения",
    specialist_exam: "Осмотр специалиста",
    epicrisis: "Эпикриз",
    index: "Главная",
  };
  return map[page] ?? "страницу";
}

function totalSessionsInConfirmedPlans(): number {
  let total = 0;
  for (const p of getConfirmedCarePlans()) total += p.sessionsCount;
  return total;
}

function buildHumanConfirmSummary(intent: Intent): string {
  switch (intent.kind) {
    case "build_schedule": {
      const total = totalSessionsInConfirmedPlans();
      if (total > 0) {
        return `Построить расписание на ${total} ${pluralizeSessionsRu(total)}?`;
      }
      return "Построить расписание?";
    }
    case "schedule":
      return "Сформировать расписание?";
    case "navigate":
      return `Перейти в раздел «${pageRu(intent.target)}»?`;
    case "set_status":
      return "Изменить статус?";
    case "fill":
      return "Предпросмотр заполнения — подтвердите для сохранения";
    case "assign": {
      const serviceName =
        SERVICE_DISPLAY_NAMES[intent.service as ClinicalService] ?? intent.service;
      if (intent.type === "initial") return `Назначить первичный осмотр: ${serviceName}?`;
      // No silent default: if the LLM produced `course` without a
      // sessionsCount, upstream validation has already rejected the
      // intent, so we reach this branch only with a valid integer.
      const sessions = intent.sessionsCount;
      if (typeof sessions !== "number") {
        return `Назначить курс: ${serviceName}?`;
      }
      return `Назначить курс: ${serviceName} — ${sessions} ${pluralizeSessionsRu(sessions)}?`;
    }
    case "unknown":
    default:
      return "Подтвердить действие?";
  }
}

function pluralizeSessionsRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "занятие";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "занятия";
  return "занятий";
}

/** Snapshot of all current CarePlans projected for the schedule-page UI. */
export function getCarePlanPreviewSnapshot(): CarePlanPreview[] {
  return getAllCarePlans().map((plan) => ({
    service: plan.service as ClinicalService,
    sessionsCount: plan.sessionsCount,
    status: plan.status,
  }));
}

/**
 * Mock-ui host matches — must stay in sync with `manifest.json` content
 * script matches. Only tabs whose URL matches these patterns may receive
 * the care-plan preview broadcast.
 */
const CARE_PLAN_BROADCAST_TAB_URLS: ReadonlyArray<string> = [
  "http://localhost:5173/*",
];

/**
 * Broadcasts the current CarePlan preview to every tab where the content
 * script runs. This is the primary reactivity channel: any state change
 * (create / confirm / schedule-commit) fans out to all mock-ui tabs, so
 * a schedule page already open in another tab — or the current tab —
 * re-renders without a reload and without DOM parsing.
 *
 * Delivery is best-effort per tab: tabs without the content script loaded
 * (e.g. `chrome://` pages, or a tab just opening) fail the message send
 * silently; the page's own init request (`care_plan_state_request`) will
 * pick up state when the content script is ready.
 */
export async function broadcastCarePlanState(): Promise<void> {
  const plans = getCarePlanPreviewSnapshot();
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ url: CARE_PLAN_BROADCAST_TAB_URLS.slice() });
  } catch (err: unknown) {
    log.warn("care_plan broadcast query failed", String(err));
    return;
  }

  let delivered = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "care_plan_state", plans });
        delivered += 1;
      } catch {
        // Content script not ready on this tab — silently skip.
      }
    }),
  );

  log.info("care_plan_state_broadcast", {
    plansCount: plans.length,
    tabsTried: tabs.length,
    tabsDelivered: delivered,
  });
}

function makeEvent<T extends AgentEvent["type"]>(
  type: T,
  correlationId: string,
  payload: Extract<AgentEvent, { type: T }>["payload"],
): Extract<AgentEvent, { type: T }> {
  return {
    id: newCorrelationId(),
    type,
    correlationId,
    ts: new Date().toISOString(),
    payload,
  } as Extract<AgentEvent, { type: T }>;
}

async function dispatchExecution(correlationId: string, intent: Intent, scheduleResult?: ScheduleResult): Promise<void> {
  // `assign` is a state change, not an action. The planner/executor must
  // never observe it. If we reach here with `assign`, a caller violated
  // the controller contract — refuse loudly.
  if (intent.kind === "assign") {
    log.warn(
      "dispatch_execution_refused_for_assign",
      { note: "assign_is_state_change_not_action" },
      correlationId,
    );
    return;
  }

  const actions = planActions(intent, correlationId, scheduleResult);
  if (actions.length === 0) {
    log.warn("no actions planned", { intentKind: intent.kind }, correlationId);
    return;
  }

  // Runtime gate at the decision -> execution boundary. TypeScript types
  // alone do not protect the executor from malformed plans; an explicit
  // `ActionPlan.safeParse` ensures no unvalidated payload reaches the
  // content script via `chrome.tabs.sendMessage`.
  const plan = ActionPlan.safeParse({ correlationId, actions });
  if (!plan.success) {
    const issues = plan.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
    const errorToken = `action_plan_invalid:${issues.join(",") || "unknown"}`;
    log.error("action plan validation failed", { issues }, correlationId);
    for (const action of actions) {
      const single = DomAction.safeParse(action);
      if (single.success) {
        await emit(
          makeEvent("dom_action_failed", correlationId, {
            action: single.data,
            error: errorToken,
          }),
        );
      }
    }
    return;
  }

  if (intent.kind === "schedule" && scheduleResult !== undefined) {
    await navigateActiveTabToScheduleForInjection(correlationId);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    log.warn("no active tab", undefined, correlationId);
    return;
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: "execute_plan",
    correlationId: plan.data.correlationId,
    actions: plan.data.actions,
  });
}

async function readApiKey(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get("OPENAI_API_KEY");
    const key = stored["OPENAI_API_KEY"];
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch (err: unknown) {
    log.warn("storage read failed", String(err));
    return null;
  }
}

function truncateForEvent(raw: unknown): string | undefined {
  try {
    const s = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (typeof s !== "string") return undefined;
    return s.length > 10_000 ? s.slice(0, 10_000) : s;
  } catch {
    return undefined;
  }
}

async function runFromUtterance(
  correlationId: string,
  text: string,
  transcribedDurationMs = 0,
): Promise<void> {
  // Step 4 (utterance normalization) runs only here: voice STT and typed text
  // share this path via `user_utterance`. `normalizeUtterance`
  // expects a `TranscribedTextEvent` shim.
  const transcribedShim: TranscribedTextEvent = Object.freeze({
    type: "transcribed_text",
    correlationId,
    timestamp: nowIso(),
    text,
    durationMs: transcribedDurationMs,
  });

  let normalized: NormalizedUtteranceEvent;
  try {
    normalized = normalizeUtterance(transcribedShim);
  } catch (err: unknown) {
    const token =
      err instanceof Error && err.message.length > 0 ? err.message : "normalize_failed";
    log.error("normalize failed", token, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: [token],
      }),
    );
    return;
  }

  const contextualized = await attachContext(normalized);

  const apiKey = await readApiKey();
  if (!apiKey) {
    log.error("OPENAI_API_KEY missing in chrome.storage.local", undefined, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: ["llm_api_key_missing"],
      }),
    );
    return;
  }

  let raw: unknown;
  try {
    raw = await interpretUtterance(contextualized, { apiKey });
  } catch (err: unknown) {
    const token =
      err instanceof Error && err.message.length > 0 ? err.message : "llm_parse_error";
    log.error("llm interpret failed", token, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: [token],
      }),
    );
    return;
  }

  const validation = validateLlmOutput(raw, correlationId);
  if (!validation.ok) {
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: [validation.error],
        raw: truncateForEvent(raw),
      }),
    );
    return;
  }

  await runWithInterpretation(correlationId, validation.data, contextualized.context);
}

/**
 * Handle an `assign` intent. This is the ONLY code path that may consume
 * an AssignIntent after policy validation.
 *
 * Invariants enforced here:
 *   - Always creates a draft CarePlan and emits `care_plan_created`.
 *   - Always requests explicit user confirmation.
 *   - NEVER calls `planActions`, `dispatchExecution`,
 *     `executeScheduleBackendAndInject`, or `onBuildScheduleFromPlans`.
 *   - NEVER produces an `ActionPlan` or any `DomAction`.
 *   - A `reject` decision (unknown intent / low confidence) is honored
 *     as a hard stop — no CarePlan is created.
 */
async function handleAssignIntent(
  correlationId: string,
  interpretation: LlmInterpretation,
  intent: Extract<Intent, { kind: "assign" }>,
  decision: { kind: "execute" | "confirm" | "reject"; reason: string; confidence: number },
  scheduleContext?: ValidatedScheduleContext,
): Promise<void> {
  log.info(
    "assign_intent_received",
    {
      service: intent.service,
      type: intent.type,
      sessionsCount: intent.sessionsCount,
      decision: decision.kind,
      note: "clinical_decision_state_change_only",
    },
    correlationId,
  );

  await emit(
    makeEvent("decision_made", correlationId, {
      decision: decision.kind,
      confidence: decision.confidence,
      reason: decision.reason,
    }),
  );

  // A `reject` decision is a hard stop: do NOT create or persist a
  // CarePlan. Low confidence / unknown intents must never mutate state.
  if (decision.kind === "reject") {
    log.info("assign_rejected", { reason: decision.reason }, correlationId);
    return;
  }

  const patientId = scheduleContext?.patientId ?? "MOCK-PED-INPT-001";

  let plan;
  try {
    plan = createCarePlan(intent, patientId, "doctor");
  } catch (err: unknown) {
    // Domain violations (missing sessionsCount, > MAX_COURSE_DAYS) MUST
    // NOT mutate state. Emit a validation_failed event using a stable
    // code token; the sidepanel translates it to Russian for the
    // clinician. No CarePlan, no planner, no scheduler.
    if (err instanceof CarePlanDomainViolation) {
      log.warn(
        "assign_rejected_domain_violation",
        { code: err.code, sessionsCount: err.sessionsCount },
        correlationId,
      );
      await emit(
        makeEvent("validation_failed", correlationId, {
          errors: [err.code],
        }),
      );
      return;
    }
    throw err;
  }

  await emit(
    makeEvent("care_plan_created", correlationId, {
      planId: plan.id,
      service: plan.service as ClinicalService,
      type: plan.type,
      sessionsCount: plan.sessionsCount,
      durationMinutes: plan.durationMinutes,
      status: plan.status,
      patientId: plan.patientId,
    }),
  );

  // Fire-and-forget: schedule page (if open) refreshes its assignments
  // block. No DOM mutation happens here — state is pushed as data only.
  void broadcastCarePlanState();

  const serviceName =
    SERVICE_DISPLAY_NAMES[intent.service as ClinicalService] ?? intent.service;
  const summary =
    intent.type === "initial"
      ? `Назначен первичный осмотр: ${serviceName}`
      : `Назначен курс: ${serviceName} \u2014 ${plan.sessionsCount} занятий по ${plan.durationMinutes} мин`;

  pendingConfirmations.set(correlationId, { correlationId, interpretation });
  pendingCarePlanIds.set(correlationId, plan.id);

  await emit(
    makeEvent("user_confirmation_requested", correlationId, {
      summary,
      intentKind: "assign",
    }),
  );

  // STOP. No planner. No executor. No scheduler. No ActionPlan.
}

async function runWithInterpretation(
  correlationId: string,
  interpretation: LlmInterpretation,
  scheduleContext?: ValidatedScheduleContext,
): Promise<void> {
  const { intent } = interpretation;

  // Fallback: LLM truthfully reports it cannot construct a ScheduleRequest
  // (per SCHEDULING AUTHORITY in the prompt). The controller — the only
  // layer allowed to build `ScheduleRequest` — deterministically assembles
  // it from validated session/UI context, then re-enters the normal
  // schedule pipeline (decision gate → backend → executor). The LLM never
  // sees or constructs the request.
  if (
    intent.kind === "unknown" &&
    intent.reason === "schedule_context_required" &&
    scheduleContext !== undefined
  ) {
    const built = tryBuildScheduleRequestFromContext(scheduleContext, {
      rationale: interpretation.rationale,
    });
    if (!built.ok) {
      log.warn(
        "schedule_context_fallback_build_failed",
        { error: built.error },
        correlationId,
      );
      await emit(
        makeEvent("validation_failed", correlationId, {
          errors: [built.error],
        }),
      );
      return;
    }

    const rebuilt = LlmInterpretation.safeParse({
      schemaVersion: "1.0.0",
      intent: { kind: "schedule", request: built.request },
      confidence: 1,
    });
    if (!rebuilt.success) {
      const issues = rebuilt.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
      await emit(
        makeEvent("validation_failed", correlationId, {
          errors: issues.length > 0 ? issues : ["interpretation_parse_failed"],
        }),
      );
      return;
    }

    log.info(
      "schedule_context_fallback",
      { reason: "schedule_context_required" },
      correlationId,
    );

    await runWithInterpretation(correlationId, rebuilt.data, scheduleContext);
    return;
  }

  const policyError = checkIntentPolicy(intent, scheduleContext);
  if (policyError) {
    log.warn("intent rejected by policy", { policyError, intentKind: intent.kind }, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: ["out_of_policy_value", policyError],
      }),
    );
    return;
  }

  await emit(makeEvent("intent_parsed", correlationId, { interpretation }));
  await emit(makeEvent("validation_passed", correlationId, { schemaVersion: interpretation.schemaVersion }));

  const decision = decideAction(interpretation, correlationId);

  // ---------------------------------------------------------------- //
  // STRICT BOUNDARY: `assign` is a CLINICAL DECISION (state change), //
  // NEVER an executable action.                                      //
  //                                                                  //
  //   - MUST NOT call planner / executor / scheduler                 //
  //   - MUST NOT produce an ActionPlan or any DomAction              //
  //   - MUST NOT trigger schedule generation                         //
  //                                                                  //
  // All assign intents are routed through the CarePlan preview →     //
  // user confirmation flow. A separate `build_schedule` intent (the  //
  // planning layer) is the only path to scheduling.                  //
  // ---------------------------------------------------------------- //
  if (intent.kind === "assign") {
    await handleAssignIntent(correlationId, interpretation, intent, decision, scheduleContext);
    return;
  }

  log.info(
    "step9_decision",
    {
      kind: decision.kind,
      reason: decision.reason,
      confidence: decision.confidence,
      source: "step9_decision",
    },
    correlationId,
  );

  await emit(
    makeEvent("decision_made", correlationId, {
      decision: decision.kind,
      confidence: decision.confidence,
      reason: decision.reason,
    }),
  );

  if (decision.kind === "reject") {
    log.info("rejected", { reason: decision.reason }, correlationId);
    return;
  }

  if (decision.kind === "confirm") {
    pendingConfirmations.set(correlationId, { correlationId, interpretation });

    // Build draft preview payload for fill intents
    const draftFields =
      intent.kind === "fill"
        ? intent.slots.map((s) => ({
            field: s.field,
            label: s.field.replace(/_/g, " "),
            value: String(s.value),
          }))
        : undefined;

    // ── UX RULE ───────────────────────────────────────────────────────── //
    // The clinician never sees internal pipeline vocabulary: no intent     //
    // kind strings (`build_schedule`, `fill` …), no decision reason codes  //
    // (`high_risk_operation`, `low_confidence` …). We compose a Russian    //
    // human summary here; risk/confidence stays in logs only.              //
    // ──────────────────────────────────────────────────────────────────── //
    const summary = buildHumanConfirmSummary(intent);
    await emit(
      makeEvent("user_confirmation_requested", correlationId, {
        summary,
        intentKind: intent.kind,
        ...(draftFields ? { draftFields } : {}),
      }),
    );
    return;
  }

  // DRAFT PREVIEW GATE: fill intents ALWAYS require clinician approval,
  // even when the decision gate says "execute". This ensures no generated
  // content reaches the host DOM without human confirmation.
  if (intent.kind === "fill") {
    pendingConfirmations.set(correlationId, { correlationId, interpretation });
    const draftFields = intent.slots.map((s) => ({
      field: s.field,
      label: s.field.replace(/_/g, " "),
      value: String(s.value),
    }));
    await emit(
      makeEvent("user_confirmation_requested", correlationId, {
        summary: "Предпросмотр заполнения — подтвердите для сохранения",
        draftFields,
        intentKind: "fill",
      }),
    );
    return;
  }

  if (intent.kind === "schedule") {
    await executeScheduleBackendAndInject(correlationId, intent);
    return;
  }

  if (intent.kind === "build_schedule") {
    await controller.onBuildScheduleFromPlans(correlationId);
    return;
  }

  await dispatchExecution(correlationId, intent);
}

function voiceMessageToCapture(
  correlationId: string,
  audio: MessageOf<"voice_captured">["audio"],
): VoiceCapturedEvent {
  return Object.freeze({
    type: "voice_captured",
    timestamp: Date.now(),
    correlationId,
    audioBlob: new Blob([audio.data], { type: audio.mimeType }),
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
  });
}

/** Rebuild binary audio from base64 (MV3 message clone can corrupt `ArrayBuffer` payloads). */
function base64ToAudioBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i += 1) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType || "audio/webm;codecs=opus" });
}

function voiceCapturedMessageToEvent(
  msg: MessageOf<"voice_captured">,
  correlationId: string,
): VoiceCapturedEvent {
  const mime = typeof msg.mimeType === "string" && msg.mimeType.length > 0 ? msg.mimeType : msg.audio.mimeType;
  if (typeof msg.base64 === "string" && msg.base64.length > 0) {
    return Object.freeze({
      type: "voice_captured",
      timestamp: Date.now(),
      correlationId,
      audioBlob: base64ToAudioBlob(msg.base64, mime),
      mimeType: mime,
      durationMs: msg.audio.durationMs,
    });
  }
  return voiceMessageToCapture(correlationId, msg.audio);
}

export const controller = {
  async onInput(msg: MessageOf<"voice_captured"> | MessageOf<"user_utterance">): Promise<unknown> {
    const { correlationId } = msg;

    if (msg.type === "voice_captured") {
      await emit(
        makeEvent("voice_captured", correlationId, {
          durationMs: msg.audio.durationMs,
          mimeType: msg.audio.mimeType,
          sizeBytes: msg.audio.sizeBytes,
        }),
      );
      log.info("input received", { type: msg.type }, correlationId);

      const apiKey = await readApiKey();
      if (!apiKey) {
        return {
          accepted: false,
          step: "config" as const,
          error:
            "OPENAI_API_KEY missing in chrome.storage.local; run chrome.storage.local.set({ OPENAI_API_KEY: 'sk-...' })",
        };
      }

      const capture = voiceCapturedMessageToEvent(msg, correlationId);

      let preprocessed;
      try {
        preprocessed = await preprocessAudio(capture);
      } catch (err: unknown) {
        log.error("audio preprocess failed", String(err), correlationId);
        return { accepted: false, step: "preprocess" as const, error: String(err) };
      }

      let transcribed;
      try {
        transcribed = await transcribeAudio(preprocessed, { apiKey });
      } catch (err: unknown) {
        log.error("transcription failed", String(err), correlationId);
        return { accepted: false, step: "transcribe" as const, error: String(err) };
      }

      return { accepted: true, text: transcribed.text, durationMs: transcribed.durationMs };
    }

    log.info("input received", { type: msg.type, chars: msg.text.length }, correlationId);
    try {
      await runFromUtterance(correlationId, msg.text, msg.transcribedDurationMs ?? 0);
    } catch (err: unknown) {
      log.error("pipeline failed", String(err), correlationId);
    }
    return { accepted: true };
  },

  async onInterpretation(msg: MessageOf<"llm_interpretation">): Promise<unknown> {
    await runWithInterpretation(msg.correlationId, msg.interpretation);
    return { accepted: true };
  },

  /**
   * Proactive UI path: CP-SAT from {@link DEFAULT_SCHEDULE_CONTEXT} without voice/LLM.
   */
  async autoGenerateSchedule(correlationId: string): Promise<{ ok: boolean; error?: string }> {
    return controller.onScheduleFromContext({
      type: "schedule_from_context",
      correlationId,
      context: DEFAULT_SCHEDULE_CONTEXT,
    });
  },

  /**
   * System path: validated UI/session context → deterministic `ScheduleRequest`
   * → same decision + backend + executor chain as LLM-produced schedule intents.
   */
  async onScheduleFromContext(
    msg: MessageOf<"schedule_from_context">,
  ): Promise<{ ok: boolean; error?: string }> {
    const scheduleCtx: ValidatedScheduleContext = {
      ...msg.context,
      availableFields: msg.context.availableFields ?? [],
    };
    const built = tryBuildScheduleRequestFromContext(scheduleCtx, msg.build);
    if (!built.ok) {
      await emit(
        makeEvent("validation_failed", msg.correlationId, {
          errors: [built.error],
        }),
      );
      return { ok: false, error: built.error };
    }

    const interpretation = LlmInterpretation.safeParse({
      schemaVersion: "1.0.0",
      intent: { kind: "schedule", request: built.request },
      confidence: 1,
    });

    if (!interpretation.success) {
      const issues = interpretation.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
      await emit(
        makeEvent("validation_failed", msg.correlationId, {
          errors: issues.length > 0 ? issues : ["interpretation_parse_failed"],
        }),
      );
      return { ok: false, error: "interpretation_parse_failed" };
    }

    try {
      const interp = interpretation.data;
      await emit(makeEvent("intent_parsed", msg.correlationId, { interpretation: interp }));
      await emit(
        makeEvent("validation_passed", msg.correlationId, { schemaVersion: interp.schemaVersion }),
      );
      await emit(
        makeEvent("decision_made", msg.correlationId, {
          decision: "execute",
          confidence: interp.confidence,
          reason: "schedule_from_context",
        }),
      );
      await executeScheduleBackendAndInject(
        msg.correlationId,
        interp.intent as Extract<Intent, { kind: "schedule" }>,
      );
    } catch (err: unknown) {
      log.error("schedule_from_context pipeline failed", String(err), msg.correlationId);
      return { ok: false, error: String(err) };
    }
    return { ok: true };
  },

  async onUserConfirmation(msg: MessageOf<"user_confirmation">): Promise<unknown> {
    await emit(
      makeEvent("user_confirmation_received", msg.correlationId, {
        accepted: msg.accepted,
      }),
    );
    const pending = pendingConfirmations.get(msg.correlationId);
    pendingConfirmations.delete(msg.correlationId);

    // Check for CarePlan confirmation flow
    const planId = pendingCarePlanIds.get(msg.correlationId);
    pendingCarePlanIds.delete(msg.correlationId);

    if (!pending || !msg.accepted) return { executed: false };

    const { intent } = pending.interpretation;

    // ASSIGN: doctor confirmed the CLINICAL DECISION.
    //
    // STRICT: persist the CarePlan and STOP. No planner, no executor,
    // no scheduler, no ActionPlan, no DomAction, no schedule request.
    // Scheduling is a separate `build_schedule` intent.
    if (intent.kind === "assign" && planId) {
      const confirmed = confirmPlan(planId);
      if (!confirmed) {
        return { ok: false, error: "care_plan_confirm_failed" };
      }

      await emit(
        makeEvent("care_plan_confirmed", msg.correlationId, {
          planId: confirmed.id,
          service: confirmed.service as ClinicalService,
          type: confirmed.type,
          sessionsCount: confirmed.sessionsCount,
          durationMinutes: confirmed.durationMinutes,
          status: confirmed.status,
          patientId: confirmed.patientId,
        }),
      );

      void broadcastCarePlanState();

      log.info("assign_confirmed_no_schedule", {
        planId: confirmed.id,
        service: confirmed.service,
        sessionsCount: confirmed.sessionsCount,
        note: "state_change_only_no_execution",
      }, msg.correlationId);

      // STOP HERE. No scheduling. No expansion. No calendar entries.
      return { executed: true, planId: confirmed.id };
    }

    // Defense-in-depth: an `assign` intent must NEVER reach the executor
    // or scheduler, even if the CarePlan bookkeeping above failed.
    if (intent.kind === "assign") {
      log.warn(
        "assign_confirmation_without_plan_id",
        { note: "refusing_to_execute_assign_intent" },
        msg.correlationId,
      );
      return { executed: false, error: "assign_missing_plan_id" };
    }

    if (intent.kind === "schedule") {
      await executeScheduleBackendAndInject(msg.correlationId, intent);
    } else {
      await dispatchExecution(msg.correlationId, intent);
    }
    return { executed: true };
  },

  /**
   * CarePlan expansion + scheduling pipeline.
   * Called ONLY from build_schedule flow — NEVER from assign.
   *
   * Flow: find confirmed plans → expand → build request → CP-SAT → inject
   */
  async executeCarePlanScheduling(
    correlationId: string,
    planId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const plan = getCarePlan(planId);
    if (!plan) {
      return { ok: false, error: "care_plan_not_found" };
    }

    // Step 1: Expand confirmed plan into sessions
    const sessions = expandConfirmedPlan(planId);
    if (sessions.length === 0) {
      // Fallback for draft plans (backward compat)
      const fallback = confirmAndExpand(planId);
      if (fallback.length === 0) {
        return { ok: false, error: "care_plan_expansion_failed" };
      }
      return controller.executeCarePlanScheduling(correlationId, planId);
    }

    // Step 2: Emit expansion event
    await emit(
      makeEvent("care_plan_expanded", correlationId, {
        planId,
        sessionsCount: sessions.length,
        service: plan.service as ClinicalService,
      }),
    );

    // Step 3: Build schedule request from sessions
    const scheduleRequest = buildScheduleRequestFromSessions(sessions, plan);

    // Step 4: Send to CP-SAT backend
    await emit(
      makeEvent("schedule_requested", correlationId, {
        request: scheduleRequest,
      }),
    );

    try {
      const result = await backend.schedule(scheduleRequest, correlationId);
      if (result === null) {
        log.warn("care_plan schedule unavailable", undefined, correlationId);
        return { ok: false, error: "schedule_backend_unavailable" };
      }

      // Step 5: Commit results to care plan manager
      commitScheduleResult(planId, result.assignments);

      // Propagate status flip (confirmed → scheduled) to the schedule
      // page via explicit state push (not DOM parsing).
      void broadcastCarePlanState();

      // Step 6: Emit schedule generated
      await emit(makeEvent("schedule_generated", correlationId, { result }));

      // Step 7: Navigate to schedule page and inject
      const scheduleIntent: Extract<Intent, { kind: "schedule" }> = {
        kind: "schedule",
        request: scheduleRequest,
      };
      await dispatchExecution(correlationId, scheduleIntent, result);

      return { ok: true };
    } catch (err: unknown) {
      log.error("care_plan scheduling failed", String(err), correlationId);
      return { ok: false, error: String(err) };
    }
  },

  /**
   * Entry point for build_schedule: finds all confirmed CarePlans,
   * expands and schedules them. Called from:
   * - build_schedule intent (voice: "составь расписание")
   * - "Сформировать расписание" button in sidepanel
   */
  async onBuildScheduleFromPlans(
    correlationId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const confirmed = getConfirmedCarePlans();
    if (confirmed.length === 0) {
      log.warn("build_schedule: no confirmed plans", undefined, correlationId);
      return { ok: false, error: "no_confirmed_plans" };
    }

    log.info("build_schedule: scheduling confirmed plans", {
      count: confirmed.length,
      services: confirmed.map((p) => p.service),
    }, correlationId);

    // Schedule each confirmed plan
    let lastResult: { ok: boolean; error?: string } = { ok: false };
    for (const plan of confirmed) {
      lastResult = await controller.executeCarePlanScheduling(correlationId, plan.id);
      if (!lastResult.ok) {
        log.warn("build_schedule: plan failed", {
          planId: plan.id,
          error: lastResult.error,
        }, correlationId);
      }
    }

    return lastResult;
  },

  /**
   * Marks a session as completed (specialist daily workflow).
   * Service can be inferred from context or explicitly provided.
   */
  async onSessionComplete(msg: {
    correlationId: string;
    sessionId?: string;
    service?: ClinicalService;
    diaryNote?: string;
  }): Promise<{ ok: boolean; sessionId?: string }> {
    let sessionId = msg.sessionId;

    // If no explicit sessionId, find the next pending session for this service
    if (!sessionId) {
      const next = getNextPendingSession(msg.service);
      if (!next) {
        log.warn("no pending session found", { service: msg.service }, msg.correlationId);
        return { ok: false };
      }
      sessionId = next.id;
    }

    const session = markSessionCompleted(sessionId, msg.diaryNote);
    if (!session) {
      return { ok: false };
    }

    const plan = getCarePlan(session.carePlanId);
    const totalSessions = plan ? getSessionsForPlan(session.carePlanId).length : 1;

    await emit(
      makeEvent("session_completed", msg.correlationId, {
        sessionId: session.id,
        carePlanId: session.carePlanId,
        service: session.service as ClinicalService,
        sessionNumber: session.sessionNumber,
        totalSessions,
        status: session.status,
        diaryNote: session.diaryNote,
      }),
    );

    return { ok: true, sessionId: session.id };
  },

  async onExecutorFinished(msg: MessageOf<"executor_finished">): Promise<unknown> {
    for (const action of msg.result.executed) {
      await emit(makeEvent("dom_action_executed", msg.correlationId, { action, result: msg.result }));
    }
    for (const { action, error } of msg.result.failed) {
      await emit(makeEvent("dom_action_failed", msg.correlationId, { action, error }));
    }
    return { recorded: true };
  },
};
