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
    case "context_attached":
      return {
        dot: "info",
        title: "Контекст",
        description: ev.payload.activeForm
          ? `${ev.payload.currentPage} · ${ev.payload.activeForm}`
          : ev.payload.currentPage,
      };
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
    case "validation_failed":
      return {
        dot: "error",
        title: "Ошибка валидации",
        description: ev.payload.errors.slice(0, 3).join("; "),
      };
    case "confidence_evaluated": {
      const pct = Math.round(ev.payload.score * 100);
      return {
        dot: ev.payload.level === "low" ? "warning" : "info",
        title: "Уверенность",
        description: `${pct}% · ${ev.payload.requiresConfirmation ? "нужно подтверждение" : "авто"}`,
      };
    }
    case "decision_made":
      return {
        dot: ev.payload.decision === "execute" ? "success" : ev.payload.decision === "confirm" ? "warning" : "error",
        title: "Решение",
        description: `${ev.payload.decision} · ${Math.round(ev.payload.confidence * 100)}%`,
      };
    case "action_plan_created":
      return {
        dot: "info",
        title: "План",
        description: `${ev.payload.intentKind}: ${ev.payload.actionCount} действий`,
      };
    case "dom_action_executed":
      return {
        dot: "success",
        title: "Выполнено",
        description: ev.payload.action.kind,
      };
    case "dom_action_failed":
      return {
        dot: "error",
        title: "Сбой DOM",
        description: ev.payload.error,
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

async function activateAssistant(): Promise<void> {
  try {
    const sessionId = await recorder.startContinuous((segment) => {
      void dispatchVoiceSegment(segment);
    });
    setAssistantMode("listening");
    pushLocalTimeline("info", "Ассистент", `Активен · ${sessionId.slice(0, 8)}…`);
  } catch (err: unknown) {
    log.error("activate failed", String(err));
    pushLocalTimeline("error", "Микрофон", String(err));
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

  if (ev.type === "schedule_generated") {
    showScheduleSummary(ev.payload);
    return;
  }

  if (ev.type === "user_confirmation_requested") {
    showProactiveConfirm(ev.correlationId, ev.payload.summary);
  }
});

openScheduleBtn?.addEventListener("click", () => {
  void emitNavigateToSchedule();
});

scheduleDismissBtn?.addEventListener("click", () => {
  hideScheduleSummary();
});

renderAssistantMode();
refreshTimelineEmpty();
