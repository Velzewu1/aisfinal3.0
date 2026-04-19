import { ContentTabVoiceRecorder } from "../voice/index.js";
import type { VoiceCapturedEvent } from "../voice/index.js";
import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";
import {
  afterPrimaryExamFillExecuted,
  clearPrimaryExamFillProgressOnAgentNavigate,
  onContextAttachedForExamProgress,
  suggestNext,
  SUGGESTION_TEXT,
  type ProactiveSuggestion,
} from "../controller/proactivity.js";
import type { AgentEvent, IntentKind, LlmInterpretation } from "@ai-rpa/schemas";
import {
  parseFile,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_SESSION,
  ACCEPTED_MIME_TYPES,
} from "../knowledge/file-parser.js";

const log = createLogger("sidepanel");
const recorder = new ContentTabVoiceRecorder();
let lastCorrelationId: string | null = null;

type AssistantMode = "inactive" | "listening" | "processing";
let assistantMode: AssistantMode = "inactive";
let processingSegmentCount = 0;

const timelineEl = document.getElementById("timeline") as HTMLDivElement | null;
const timelineEmptyEl = document.getElementById("timelineEmpty") as HTMLDivElement | null;
const recordBtn = document.getElementById("record") as HTMLButtonElement | null;
const sendBtn = document.getElementById("send") as HTMLButtonElement | null;
const utterEl = document.getElementById("utter") as HTMLInputElement | null;
const acceptBtn = document.getElementById("accept") as HTMLButtonElement | null;
const rejectBtn = document.getElementById("reject") as HTMLButtonElement | null;
const proactiveCardEl = document.getElementById("proactiveCard") as HTMLElement | null;
const proactiveTextEl = document.getElementById("proactiveText") as HTMLParagraphElement | null;
const proactiveIconEl = document.getElementById("proactiveIcon") as HTMLDivElement | null;
const confidenceBarEl = document.getElementById("confidenceBar") as HTMLElement | null;
const confidenceBadgeEl = document.getElementById("confidenceBadge") as HTMLSpanElement | null;
const confidencePercentEl = document.getElementById("confidencePercent") as HTMLSpanElement | null;
const statusDotEl = document.getElementById("statusDot") as HTMLSpanElement | null;
const statusLabelEl = document.getElementById("statusLabel") as HTMLSpanElement | null;
const waveformEl = document.getElementById("waveform") as HTMLDivElement | null;
const pttLabelEl = document.getElementById("pttLabel") as HTMLParagraphElement | null;
const scheduleCardEl = document.getElementById("scheduleCard") as HTMLElement | null;
const scheduleCardTitleEl = document.getElementById("scheduleCardTitle") as HTMLDivElement | null;
const scheduleCardStatusEl = document.getElementById("scheduleCardStatus") as HTMLSpanElement | null;
const scheduleCountEl = document.getElementById("scheduleCount") as HTMLSpanElement | null;
const scheduleSpecialistsCountEl = document.getElementById("scheduleSpecialists") as HTMLSpanElement | null;
const scheduleDaysValueEl = document.getElementById("scheduleDaysValue") as HTMLSpanElement | null;
const scheduleProceduresValueEl = document.getElementById("scheduleProceduresValue") as HTMLSpanElement | null;
const scheduleSpecialistsValueEl = document.getElementById("scheduleSpecialistsValue") as HTMLSpanElement | null;
const openScheduleBtn = document.getElementById("openSchedule") as HTMLButtonElement | null;
const scheduleDismissBtn = document.getElementById("scheduleDismiss") as HTMLButtonElement | null;

// Draft preview elements
const draftPreviewEl = document.getElementById("draftPreview") as HTMLElement | null;
const draftPreviewTitleEl = document.getElementById("draftPreviewTitle") as HTMLDivElement | null;
const draftPreviewFieldsEl = document.getElementById("draftPreviewFields") as HTMLDivElement | null;
const draftApproveBtn = document.getElementById("draftApprove") as HTMLButtonElement | null;
const draftRejectBtn = document.getElementById("draftReject") as HTMLButtonElement | null;

type DotKind = "success" | "info" | "warning" | "error";

type CardState =
  | { mode: "hidden" }
  | { mode: "confirm"; correlationId: string; message: string }
  | { mode: "suggest"; suggestion: ProactiveSuggestion; message: string };

let cardState: CardState = { mode: "hidden" };

let headerAsyncOps = 0;
let activeConfirmationId: string | null = null;

const interpretationByCorrelation = new Map<string, LlmInterpretation>();

/** Latest page from `context_attached` (Step 5); used for primary-exam fill hints. */
let lastAttachedContextPage = "primary_exam";

const SUGGESTION_ACCEPT_UTTERANCE: Readonly<Record<ProactiveSuggestion, string>> = Object.freeze({
  suggest_schedule: "Да, сформируйте расписание.",
  suggest_exam_progress: "",
  suggest_next_form: "Да, заполните форму голосом.",
  suggest_finish_visit: "Да, завершите визит.",
  suggest_assign_course: "Да, назначьте курс лечения.",
  suggest_build_schedule: "Да, сформируйте расписание.",
});

type VoicePipelineResult =
  | { accepted: true; text: string; durationMs: number }
  | {
      accepted: false;
      step?: "config" | "preprocess" | "transcribe";
      error: string;
    };

function intentKindRu(kind: IntentKind): string {
  const labels: Record<IntentKind, string> = {
    assign: "НАЗНАЧЕНИЕ",
    build_schedule: "РАСПИСАНИЕ",
    fill: "ЗАПОЛНЕНИЕ",
    navigate: "НАВИГАЦИЯ",
    schedule: "РАСПИСАНИЕ",
    set_status: "СТАТУС",
    unknown: "НЕИЗВЕСТНО",
  };
  return labels[kind];
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function refreshTimelineEmpty(): void {
  if (!timelineEl || !timelineEmptyEl) return;
  const hasItems = timelineEl.children.length > 0;
  timelineEmptyEl.classList.toggle("hidden", hasItems);
}

function pushTimelineRow(dot: DotKind, title: string, description: string, timeLabel: string): void {
  if (!timelineEl) return;
  const item = document.createElement("div");
  item.className = "timeline-item";

  const dotEl = document.createElement("div");
  dotEl.className = `timeline-dot ${dot}`;

  const body = document.createElement("div");
  body.className = "timeline-body";

  const typeEl = document.createElement("div");
  typeEl.className = "timeline-type";
  typeEl.textContent = title;

  const timeEl = document.createElement("div");
  timeEl.className = "timeline-time";
  timeEl.textContent = timeLabel;

  const descEl = document.createElement("div");
  descEl.className = "timeline-desc";
  descEl.textContent = description;

  body.append(typeEl, timeEl, descEl);
  item.append(dotEl, body);
  timelineEl.prepend(item);

  while (timelineEl.children.length > 50) {
    timelineEl.lastElementChild?.remove();
  }
  refreshTimelineEmpty();
}

function pushLocalTimeline(dot: DotKind, title: string, description: string): void {
  const timeLabel = new Date().toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  pushTimelineRow(dot, title, description, timeLabel);
}

function describeAgentEvent(ev: AgentEvent): { dot: DotKind; title: string; description: string } {
  switch (ev.type) {
    case "voice_captured":
      return {
        dot: "info",
        title: "Голос",
        description: `${ev.payload.durationMs} мс · ${(ev.payload.sizeBytes / 1024).toFixed(1)} КБ`,
      };
    case "audio_preprocessed":
      return {
        dot: "info",
        title: "Предобработка",
        description: `${ev.payload.durationMs} мс`,
      };
    case "speech_to_text_completed":
    case "text_transcribed":
      return {
        dot: "info",
        title: "Транскрипция",
        description: `${ev.payload.chars} симв. · ${ev.payload.durationMs} мс`,
      };
    case "utterance_normalized":
    case "text_normalized":
      return {
        dot: "info",
        title: "Нормализация",
        description: `${ev.payload.normalizedChars} симв.`,
      };
    case "context_attached": {
      const parts = [];
      if (ev.payload.activeForm) parts.push(`${ev.payload.currentPage} · ${ev.payload.activeForm}`);
      else parts.push(ev.payload.currentPage);
      
      if (ev.payload.reusableAssetsUsed && ev.payload.reusableAssetsUsed.length > 0) {
        parts.push(`Шаблоны: ${ev.payload.reusableAssetsUsed.join(", ")}`);
      }
      
      return {
        dot: "info",
        title: "Контекст",
        description: parts.join(" | "),
      };
    }
    case "intent_parsed":
      return {
        dot: "info",
        title: "Интент",
        description: intentKindRu(ev.payload.interpretation.intent.kind),
      };
    case "validation_passed":
      return {
        dot: "success",
        title: "Валидация",
        description: `Схема ${ev.payload.schemaVersion}`,
      };
    case "validation_failed": {
      const errors = ev.payload.errors.slice(0, 3);
      // Translate machine tokens to human-readable Russian for demo
      const humanErrors = errors.map((e) => {
        if (e === "llm_api_key_missing") return "API-ключ не установлен";
        if (e === "llm_network_error") return "Сеть: нет связи с LLM";
        if (e === "llm_http_error") return "LLM вернул ошибку";
        if (e === "llm_empty_response") return "LLM: пустой ответ";
        if (e === "llm_invalid_json") return "LLM: невалидный JSON";
        if (e === "llm_parse_error") return "LLM: ошибка разбора";
        if (e.startsWith("out_of_policy_value")) return "Вне политики безопасности";
        if (e === "normalize_failed") return "Ошибка нормализации текста";
        if (e === "field_not_on_current_page") return "Поле не найдено на странице";
        return e;
      });
      return {
        dot: "error",
        title: "Ошибка",
        description: humanErrors.join("; "),
      };
    }
    case "confidence_evaluated": {
      const pct = Math.round(ev.payload.score * 100);
      return {
        dot: ev.payload.level === "low" ? "warning" : "info",
        title: "Уверенность",
        description: `${pct}% · ${ev.payload.requiresConfirmation ? "нужно подтверждение" : "авто"}`,
      };
    }
    case "decision_made": {
      const decisionLabel = ev.payload.decision === "execute"
        ? "Авто-выполнение"
        : ev.payload.decision === "confirm"
          ? "Требует подтверждения"
          : "Отклонено";
      const riskNote = ev.payload.reason === "high_risk_operation"
        ? " (высокий риск)"
        : ev.payload.reason === "auto_execute"
          ? " (низкий риск)"
          : "";
      return {
        dot: ev.payload.decision === "execute" ? "success" : ev.payload.decision === "confirm" ? "warning" : "error",
        title: "Решение",
        description: `${decisionLabel}${riskNote} · ${Math.round(ev.payload.confidence * 100)}%`,
      };
    }
    case "action_plan_created":
      return {
        dot: "info",
        title: "План",
        description: `${ev.payload.intentKind}: ${ev.payload.actionCount} действий`,
      };
    case "dom_action_executed":
      return {
        dot: "success",
        title: "Применено",
        description: ev.payload.action.kind === "fill" ? ev.payload.action.field : ev.payload.action.kind,
      };
    case "dom_action_failed":
      return {
        dot: "error",
        title: "Не заполнено",
        description: ev.payload.action && ev.payload.action.kind === "fill" 
          ? `Отсутствует поле: ${ev.payload.action.field}`
          : ev.payload.error,
      };
    case "schedule_requested":
      return {
        dot: "info",
        title: "Расписание",
        description: "Запрос отправлен",
      };
    case "schedule_generated":
      return {
        dot: "success",
        title: "Расписание",
        description: "Сформировано",
      };
    case "user_confirmation_requested":
      return {
        dot: "warning",
        title: "Подтверждение",
        description: ev.payload.summary,
      };
    case "user_confirmation_received":
      return {
        dot: ev.payload.accepted ? "success" : "warning",
        title: "Ответ врача",
        description: ev.payload.accepted ? "Подтверждено" : "Отклонено",
      };
    case "care_plan_created":
      return {
        dot: "info",
        title: "📋 Назначение",
        description: ev.payload.type === "initial"
          ? `Первичный осмотр: ${ev.payload.service}`
          : `Курс: ${ev.payload.service} — ${ev.payload.sessionsCount} сеансов`,
      };
    case "care_plan_confirmed":
      return {
        dot: "success",
        title: "📋 Назначение подтверждено",
        description: ev.payload.type === "initial"
          ? `Первичный осмотр: ${ev.payload.service}`
          : `Курс: ${ev.payload.service} — ${ev.payload.sessionsCount} сеансов`,
      };
    case "care_plan_expanded":
      return {
        dot: "success",
        title: "📋 План лечения",
        description: `${ev.payload.sessionsCount} сеансов создано`,
      };
    case "session_completed":
      return {
        dot: "success",
        title: "✅ Сеанс",
        description: `${ev.payload.service} — ${ev.payload.sessionNumber}/${ev.payload.totalSessions}`,
      };
    default: {
      const _exhaustive: never = ev;
      void _exhaustive;
      return { dot: "info", title: "Событие", description: "—" };
    }
  }
}

function appendAgentTimeline(ev: AgentEvent): void {
  const { dot, title, description } = describeAgentEvent(ev);
  pushTimelineRow(dot, title, description, formatTime(ev.ts));
}

function updateHeaderState(): void {
  const busy = assistantMode !== "inactive" || headerAsyncOps > 0;
  if (statusDotEl) {
    statusDotEl.classList.toggle("ready", !busy);
    statusDotEl.classList.toggle("processing", busy);
  }
  if (statusLabelEl) {
    statusLabelEl.textContent = busy ? "Обработка" : "Готов";
  }
}

function renderAssistantMode(): void {
  if (!recordBtn) return;
  recordBtn.classList.remove("is-inactive", "is-listening", "is-processing");

  let label: string;
  switch (assistantMode) {
    case "listening":
      recordBtn.classList.add("is-listening");
      recordBtn.setAttribute("aria-pressed", "true");
      label = "Ассистент активен — говорите";
      break;
    case "processing":
      recordBtn.classList.add("is-processing");
      recordBtn.setAttribute("aria-pressed", "true");
      label = "Обрабатываю…";
      break;
    case "inactive":
    default:
      recordBtn.classList.add("is-inactive");
      recordBtn.setAttribute("aria-pressed", "false");
      label = "Активировать ассистента";
      break;
  }

  waveformEl?.classList.toggle("active", assistantMode === "listening");
  if (pttLabelEl) {
    pttLabelEl.textContent = label;
    pttLabelEl.classList.toggle("recording", assistantMode === "listening");
    pttLabelEl.classList.toggle("processing", assistantMode === "processing");
  }
  updateHeaderState();
}

function setAssistantMode(mode: AssistantMode): void {
  assistantMode = mode;
  renderAssistantMode();
}

function beginAsync(): void {
  headerAsyncOps += 1;
  updateHeaderState();
}

function endAsync(): void {
  headerAsyncOps = Math.max(0, headerAsyncOps - 1);
  updateHeaderState();
}

function showConfidenceBar(kind: IntentKind | undefined, score: number): void {
  if (!confidenceBarEl || !confidenceBadgeEl || !confidencePercentEl) return;
  const pct = Math.round(score * 100);
  confidenceBadgeEl.textContent = kind ? intentKindRu(kind) : "ИНТЕНТ";
  confidencePercentEl.textContent = `${pct}%`;
  confidencePercentEl.classList.remove("level-high", "level-mid", "level-low");
  if (score > 0.8) confidencePercentEl.classList.add("level-high");
  else if (score >= 0.6) confidencePercentEl.classList.add("level-mid");
  else confidencePercentEl.classList.add("level-low");
  confidenceBarEl.classList.remove("hidden");
}

function hideConfidenceBar(): void {
  confidenceBarEl?.classList.add("hidden");
}

function hideProactiveCard(): void {
  cardState = { mode: "hidden" };
  proactiveCardEl?.classList.add("hidden");
  activeConfirmationId = null;
}

function showProactiveSuggestion(suggestion: ProactiveSuggestion, message: string): void {
  if (!proactiveCardEl || !proactiveTextEl || !proactiveIconEl) return;
  cardState = { mode: "suggest", suggestion, message };
  proactiveIconEl.textContent = "✓";
  proactiveIconEl.classList.remove("confirm");
  proactiveTextEl.textContent = message;
  proactiveCardEl.classList.remove("hidden");
}

function showProactiveConfirm(correlationId: string, message: string): void {
  if (!proactiveCardEl || !proactiveTextEl || !proactiveIconEl) return;
  activeConfirmationId = correlationId;
  cardState = { mode: "confirm", correlationId, message };
  proactiveIconEl.textContent = "?";
  proactiveIconEl.classList.add("confirm");
  proactiveTextEl.textContent = message;
  proactiveCardEl.classList.remove("hidden");
}

type ScheduleGeneratedPayload = Extract<AgentEvent, { type: "schedule_generated" }>["payload"];

const SCHEDULE_STATUS_LABEL: Readonly<Record<ScheduleGeneratedPayload["result"]["status"], string>> =
  Object.freeze({
    optimal: "Оптимум",
    feasible: "Готово",
    infeasible: "Не найдено",
    unknown: "Неизвестно",
  });

function showScheduleSummary(payload: ScheduleGeneratedPayload): void {
  if (!scheduleCardEl) return;
  const result = payload.result;
  const assignments = Array.isArray(result.assignments) ? result.assignments : [];
  const assigned = assignments.length;
  const uniqueDoctors = new Set<string>();
  for (const a of assignments) {
    if (typeof a.doctorId === "string" && a.doctorId.length > 0) uniqueDoctors.add(a.doctorId);
  }
  const days =
    typeof result.horizonDays === "number" && result.horizonDays > 0 ? result.horizonDays : 9;
  const specialists = uniqueDoctors.size;

  if (scheduleCardTitleEl) {
    scheduleCardTitleEl.textContent = `✓ Расписание составлено на ${days} дней`;
  }
  if (scheduleCardStatusEl) {
    scheduleCardStatusEl.textContent = SCHEDULE_STATUS_LABEL[result.status] ?? result.status;
    scheduleCardStatusEl.setAttribute("data-status", result.status);
  }
  if (scheduleCountEl) scheduleCountEl.textContent = String(assigned);
  if (scheduleSpecialistsCountEl) scheduleSpecialistsCountEl.textContent = String(specialists);
  if (scheduleDaysValueEl) scheduleDaysValueEl.textContent = String(days);
  if (scheduleProceduresValueEl) scheduleProceduresValueEl.textContent = String(assigned);
  if (scheduleSpecialistsValueEl) scheduleSpecialistsValueEl.textContent = String(specialists);

  scheduleCardEl.classList.remove("hidden");
}

function hideScheduleSummary(): void {
  scheduleCardEl?.classList.add("hidden");
}

/** Does not navigate directly — background + page handle `navigate_to_schedule` (see `navigate-bridge.ts`). */
async function emitNavigateToSchedule(): Promise<void> {
  try {
    const raw = (await chrome.runtime.sendMessage({ type: "navigate_to_schedule" })) as
      | { ok: true }
      | { ok: false; error?: string }
      | undefined;
    if (raw && typeof raw === "object" && "ok" in raw && raw.ok === false) {
      pushLocalTimeline("warning", "Расписание", raw.error ?? "не удалось открыть расписание");
      return;
    }
    pushLocalTimeline("info", "Расписание", "Расписание");
  } catch (err: unknown) {
    pushLocalTimeline("error", "Расписание", String(err));
  }
}

async function dispatchVoiceSegment(capture: VoiceCapturedEvent): Promise<void> {
  processingSegmentCount += 1;
  if (assistantMode === "listening") {
    setAssistantMode("processing");
  } else {
    renderAssistantMode();
  }
  beginAsync();
  try {
    lastCorrelationId = capture.correlationId;
    const audioData = await capture.audioBlob.arrayBuffer();
    const voiceRes = (await chrome.runtime.sendMessage({
      type: "voice_captured",
      correlationId: capture.correlationId,
      ...(typeof capture.base64 === "string" && capture.base64.length > 0
        ? { base64: capture.base64, mimeType: capture.mimeType }
        : {}),
      audio: {
        mimeType: capture.mimeType,
        sizeBytes: capture.audioBlob.size,
        durationMs: capture.durationMs,
        data: audioData,
      },
    })) as { ok: boolean; error?: string; result?: VoicePipelineResult };

    pushLocalTimeline(
      "info",
      "Захват голоса",
      `${capture.durationMs} мс · ${capture.audioBlob.size} Б`,
    );

    if (!voiceRes.ok) {
      pushLocalTimeline("error", "Голосовой конвейер", voiceRes.error ?? "неизвестная ошибка");
      return;
    }

    const vr = voiceRes.result;
    if (!vr?.accepted) {
      if (vr?.step === "config" && vr.error) {
        pushLocalTimeline("error", "Настройка", vr.error);
      } else if (vr?.error) {
        const prefix =
          vr.step === "preprocess"
            ? "Предобработка"
            : vr.step === "transcribe"
              ? "Транскрипция"
              : "Конвейер";
        pushLocalTimeline("error", prefix, vr.error);
      }
      return;
    }

    pushLocalTimeline("info", "Текст", vr.text);
    try {
      await chrome.runtime.sendMessage({
        type: "user_utterance",
        correlationId: capture.correlationId,
        text: vr.text,
        transcribedDurationMs: vr.durationMs,
      });
      pushLocalTimeline("success", "Отправлено", "Реплика передана контроллеру");
    } catch (err: unknown) {
      pushLocalTimeline("error", "Отправка", String(err));
    }
  } catch (err: unknown) {
    pushLocalTimeline("error", "Запись", String(err));
  } finally {
    endAsync();
    processingSegmentCount = Math.max(0, processingSegmentCount - 1);
    // Only return to listening if the session is still active and no other
    // segments are still in-flight; otherwise keep current mode.
    if (processingSegmentCount === 0 && recorder.isContinuous()) {
      setAssistantMode("listening");
    } else {
      updateHeaderState();
    }
  }
}

function describeMicError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Chrome surfaces permission denials as DOMException name/message like
  // `NotAllowedError` / `Permission dismissed`. Surface a clear UX string.
  if (/NotAllowed|Permission|denied|dismissed/i.test(raw)) {
    return "Microphone access required";
  }
  if (/NotFound|device/i.test(raw)) {
    return "Микрофон не найден";
  }
  return raw;
}

async function activateAssistant(): Promise<void> {
  try {
    const sessionId = await recorder.startContinuous((segment) => {
      void dispatchVoiceSegment(segment);
    });
    setAssistantMode("listening");
    pushLocalTimeline("info", "Ассистент", `Активен · ${sessionId.slice(0, 8)}…`);
  } catch (err: unknown) {
    log.error("activate failed", String(err));
    pushLocalTimeline("error", "Микрофон", describeMicError(err));
    setAssistantMode("inactive");
  }
}

async function deactivateAssistant(): Promise<void> {
  try {
    await recorder.stopContinuous();
    pushLocalTimeline("info", "Ассистент", "Деактивирован");
  } catch (err: unknown) {
    log.error("deactivate failed", String(err));
    pushLocalTimeline("error", "Ассистент", String(err));
  } finally {
    processingSegmentCount = 0;
    setAssistantMode("inactive");
  }
}

recordBtn?.addEventListener("click", () => {
  if (assistantMode === "inactive") {
    void activateAssistant();
  } else {
    void deactivateAssistant();
  }
});

sendBtn?.addEventListener("click", () => {
  void submitUtterance();
});

utterEl?.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void submitUtterance();
  }
});

async function submitUtterance(): Promise<void> {
  const text = utterEl?.value.trim() ?? "";
  if (!text) return;
  beginAsync();
  try {
    const correlationId = newCorrelationId();
    lastCorrelationId = correlationId;
    await chrome.runtime.sendMessage({ type: "user_utterance", correlationId, text });
    pushLocalTimeline("info", "Команда", text);
    if (utterEl) utterEl.value = "";
  } catch (err: unknown) {
    pushLocalTimeline("error", "Команда", String(err));
  } finally {
    endAsync();
  }
}

async function sendConfirmation(accepted: boolean): Promise<void> {
  const correlationId = activeConfirmationId ?? lastCorrelationId;
  if (!correlationId) {
    pushLocalTimeline("warning", "Подтверждение", "Нет активного запроса");
    return;
  }
  beginAsync();
  try {
    await chrome.runtime.sendMessage({
      type: "user_confirmation",
      correlationId,
      accepted,
    });
    pushLocalTimeline(
      accepted ? "success" : "warning",
      "Подтверждение",
      accepted ? "Выполнение разрешено" : "Отклонено врачом",
    );
    hideProactiveCard();
  } catch (err: unknown) {
    pushLocalTimeline("error", "Подтверждение", String(err));
  } finally {
    endAsync();
  }
}

async function acceptProactiveSuggestion(suggestion: ProactiveSuggestion): Promise<void> {
  if (suggestion === "suggest_exam_progress") {
    hideProactiveCard();
    return;
  }
  if (suggestion === "suggest_schedule") {
    const correlationId = newCorrelationId();
    lastCorrelationId = correlationId;
    void chrome.runtime
      .sendMessage({ type: "auto_schedule", correlationId })
      .then(() => {
        pushLocalTimeline("info", "Расписание", "Авто-расписание (контекст по умолчанию)");
      })
      .catch((err: unknown) => {
        pushLocalTimeline("error", "Расписание", String(err));
      });
    hideProactiveCard();
    return;
  }
  if (suggestion === "suggest_build_schedule") {
    const correlationId = newCorrelationId();
    lastCorrelationId = correlationId;
    void chrome.runtime
      .sendMessage({ type: "build_schedule_from_plans", correlationId })
      .then(() => {
        pushLocalTimeline("info", "Расписание", "Формирование расписания из назначений...");
      })
      .catch((err: unknown) => {
        pushLocalTimeline("error", "Расписание", String(err));
      });
    hideProactiveCard();
    return;
  }

  const text = SUGGESTION_ACCEPT_UTTERANCE[suggestion];
  beginAsync();
  try {
    const correlationId = newCorrelationId();
    lastCorrelationId = correlationId;
    await chrome.runtime.sendMessage({ type: "user_utterance", correlationId, text });
    pushLocalTimeline("info", "Предложение", text);
    hideProactiveCard();
  } catch (err: unknown) {
    pushLocalTimeline("error", "Предложение", String(err));
  } finally {
    endAsync();
  }
}

acceptBtn?.addEventListener("click", () => {
  void (async () => {
    if (cardState.mode === "confirm") await sendConfirmation(true);
    else if (cardState.mode === "suggest") await acceptProactiveSuggestion(cardState.suggestion);
  })();
});

rejectBtn?.addEventListener("click", () => {
  void (async () => {
    if (cardState.mode === "confirm") await sendConfirmation(false);
    else hideProactiveCard();
  })();
});

function isEventEnvelope(m: unknown): m is { type: "event"; event: AgentEvent } {
  if (m === null || typeof m !== "object") return false;
  const obj = m as { type?: unknown; event?: unknown };
  return obj.type === "event" && typeof obj.event === "object" && obj.event !== null;
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isEventEnvelope(msg)) return;
  const ev = msg.event;
  appendAgentTimeline(ev);

  if (ev.type === "context_attached") {
    lastAttachedContextPage = ev.payload.currentPage;
    // Track patient ID for file upload asset binding
    const pid = (ev.payload as { patientId?: string }).patientId;
    if (pid && pid.length > 0) {
      uploadPatientId = pid;
      updatePatientBadge();
    }
    onContextAttachedForExamProgress(ev.payload);
    return;
  }

  if (ev.type === "intent_parsed") {
    interpretationByCorrelation.set(ev.correlationId, ev.payload.interpretation);
    return;
  }

  if (ev.type === "confidence_evaluated") {
    const interp = interpretationByCorrelation.get(ev.correlationId);
    showConfidenceBar(interp?.intent.kind, ev.payload.score);
    return;
  }

  if (ev.type === "decision_made") {
    hideConfidenceBar();
    const interp = interpretationByCorrelation.get(ev.correlationId);
    interpretationByCorrelation.delete(ev.correlationId);
    if (ev.payload.decision !== "execute" || !interp) {
      return;
    }

    if (interp.intent.kind === "navigate") {
      clearPrimaryExamFillProgressOnAgentNavigate();
      const suggestion = suggestNext("navigate");
      if (suggestion) {
        showProactiveSuggestion(suggestion, `\u2713 ${SUGGESTION_TEXT[suggestion]}`);
      }
      return;
    }

    if (interp.intent.kind === "schedule") {
      const suggestion = suggestNext("schedule");
      if (suggestion) {
        showProactiveSuggestion(suggestion, `\u2713 ${SUGGESTION_TEXT[suggestion]}`);
      }
      return;
    }

    if (interp.intent.kind === "fill") {
      const hint = afterPrimaryExamFillExecuted(interp.intent.slots, lastAttachedContextPage);
      if (hint.kind === "schedule") {
        showProactiveSuggestion(hint.suggestion, `\u2713 ${SUGGESTION_TEXT[hint.suggestion]}`);
      } else if (hint.kind === "progress") {
        showProactiveSuggestion(hint.suggestion, `\u2713 ${hint.displayMessage}`);
      }
    }
    return;
  }

  if (ev.type === "care_plan_confirmed") {
    // SEPARATION OF CONCERNS: confirmation ONLY persists the CarePlan.
    // Scheduling is a separate user action (`build_schedule` intent).
    // Surface the proactive suggestion so the clinician can trigger it.
    showProactiveSuggestion(
      "suggest_build_schedule",
      `📋 Назначение подтверждено: ${ev.payload.service} — ${ev.payload.sessionsCount} занятий. Сформировать расписание?`,
    );
    return;
  }

  if (ev.type === "schedule_generated") {
    showScheduleSummary(ev.payload);
    return;
  }

  if (ev.type === "user_confirmation_requested") {
    const payload = ev.payload as {
      summary: string;
      draftFields?: Array<{ field: string; label?: string; value: string }>;
      intentKind?: string;
    };
    if (payload.draftFields && payload.draftFields.length > 0) {
      // Rich draft preview for fill intents
      showDraftPreview(ev.correlationId, payload.summary, payload.draftFields);
    } else {
      // Simple confirm card for non-fill intents
      showProactiveConfirm(ev.correlationId, payload.summary);
    }
  }
});

openScheduleBtn?.addEventListener("click", () => {
  void emitNavigateToSchedule();
});

scheduleDismissBtn?.addEventListener("click", () => {
  hideScheduleSummary();
});

// ------------------------------------------------------------------ //
// Draft preview — clinician approval gate for generated fill content  //
// ------------------------------------------------------------------ //

let draftPreviewCorrelationId: string | null = null;

function showDraftPreview(
  correlationId: string,
  title: string,
  fields: Array<{ field: string; label?: string; value: string }>,
): void {
  if (!draftPreviewEl || !draftPreviewFieldsEl || !draftPreviewTitleEl) return;

  draftPreviewCorrelationId = correlationId;
  draftPreviewTitleEl.textContent = title;

  // Render field cards
  draftPreviewFieldsEl.innerHTML = "";
  for (const f of fields) {
    const fieldEl = document.createElement("div");
    fieldEl.className = "draft-field";

    const labelEl = document.createElement("div");
    labelEl.className = "draft-field-label";
    labelEl.textContent = f.label || f.field.replace(/_/g, " ");

    const valueEl = document.createElement("div");
    valueEl.className = "draft-field-value";
    valueEl.textContent = f.value || "(пусто)";

    fieldEl.append(labelEl, valueEl);
    draftPreviewFieldsEl.append(fieldEl);
  }

  draftPreviewEl.classList.remove("hidden");
  pushLocalTimeline("warning", "Черновик", `${fields.length} полей — ожидает подтверждения`);
}

function hideDraftPreview(): void {
  draftPreviewEl?.classList.add("hidden");
  draftPreviewCorrelationId = null;
  if (draftPreviewFieldsEl) draftPreviewFieldsEl.innerHTML = "";
}

async function handleDraftDecision(approved: boolean): Promise<void> {
  const correlationId = draftPreviewCorrelationId;
  if (!correlationId) {
    pushLocalTimeline("warning", "Черновик", "Нет активного черновика");
    return;
  }
  beginAsync();
  try {
    await chrome.runtime.sendMessage({
      type: "user_confirmation",
      correlationId,
      accepted: approved,
    });
    pushLocalTimeline(
      approved ? "success" : "warning",
      "Черновик",
      approved ? "Подтверждено — сохранение в систему" : "Отклонено врачом",
    );
    hideDraftPreview();
  } catch (err: unknown) {
    pushLocalTimeline("error", "Черновик", String(err));
  } finally {
    endAsync();
  }
}

draftApproveBtn?.addEventListener("click", () => {
  void handleDraftDecision(true);
});

draftRejectBtn?.addEventListener("click", () => {
  void handleDraftDecision(false);
});

// ------------------------------------------------------------------ //
// Quick-action chips — guided workflow shortcuts for demo             //
// ------------------------------------------------------------------ //

const quickActionsEl = document.getElementById("quickActions");
quickActionsEl?.addEventListener("click", (e: Event) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".quick-chip");
  if (!target) return;
  const utterance = target.dataset.utterance;
  if (!utterance) return;

  // Fill text input and auto-submit
  if (utterEl) {
    utterEl.value = utterance;
    utterEl.focus();
  }
  void submitUtterance();
});

renderAssistantMode();
refreshTimelineEmpty();

// ------------------------------------------------------------------ //
// Global hotkey (Ctrl/Cmd+Shift+V) — perception trigger only.         //
// The hotkey is detected in the background service worker; the panel  //
// only reacts to the relayed `hotkey_toggle_voice` message and updates //
// the recorder state. No DOM mutation, no LLM, no controller bypass.  //
// ------------------------------------------------------------------ //

const HOTKEY_DEBOUNCE_MS = 300;
let lastHotkeyTs = 0;

function isHotkeyToggleMessage(m: unknown): m is { type: "hotkey_toggle_voice"; ts: number } {
  if (typeof m !== "object" || m === null) return false;
  const obj = m as { type?: unknown; ts?: unknown };
  return obj.type === "hotkey_toggle_voice" && typeof obj.ts === "number";
}

async function handleHotkeyToggle(ts: number): Promise<void> {
  if (ts <= lastHotkeyTs) return;
  if (Date.now() - lastHotkeyTs < HOTKEY_DEBOUNCE_MS && lastHotkeyTs > 0) return;
  lastHotkeyTs = ts;

  if (assistantMode === "inactive") {
    pushLocalTimeline("info", "Горячая клавиша", "Старт записи (Ctrl/⌘+Shift+V)");
    await activateAssistant();
  } else {
    pushLocalTimeline("info", "Горячая клавиша", "Стоп записи (Ctrl/⌘+Shift+V)");
    await deactivateAssistant();
  }
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isHotkeyToggleMessage(msg)) return;
  void handleHotkeyToggle(msg.ts);
});

async function consumePendingHotkey(): Promise<void> {
  try {
    const res = (await chrome.storage.session.get("pendingVoiceToggle")) as {
      pendingVoiceToggle?: { ts?: number };
    };
    const pending = res.pendingVoiceToggle;
    if (!pending || typeof pending.ts !== "number") return;
    // Ignore stale intents (panel was reopened long after the hotkey fired).
    if (Date.now() - pending.ts > 5000) {
      await chrome.storage.session.remove("pendingVoiceToggle");
      return;
    }
    await chrome.storage.session.remove("pendingVoiceToggle");
    await handleHotkeyToggle(pending.ts);
  } catch (err: unknown) {
    log.warn("consumePendingHotkey failed", String(err));
  }
}

void consumePendingHotkey();

// ------------------------------------------------------------------ //
// Push-to-talk: hold Space to record while the side panel is focused. //
// Only fires when the user is NOT typing in an input/textarea/editable //
// region, to avoid hijacking the text fallback and upload controls.   //
// ------------------------------------------------------------------ //

let pttOwnsRecording = false;

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.repeat) return;
  if (isEditableTarget(e.target)) return;
  // Only start PTT when fully idle; never preempt a running session.
  if (assistantMode !== "inactive") return;
  e.preventDefault();
  pttOwnsRecording = true;
  pushLocalTimeline("info", "Push-to-talk", "Space зажат — запись");
  void activateAssistant();
});

window.addEventListener("keyup", (e: KeyboardEvent) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (!pttOwnsRecording) return;
  pttOwnsRecording = false;
  e.preventDefault();
  pushLocalTimeline("info", "Push-to-talk", "Space отпущен — стоп");
  void deactivateAssistant();
});

window.addEventListener("blur", () => {
  // If focus leaves the panel while PTT is active, stop cleanly so the
  // recorder never stays on after a keyup is lost in another window.
  if (!pttOwnsRecording) return;
  pttOwnsRecording = false;
  pushLocalTimeline("warning", "Push-to-talk", "Фокус потерян — стоп");
  void deactivateAssistant();
});

// ------------------------------------------------------------------ //
// File upload — UI separation for Patient vs Reusable scopes          //
// ------------------------------------------------------------------ //

const patientUploadDropzoneEl = document.getElementById("patientUploadDropzone") as HTMLDivElement | null;
const patientUploadFileInputEl = document.getElementById("patientUploadFileInput") as HTMLInputElement | null;
const patientUploadFileListEl = document.getElementById("patientUploadFileList") as HTMLDivElement | null;

const reusableUploadDropzoneEl = document.getElementById("reusableUploadDropzone") as HTMLDivElement | null;
const reusableUploadFileInputEl = document.getElementById("reusableUploadFileInput") as HTMLInputElement | null;
const reusableUploadFileListEl = document.getElementById("reusableUploadFileList") as HTMLDivElement | null;

const uploadPatientBadgeEl = document.getElementById("uploadPatientBadge") as HTMLSpanElement | null;
const patientUploadFallbackEl = document.getElementById("patientUploadFallback") as HTMLDivElement | null;
const btnOpenPatientEl = document.getElementById("btnOpenPatient") as HTMLButtonElement | null;
const btnUploadAsTemplateEl = document.getElementById("btnUploadAsTemplate") as HTMLButtonElement | null;

let uploadPatientId: string | undefined;
let uploadedFileCount = 0;
let pendingFallbackFiles: File[] | null = null;

type FileChipState = {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  scope: "patient" | "reusable";
  status: "parsing" | "done" | "error";
  errorMsg?: string;
  assetId?: string;
};

const fileChips = new Map<string, FileChipState>();

function updatePatientBadge(): void {
  if (!uploadPatientBadgeEl) return;
  uploadPatientBadgeEl.textContent = uploadPatientId ?? "не указан";
  
  // Provide visual cue if dropzone should be blocked
  if (patientUploadDropzoneEl) {
    if (!uploadPatientId) {
      patientUploadDropzoneEl.style.opacity = "0.7";
      patientUploadDropzoneEl.style.borderStyle = "dashed";
    } else {
      patientUploadDropzoneEl.style.opacity = "1";
    }
  }
}

async function attemptFetchFreshPatientContext(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return undefined;
    const res = await chrome.tabs.sendMessage(tab.id, { type: "extract_page_context" }) as { ok?: boolean; context?: { patientId?: string } };
    if (res?.ok && res.context?.patientId) {
      uploadPatientId = res.context.patientId;
      updatePatientBadge();
      return uploadPatientId;
    }
  } catch {
    // Ignore error (e.g. content script not injected)
  }
  return undefined;
}

function showPatientUploadFallback(files?: FileList | File[]) {
  if (files) pendingFallbackFiles = Array.from(files);
  else pendingFallbackFiles = null;

  if (patientUploadDropzoneEl && patientUploadFallbackEl) {
    patientUploadDropzoneEl.classList.add("hidden");
    patientUploadFallbackEl.classList.remove("hidden");
  }
}

function hidePatientUploadFallback() {
  pendingFallbackFiles = null;
  if (patientUploadDropzoneEl && patientUploadFallbackEl) {
    patientUploadFallbackEl.classList.add("hidden");
    patientUploadDropzoneEl.classList.remove("hidden");
  }
}

btnOpenPatientEl?.addEventListener("click", () => {
  void (async () => {
    hidePatientUploadFallback();
    // Extract saved files before hiding clears them
    const files = pendingFallbackFiles;
    pendingFallbackFiles = null;

    const res = await chrome.runtime.sendMessage({ type: "navigate_to_diary" }) as { ok?: boolean };
    if (!res?.ok) return;

    // Wait slightly for navigation to settle
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Request fresh context 
    const id = await attemptFetchFreshPatientContext();

    if (id && id !== "unknown") {
      pushLocalTimeline("success", "Файлы пациента", "Найдена карточка пациента. Доступ открыт.");
      if (files && files.length > 0) {
        for (const file of files) {
          void handleFileUpload(file, "patient");
        }
      }
    } else {
      pushLocalTimeline("error", "Файлы пациента", "Patient context not detected on diary page. Upload remains disabled.");
    }
  })();
});

btnUploadAsTemplateEl?.addEventListener("click", () => {
  const files = pendingFallbackFiles;
  hidePatientUploadFallback();
  if (files && files.length > 0) {
    for (const file of files) {
      void handleFileUpload(file, "reusable");
    }
  } else {
    reusableUploadFileInputEl?.click();
  }
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function getFileExtType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  return "txt";
}

function renderFileChip(chip: FileChipState): HTMLElement {
  const el = document.createElement("div");
  el.className = "file-chip";
  el.dataset.chipId = chip.id;

  const extType = getFileExtType(chip.name);

  const iconEl = document.createElement("div");
  iconEl.className = `file-chip-icon ${extType}`;
  iconEl.textContent = extType.toUpperCase();

  const bodyEl = document.createElement("div");
  bodyEl.className = "file-chip-body";

  const nameEl = document.createElement("div");
  nameEl.className = "file-chip-name";
  nameEl.textContent = chip.name;

  const metaEl = document.createElement("div");
  metaEl.className = "file-chip-meta";
  metaEl.textContent = formatFileSize(chip.sizeBytes);

  bodyEl.append(nameEl, metaEl);

  const statusEl = document.createElement("span");
  statusEl.className = `file-chip-status ${chip.status}`;
  statusEl.textContent =
    chip.status === "parsing"
      ? "…"
      : chip.status === "done"
        ? "✓"
        : "✗";
  if (chip.errorMsg) {
    statusEl.title = chip.errorMsg;
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "file-chip-remove";
  removeBtn.type = "button";
  removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  removeBtn.title = "Удалить";
  removeBtn.addEventListener("click", () => {
    fileChips.delete(chip.id);
    el.remove();
  });

  el.append(iconEl, bodyEl, statusEl, removeBtn);
  return el;
}

function updateFileChipStatus(chipId: string, status: FileChipState["status"], errorMsg?: string, assetId?: string): void {
  const chip = fileChips.get(chipId);
  if (!chip) return;
  chip.status = status;
  chip.errorMsg = errorMsg;
  chip.assetId = assetId;

  const listEl = chip.scope === "patient" ? patientUploadFileListEl : reusableUploadFileListEl;
  const chipEl = listEl?.querySelector(`[data-chip-id="${chipId}"]`);
  if (!chipEl) return;

  const statusEl = chipEl.querySelector(".file-chip-status");
  if (statusEl) {
    statusEl.className = `file-chip-status ${status}`;
    statusEl.textContent = status === "parsing" ? "…" : status === "done" ? "✓" : "✗";
    if (errorMsg) (statusEl as HTMLElement).title = errorMsg;
  }
}

function inferMimeType(file: File): string {
  if (file.type && file.type.length > 0) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "txt" || ext === "text") return "text/plain";
  return "application/octet-stream";
}

async function handleFileUpload(file: File, scope: "patient" | "reusable"): Promise<void> {
  const isPatient = scope === "patient";

  if (isPatient) {
    const id = uploadPatientId || (await attemptFetchFreshPatientContext());
    if (!id || id === "unknown") {
      pushLocalTimeline("error", "Файл пациента", "Нет активного пациента. Перейдите в карточку клиента.");
      showPatientUploadFallback([file]);
      return;
    }
  }

  const mimeType = inferMimeType(file);
  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();

  // Validate MIME type
  if (!ACCEPTED_MIME_TYPES.has(normalizedMime) && !ACCEPTED_MIME_TYPES.has(mimeType)) {
    pushLocalTimeline("error", "Файл", `Неподдерживаемый формат: ${file.name}`);
    return;
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    pushLocalTimeline("error", "Файл", `Превышен лимит ${formatFileSize(MAX_FILE_SIZE_BYTES)}: ${file.name}`);
    return;
  }

  // Validate count
  if (uploadedFileCount >= MAX_FILES_PER_SESSION) {
    pushLocalTimeline("warning", "Файл", `Лимит файлов (${MAX_FILES_PER_SESSION}) достигнут`);
    return;
  }

  uploadedFileCount++;
  const chipId = newCorrelationId();
  const chip: FileChipState = {
    id: chipId,
    name: file.name,
    sizeBytes: file.size,
    mimeType: normalizedMime,
    scope,
    status: "parsing",
  };
  fileChips.set(chipId, chip);
  const chipEl = renderFileChip(chip);
  
  if (isPatient) {
    patientUploadFileListEl?.prepend(chipEl);
  } else {
    reusableUploadFileListEl?.prepend(chipEl);
  }
  pushLocalTimeline("info", "Файл", `Обработка: ${file.name}`);

  try {
    // Read file
    const buffer = await file.arrayBuffer();

    // Parse in sidepanel context (pdf.js available here)
    const parseResult = await parseFile(buffer, file.name, normalizedMime);

    if (!parseResult.ok) {
      updateFileChipStatus(chipId, "error", parseResult.error);
      pushLocalTimeline("error", "Файл", `Ошибка парсинга: ${parseResult.error}`);
      return;
    }

    // Send parsed text to background for asset registration
    const correlationId = newCorrelationId();
    const payload = isPatient 
      ? {
          type: "ingest_file" as const,
          correlationId,
          file: { name: file.name, mimeType: normalizedMime, sizeBytes: file.size },
          parsedText: parseResult.text,
          scope: "patient" as const,
          patientId: uploadPatientId,
        }
      : {
          type: "ingest_file" as const,
          correlationId,
          file: { name: file.name, mimeType: normalizedMime, sizeBytes: file.size },
          parsedText: parseResult.text,
          scope: "reusable" as const,
        };
        
    const response = (await chrome.runtime.sendMessage(payload)) as { ok: boolean; assetId?: string; error?: string } | undefined;

    if (response?.ok && response.assetId) {
      updateFileChipStatus(chipId, "done", undefined, response.assetId);
      const truncNote = parseResult.truncated ? " (усечён)" : "";
      const pageNote = parseResult.pageCount ? ` · ${parseResult.pageCount} стр.` : "";
      pushLocalTimeline(
        "success",
        isPatient ? "Файл пациента" : "Шаблон",
        `${file.name}${pageNote}${truncNote} → актив ${response.assetId.slice(0, 8)}…`,
      );
    } else {
      const errorMsg = response?.error ?? "unknown_error";
      updateFileChipStatus(chipId, "error", errorMsg);
      pushLocalTimeline("error", isPatient ? "Файл пациента" : "Шаблон", `Ошибка регистрации: ${errorMsg}`);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateFileChipStatus(chipId, "error", errorMsg);
    pushLocalTimeline("error", "Файл", `${file.name}: ${errorMsg}`);
  }
}

function setupDropzone(
  dropzoneEl: HTMLElement | null,
  inputEl: HTMLInputElement | null,
  scope: "patient" | "reusable",
) {
  if (!dropzoneEl || !inputEl) return;

  // Drop zone: click to open file picker
  dropzoneEl.addEventListener("click", (e) => {
    e.preventDefault();
    void (async () => {
      if (scope === "patient") {
        const id = uploadPatientId || (await attemptFetchFreshPatientContext());
        if (!id || id === "unknown") {
          showPatientUploadFallback();
          return;
        }
      }
      inputEl.click();
    })();
  });

  dropzoneEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void (async () => {
        if (scope === "patient") {
          const id = uploadPatientId || (await attemptFetchFreshPatientContext());
          if (!id || id === "unknown") {
            showPatientUploadFallback();
            return;
          }
        }
        inputEl.click();
      })();
    }
  });

  // File picker change
  inputEl.addEventListener("change", () => {
    const files = inputEl.files;
    if (files && files.length > 0) {
      for (const file of files) {
        void handleFileUpload(file, scope);
      }
      inputEl.value = ""; // Reset for re-upload of same file
    }
  });

  // Drag and drop
  dropzoneEl.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropzoneEl.classList.add("dragover");
  });

  dropzoneEl.addEventListener("dragleave", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropzoneEl.classList.remove("dragover");
  });

  dropzoneEl.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropzoneEl.classList.remove("dragover");
    
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    void (async () => {
      if (scope === "patient") {
        const id = uploadPatientId || (await attemptFetchFreshPatientContext());
        if (!id || id === "unknown") {
          showPatientUploadFallback(files);
          return;
        }
      }
      for (const file of files) {
        void handleFileUpload(file, scope);
      }
    })();
  });
}

setupDropzone(patientUploadDropzoneEl, patientUploadFileInputEl, "patient");
setupDropzone(reusableUploadDropzoneEl, reusableUploadFileInputEl, "reusable");

// Track patient ID from context_attached events
// (Extended in the existing onMessage handler above — patientId flows
// through context_attached events and updates the upload badge.)
