import { ContentTabVoiceRecorder } from "../voice/index.js";
import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";
import { suggestNext, SUGGESTION_TEXT, type ProactiveSuggestion } from "../controller/proactivity.js";
import type { AgentEvent, IntentKind } from "@ai-rpa/schemas";

const log = createLogger("sidepanel");
const recorder = new ContentTabVoiceRecorder();
let lastCorrelationId: string | null = null;

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

type DotKind = "success" | "info" | "warning" | "error";

type CardState =
  | { mode: "hidden" }
  | { mode: "confirm"; correlationId: string; message: string }
  | { mode: "suggest"; suggestion: ProactiveSuggestion; message: string };

let cardState: CardState = { mode: "hidden" };

let headerAsyncOps = 0;
let activeConfirmationId: string | null = null;

const intentByCorrelation = new Map<string, IntentKind>();

const SUGGESTION_ACCEPT_UTTERANCE: Readonly<Record<ProactiveSuggestion, string>> = Object.freeze({
  suggest_schedule: "Да, сформируйте расписание.",
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
  const recording = recorder.isRecording();
  const busy = recording || headerAsyncOps > 0;
  if (statusDotEl) {
    statusDotEl.classList.toggle("ready", !busy);
    statusDotEl.classList.toggle("processing", busy);
  }
  if (statusLabelEl) {
    statusLabelEl.textContent = busy ? "Обработка" : "Готов";
  }
}

function setRecordingVisual(on: boolean): void {
  recordBtn?.classList.toggle("is-recording", on);
  recordBtn?.setAttribute("aria-pressed", on ? "true" : "false");
  waveformEl?.classList.toggle("active", on);
  if (pttLabelEl) {
    pttLabelEl.textContent = on ? "Идёт запись…" : "Нажмите для записи";
    pttLabelEl.classList.toggle("recording", on);
  }
  updateHeaderState();
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

async function stopRecordingAndDispatch(): Promise<void> {
  beginAsync();
  setRecordingVisual(false);
  try {
    const capture = await recorder.stopRecording();
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
    updateHeaderState();
  }
}

recordBtn?.addEventListener("click", () => {
  if (recorder.isRecording()) {
    void stopRecordingAndDispatch();
    return;
  }
  void (async () => {
    try {
      const correlationId = await recorder.startRecording();
      lastCorrelationId = correlationId;
      setRecordingVisual(true);
      pushLocalTimeline("info", "Запись", `Сессия ${correlationId.slice(0, 8)}…`);
    } catch (err: unknown) {
      log.error("record failed", String(err));
      pushLocalTimeline("error", "Микрофон", String(err));
      setRecordingVisual(false);
    }
  })();
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

  if (ev.type === "intent_parsed") {
    intentByCorrelation.set(ev.correlationId, ev.payload.interpretation.intent.kind);
    return;
  }

  if (ev.type === "confidence_evaluated") {
    const kind = intentByCorrelation.get(ev.correlationId);
    showConfidenceBar(kind, ev.payload.score);
    return;
  }

  if (ev.type === "decision_made") {
    hideConfidenceBar();
    const kind = intentByCorrelation.get(ev.correlationId);
    intentByCorrelation.delete(ev.correlationId);
    if (ev.payload.decision === "execute" && kind === "fill") {
      const suggestion = suggestNext(kind);
      if (suggestion) {
        showProactiveSuggestion(suggestion, `✓ ${SUGGESTION_TEXT[suggestion]}`);
      }
    }
    return;
  }

  if (ev.type === "user_confirmation_requested") {
    showProactiveConfirm(ev.correlationId, ev.payload.summary);
  }
});

updateHeaderState();
refreshTimelineEmpty();
