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

// ------------------------------------------------------------------ //
// Assistant mode — drives mic button and command block visuals        //
// ------------------------------------------------------------------ //
type AssistantMode = "inactive" | "listening" | "processing";
let assistantMode: AssistantMode = "inactive";
let processingSegmentCount = 0;

// ------------------------------------------------------------------ //
// Main pane state — the single state-driven surface for events+verify //
// ------------------------------------------------------------------ //
type VerifyFill = {
  kind: "fill";
  correlationId: string;
  title: string;
  fields: Array<{ field: string; label?: string; value: string }>;
};
type VerifySchedule = {
  kind: "schedule";
  title: string;
  status: string;
  statusLabel: string;
  days: number;
  assigned: number;
  specialists: number;
};
type VerifyConfirm = {
  kind: "confirm";
  title: string;
  correlationId?: string;
  suggestion?: ProactiveSuggestion;
  acceptLabel?: string;
  rejectLabel?: string;
};
type VerifyPdf = {
  kind: "pdf";
  title: string;
  assetId: string;
  fileName: string;
  pages?: number;
  preview: string;
};
type VerifyContent = VerifyFill | VerifySchedule | VerifyConfirm | VerifyPdf;

/**
 * Schedule-build progress phases (clinician-facing, never technical).
 * Maps directly to the UX spec:
 *   confirmed  → "Назначение подтверждено"
 *   generating → "Формирую расписание"
 *   ready      → "Расписание готово"
 */
type ScheduleProgressPhase = "confirmed" | "generating" | "ready";

type PaneState =
  | { mode: "idle" }
  | { mode: "processing"; label?: string; hint?: string }
  | { mode: "verify"; content: VerifyContent }
  | { mode: "success"; message: string }
  | { mode: "error"; message: string };

const SCHEDULE_PROGRESS_LABEL: Readonly<Record<ScheduleProgressPhase, string>> =
  Object.freeze({
    confirmed: "Назначение подтверждено",
    generating: "Формирую расписание",
    ready: "Расписание готово",
  });

const SCHEDULE_PROGRESS_HINT: Readonly<Record<ScheduleProgressPhase, string>> =
  Object.freeze({
    confirmed: "Курс сохранён в плане лечения",
    generating: "Подбираю слоты и специалистов…",
    ready: "Подтвердите результат или откройте расписание",
  });

type DotKind = "success" | "info" | "warning" | "error" | "muted";

type ShortEvent = {
  id: string;
  dot: DotKind;
  title: string;
  desc: string;
  ts: string;
};

const MAX_VISIBLE_EVENTS = 5;
let paneState: PaneState = { mode: "idle" };
let recentEvents: ShortEvent[] = [];

/**
 * Current schedule-build progress phase, if any. Drives both the main
 * pane title and the header badge. Cleared on idle / error / verify.
 */
let scheduleProgressPhase: ScheduleProgressPhase | null = null;

// ------------------------------------------------------------------ //
// DOM references                                                      //
// ------------------------------------------------------------------ //
const recordBtn = document.getElementById("record") as HTMLButtonElement | null;
const utterEl = document.getElementById("utter") as HTMLInputElement | null;
const commandBlockEl = document.getElementById("commandBlock") as HTMLDivElement | null;

const headerPatientEl = document.getElementById("headerPatient") as HTMLDivElement | null;
const headerContextEl = document.getElementById("headerContext") as HTMLDivElement | null;
const headerStatusEl = document.getElementById("headerStatus") as HTMLDivElement | null;
const statusLabelEl = document.getElementById("statusLabel") as HTMLSpanElement | null;

const mainPaneEl = document.getElementById("mainPane") as HTMLElement | null;
const paneTitleEl = document.getElementById("paneTitle") as HTMLHeadingElement | null;
const paneMetaEl = document.getElementById("paneMeta") as HTMLSpanElement | null;
const paneBodyEl = document.getElementById("paneBody") as HTMLDivElement | null;

let headerAsyncOps = 0;
let headerPatientName: string | null = null;
let headerPatientId: string | null = null;
let headerContextPage: string | null = null;
let headerContextForm: string | null = null;

const interpretationByCorrelation = new Map<string, LlmInterpretation>();
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

// ------------------------------------------------------------------ //
// Small helpers                                                        //
// ------------------------------------------------------------------ //
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

function pageRu(page: string): string {
  const map: Record<string, string> = {
    primary_exam: "Первичный осмотр",
    diary: "Дневник",
    schedule: "Расписание",
    care_plan: "План лечения",
    unknown: "—",
  };
  return map[page] ?? page;
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

function nowLabel(): string {
  return new Date().toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function confirmButtonLabelsForIntent(
  intentKind: string | undefined,
): { accept: string; reject: string } {
  switch (intentKind) {
    case "build_schedule":
      return { accept: "Построить", reject: "Отмена" };
    case "schedule":
      return { accept: "Сформировать", reject: "Отмена" };
    case "assign":
      return { accept: "Назначить", reject: "Отмена" };
    case "navigate":
      return { accept: "Перейти", reject: "Отмена" };
    case "set_status":
      return { accept: "Изменить", reject: "Отмена" };
    default:
      return { accept: "Подтвердить", reject: "Отмена" };
  }
}

function pluralizeSessionsRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "занятие";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "занятия";
  return "занятий";
}

// ------------------------------------------------------------------ //
// Header                                                              //
// ------------------------------------------------------------------ //
function renderHeader(): void {
  if (headerPatientEl) {
    if (headerPatientName) {
      headerPatientEl.textContent = headerPatientName;
    } else {
      headerPatientEl.innerHTML = `<span class="placeholder">Пациент не выбран</span>`;
    }
  }
  if (headerContextEl) {
    const doc = headerContextPage ? pageRu(headerContextPage) : "Готов к команде";
    const form = headerContextForm ? ` · ${headerContextForm}` : "";
    headerContextEl.innerHTML = `<span class="header-context-doc">${escapeHtml(doc)}</span>${escapeHtml(form)}`;
  }
  updateHeaderState();
}

function updateHeaderState(): void {
  if (!headerStatusEl || !statusLabelEl) return;
  let state: "idle" | "recording" | "processing" | "verify" | "error" = "idle";
  let label = "Готов";

  if (assistantMode === "listening") {
    state = "recording";
    label = "Запись";
  } else if (
    assistantMode === "processing" ||
    headerAsyncOps > 0 ||
    paneState.mode === "processing"
  ) {
    state = "processing";
    // Prefer the clinician-facing progress label over the generic
    // "Обработка" badge — the header must always say what is happening,
    // never a placeholder.
    if (paneState.mode === "processing" && paneState.label) {
      label = paneState.label;
    } else if (scheduleProgressPhase) {
      label = SCHEDULE_PROGRESS_LABEL[scheduleProgressPhase];
    } else {
      label = "Работаю";
    }
  } else if (paneState.mode === "verify") {
    state = "verify";
    label = "Проверка";
  } else if (paneState.mode === "error") {
    state = "error";
    label = "Ошибка";
  }

  headerStatusEl.setAttribute("data-state", state);
  statusLabelEl.textContent = label;
}

// ------------------------------------------------------------------ //
// Command block + mic button render                                   //
// ------------------------------------------------------------------ //
function renderAssistantMode(): void {
  if (!recordBtn) return;
  recordBtn.classList.remove("is-listening", "is-processing");

  let ariaLabel = "Активировать ассистента";
  switch (assistantMode) {
    case "listening":
      recordBtn.classList.add("is-listening");
      recordBtn.setAttribute("aria-pressed", "true");
      ariaLabel = "Остановить запись";
      commandBlockEl?.setAttribute("data-state", "recording");
      break;
    case "processing":
      recordBtn.classList.add("is-processing");
      recordBtn.setAttribute("aria-pressed", "true");
      ariaLabel = "Обрабатываю";
      commandBlockEl?.setAttribute("data-state", "processing");
      break;
    case "inactive":
    default:
      recordBtn.setAttribute("aria-pressed", "false");
      commandBlockEl?.setAttribute("data-state", "idle");
      break;
  }
  recordBtn.setAttribute("aria-label", ariaLabel);
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

// ------------------------------------------------------------------ //
// Main pane state controller                                          //
// ------------------------------------------------------------------ //
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setPaneState(next: PaneState): void {
  paneState = next;
  renderPane();
  updateHeaderState();
}

function renderPane(): void {
  if (!mainPaneEl || !paneBodyEl || !paneTitleEl || !paneMetaEl) return;
  mainPaneEl.setAttribute("data-state", paneState.mode);
  paneMetaEl.textContent = "";
  paneBodyEl.innerHTML = "";

  switch (paneState.mode) {
    case "idle":
      paneTitleEl.textContent = "Готов к команде";
      renderIdleBody(paneBodyEl);
      break;
    case "processing": {
      // The main pane MUST always express what the system is doing in
      // clinician language. If a progress label is set (e.g. schedule
      // build phases), it takes priority over the generic event log.
      if (paneState.label) {
        paneTitleEl.textContent = paneState.label;
        paneMetaEl.textContent = "";
        renderProgressBody(paneBodyEl, paneState.label, paneState.hint);
      } else {
        paneTitleEl.textContent = "Работаю";
        paneMetaEl.textContent = `${recentEvents.length} шаг.`;
        renderEventsBody(paneBodyEl);
      }
      break;
    }
    case "verify":
      paneTitleEl.textContent = "Проверка результата";
      renderVerifyBody(paneBodyEl, paneState.content);
      break;
    case "success":
      paneTitleEl.textContent = "Готово";
      renderSuccessBody(paneBodyEl, paneState.message);
      break;
    case "error":
      paneTitleEl.textContent = "Ошибка";
      renderErrorBody(paneBodyEl, paneState.message);
      break;
  }
}

// ---- idle ----
const IDLE_QUICK_ACTIONS: Array<{ label: string; utterance: string }> = [
  { label: "Открыть первичный осмотр", utterance: "открой первичный осмотр" },
  { label: "Заполнить жалобы", utterance: "пациент жалуется на задержку речевого развития, нарушение координации" },
  { label: "Объективно", utterance: "объективно: сознание ясное, мышечный тонус повышен, рефлексы оживлены" },
  { label: "Диагноз G80", utterance: "диагноз g80" },
  { label: "Дневник", utterance: "открой дневниковую запись" },
  { label: "Статус: выполнено", utterance: "массаж выполнен" },
];

function renderIdleBody(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "pane-idle";

  const hint = document.createElement("div");
  hint.className = "pane-idle-hint";
  hint.innerHTML = `Нажмите <strong>микрофон</strong> или введите команду.<br/>Результат появится здесь же.`;
  wrap.appendChild(hint);

  const chips = document.createElement("div");
  chips.className = "quick-chips";
  for (const qa of IDLE_QUICK_ACTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-chip";
    btn.textContent = qa.label;
    btn.addEventListener("click", () => {
      if (utterEl) utterEl.value = qa.utterance;
      void submitUtterance();
    });
    chips.appendChild(btn);
  }
  wrap.appendChild(chips);

  root.appendChild(wrap);
}

// ---- processing (events) ----
function renderEventsBody(root: HTMLElement): void {
  if (recentEvents.length === 0) {
    const hint = document.createElement("div");
    hint.className = "pane-idle-hint";
    hint.textContent = "Начинаю обработку…";
    root.appendChild(hint);
    return;
  }
  const list = document.createElement("div");
  list.className = "pane-events";
  for (const ev of recentEvents) {
    const row = document.createElement("div");
    row.className = "event-row";

    const dot = document.createElement("span");
    dot.className = `event-dot ${ev.dot}`;

    const body = document.createElement("div");
    body.className = "event-body";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = ev.title;
    const desc = document.createElement("div");
    desc.className = "event-desc";
    desc.textContent = ev.desc;
    body.append(title, desc);

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = ev.ts;

    row.append(dot, body, time);
    list.appendChild(row);
  }
  root.appendChild(list);
}

// ---- progress (clinician-facing schedule build phases) ----
function renderProgressBody(root: HTMLElement, label: string, hint?: string): void {
  const wrap = document.createElement("div");
  wrap.className = "pane-progress";

  const spinner = document.createElement("div");
  spinner.className = "pane-progress-spinner";
  spinner.setAttribute("aria-hidden", "true");
  wrap.appendChild(spinner);

  const title = document.createElement("div");
  title.className = "pane-progress-title";
  title.textContent = label;
  wrap.appendChild(title);

  if (hint && hint.length > 0) {
    const hintEl = document.createElement("div");
    hintEl.className = "pane-progress-hint";
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }

  root.appendChild(wrap);
}

/**
 * Single entry point for clinician-facing schedule-build progress.
 * Never accepts raw pipeline terms — callers must use the typed phase.
 * Passing `null` clears the phase but does NOT change the pane mode.
 */
function setScheduleProgress(phase: ScheduleProgressPhase | null): void {
  scheduleProgressPhase = phase;
  if (phase === null) {
    updateHeaderState();
    return;
  }
  setPaneState({
    mode: "processing",
    label: SCHEDULE_PROGRESS_LABEL[phase],
    hint: SCHEDULE_PROGRESS_HINT[phase],
  });
}

// ---- verify ----
function renderVerifyBody(root: HTMLElement, v: VerifyContent): void {
  const wrap = document.createElement("div");
  wrap.className = "pane-verify";

  switch (v.kind) {
    case "fill":
      renderVerifyFill(wrap, v);
      break;
    case "schedule":
      renderVerifySchedule(wrap, v);
      break;
    case "confirm":
      renderVerifyConfirm(wrap, v);
      break;
    case "pdf":
      renderVerifyPdf(wrap, v);
      break;
  }

  root.appendChild(wrap);
}

function renderVerifyFill(root: HTMLElement, v: VerifyFill): void {
  const summary = document.createElement("p");
  summary.className = "verify-summary";
  summary.innerHTML = `<strong>${escapeHtml(v.title)}</strong><br/>Проверьте заполнение перед сохранением.`;
  root.appendChild(summary);

  const fields = document.createElement("div");
  fields.className = "verify-fields";
  for (const f of v.fields) {
    const fieldEl = document.createElement("div");
    fieldEl.className = "verify-field";
    const label = document.createElement("div");
    label.className = "verify-field-label";
    label.textContent = f.label || f.field.replace(/_/g, " ");
    const value = document.createElement("div");
    value.className = "verify-field-value";
    value.textContent = f.value || "(пусто)";
    fieldEl.append(label, value);
    fields.appendChild(fieldEl);
  }
  root.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.append(
    makeButton("Отклонить", "btn btn-ghost", () => void handleFillDecision(v.correlationId, false)),
    makeButton("Подтвердить", "btn btn-primary", () => void handleFillDecision(v.correlationId, true)),
  );
  root.appendChild(actions);
}

function renderVerifySchedule(root: HTMLElement, v: VerifySchedule): void {
  const summary = document.createElement("p");
  summary.className = "verify-summary";
  summary.innerHTML = `<strong>${escapeHtml(v.title)}</strong><br/>Назначено <strong>${v.assigned}</strong> процедур для <strong>${v.specialists}</strong> специалистов.`;
  root.appendChild(summary);

  const stats = document.createElement("div");
  stats.className = "verify-stats";
  stats.append(
    makeStat(String(v.days), "Дней"),
    makeStat(String(v.assigned), "Процедур"),
    makeStat(String(v.specialists), "Специалистов"),
  );
  root.appendChild(stats);

  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.append(
    makeButton("Скрыть", "btn btn-ghost", () => {
      setPaneState({ mode: "idle" });
    }),
    makeButton("Открыть расписание", "btn btn-primary", () => {
      void emitNavigateToSchedule();
      setPaneState({ mode: "success", message: "Расписание открыто" });
      scheduleIdleAfter(1500);
    }),
  );
  root.appendChild(actions);
}

function renderVerifyConfirm(root: HTMLElement, v: VerifyConfirm): void {
  const summary = document.createElement("p");
  summary.className = "verify-summary";
  summary.textContent = v.title;
  root.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.append(
    makeButton(v.rejectLabel ?? "Отмена", "btn btn-ghost", () => {
      if (v.correlationId) void sendConfirmation(v.correlationId, false);
      else setPaneState({ mode: "idle" });
    }),
    makeButton(v.acceptLabel ?? "Подтвердить", "btn btn-primary", () => {
      if (v.correlationId) {
        void sendConfirmation(v.correlationId, true);
      } else if (v.suggestion) {
        void acceptProactiveSuggestion(v.suggestion);
      } else {
        setPaneState({ mode: "idle" });
      }
    }),
  );
  root.appendChild(actions);
}

function renderVerifyPdf(root: HTMLElement, v: VerifyPdf): void {
  const summary = document.createElement("p");
  summary.className = "verify-summary";
  const pagesSuffix = v.pages ? ` · ${v.pages} стр.` : "";
  summary.innerHTML = `<strong>${escapeHtml(v.title)}</strong><br/>${escapeHtml(v.fileName)}${escapeHtml(pagesSuffix)}`;
  root.appendChild(summary);

  const fields = document.createElement("div");
  fields.className = "verify-fields";
  const field = document.createElement("div");
  field.className = "verify-field";
  const label = document.createElement("div");
  label.className = "verify-field-label";
  label.textContent = "Фрагмент";
  const value = document.createElement("div");
  value.className = "verify-field-value";
  value.textContent = v.preview.length > 600 ? v.preview.slice(0, 600) + "…" : v.preview;
  field.append(label, value);
  fields.appendChild(field);
  root.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.append(
    makeButton("Закрыть", "btn btn-primary", () => setPaneState({ mode: "idle" })),
  );
  root.appendChild(actions);
}

// ---- success / error ----
function renderSuccessBody(root: HTMLElement, message: string): void {
  const wrap = document.createElement("div");
  wrap.className = "pane-success";
  wrap.innerHTML = `
    <div class="pane-success-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="pane-success-text">${escapeHtml(message)}</div>
  `;
  root.appendChild(wrap);
}

function renderErrorBody(root: HTMLElement, message: string): void {
  const wrap = document.createElement("div");
  wrap.className = "pane-error";
  const msg = document.createElement("div");
  msg.className = "pane-error-msg";
  msg.textContent = message;
  wrap.appendChild(msg);

  const actions = document.createElement("div");
  actions.className = "verify-actions";
  actions.append(makeButton("Закрыть", "btn btn-ghost", () => setPaneState({ mode: "idle" })));
  wrap.appendChild(actions);

  root.appendChild(wrap);
}

// ---- helpers ----
function makeButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function makeStat(value: string, label: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "verify-stat";
  el.innerHTML = `<span class="verify-stat-value">${escapeHtml(value)}</span><span class="verify-stat-label">${escapeHtml(label)}</span>`;
  return el;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleIdleAfter(ms: number): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (paneState.mode === "success") {
      setPaneState({ mode: "idle" });
    }
  }, ms);
}

// ------------------------------------------------------------------ //
// Short event stream                                                  //
// ------------------------------------------------------------------ //
function pushShortEvent(dot: DotKind, title: string, desc: string, ts?: string): void {
  const ev: ShortEvent = {
    id: newCorrelationId(),
    dot,
    title,
    desc,
    ts: ts ?? nowLabel(),
  };
  recentEvents = [ev, ...recentEvents].slice(0, MAX_VISIBLE_EVENTS);
  if (paneState.mode === "processing") {
    renderPane();
  }
}

function describeAgentEvent(ev: AgentEvent): { dot: DotKind; title: string; description: string } {
  switch (ev.type) {
    case "voice_captured":
      return {
        dot: "info",
        title: "Голос захвачен",
        description: `${ev.payload.durationMs} мс`,
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
        description: `${ev.payload.chars} симв.`,
      };
    case "utterance_normalized":
    case "text_normalized":
      return {
        dot: "info",
        title: "Нормализация",
        description: `${ev.payload.normalizedChars} симв.`,
      };
    case "context_attached": {
      const form = ev.payload.activeForm ? ` · ${ev.payload.activeForm}` : "";
      return {
        dot: "info",
        title: "Контекст получен",
        description: `${pageRu(ev.payload.currentPage)}${form}`,
      };
    }
    case "intent_parsed":
      return {
        dot: "info",
        title: "Интент распознан",
        description: intentKindRu(ev.payload.interpretation.intent.kind),
      };
    case "validation_passed":
      return {
        dot: "success",
        title: "Разбор выполнен",
        description: "Команда распознана",
      };
    case "validation_failed": {
      const errors = ev.payload.errors.slice(0, 2);
      const human = errors.map((e) => {
        if (e === "llm_api_key_missing") return "API-ключ не установлен";
        if (e === "llm_network_error") return "Сеть: нет связи";
        if (e === "llm_http_error") return "Ошибка LLM";
        if (e === "llm_empty_response") return "Пустой ответ";
        if (e === "llm_invalid_json") return "Некорректный JSON";
        if (e === "llm_parse_error") return "Ошибка разбора";
        if (e.startsWith("out_of_policy_value")) return "Вне политики";
        if (e === "normalize_failed") return "Ошибка нормализации";
        if (e === "field_not_on_current_page") return "Поле не на странице";
        return e;
      });
      return {
        dot: "error",
        title: "Ошибка",
        description: human.join("; "),
      };
    }
    case "confidence_evaluated": {
      const pct = Math.round(ev.payload.score * 100);
      return {
        dot: ev.payload.level === "low" ? "warning" : "info",
        title: "Уверенность",
        description: `${pct}%${ev.payload.requiresConfirmation ? " · нужно подтверждение" : ""}`,
      };
    }
    case "decision_made": {
      const label =
        ev.payload.decision === "execute"
          ? "Авто-выполнение"
          : ev.payload.decision === "confirm"
            ? "Требует подтверждения"
            : "Отклонено";
      return {
        dot:
          ev.payload.decision === "execute"
            ? "success"
            : ev.payload.decision === "confirm"
              ? "warning"
              : "error",
        title: "Решение",
        description: `${label} · ${Math.round(ev.payload.confidence * 100)}%`,
      };
    }
    case "action_plan_created":
      return {
        dot: "info",
        title: "План действий",
        description: `${intentKindRu(ev.payload.intentKind as IntentKind)}: ${ev.payload.actionCount} шаг.`,
      };
    case "dom_action_executed":
      return {
        dot: "success",
        title: "Применено",
        description:
          ev.payload.action.kind === "fill" ? ev.payload.action.field : ev.payload.action.kind,
      };
    case "dom_action_failed":
      return {
        dot: "error",
        title: "Не заполнено",
        description:
          ev.payload.action && ev.payload.action.kind === "fill"
            ? `Нет поля: ${ev.payload.action.field}`
            : ev.payload.error,
      };
    case "schedule_requested":
      return { dot: "info", title: "Расписание", description: "Запрос отправлен" };
    case "schedule_generated":
      return { dot: "success", title: "Расписание", description: "Сформировано" };
    case "user_confirmation_requested":
      return { dot: "warning", title: "Ожидание подтверждения", description: ev.payload.summary };
    case "user_confirmation_received":
      return {
        dot: ev.payload.accepted ? "success" : "warning",
        title: "Ответ врача",
        description: ev.payload.accepted ? "Подтверждено" : "Отклонено",
      };
    case "care_plan_created":
      return {
        dot: "info",
        title: "Назначение",
        description:
          ev.payload.type === "initial"
            ? `Первичный: ${ev.payload.service}`
            : `Курс: ${ev.payload.service} · ${ev.payload.sessionsCount}`,
      };
    case "care_plan_confirmed":
      return {
        dot: "success",
        title: "Назначение подтверждено",
        description: `${ev.payload.service} · ${ev.payload.sessionsCount} сеанс.`,
      };
    case "care_plan_expanded":
      return {
        dot: "success",
        title: "План лечения",
        description: `${ev.payload.sessionsCount} сеансов`,
      };
    case "session_completed":
      return {
        dot: "success",
        title: "Сеанс",
        description: `${ev.payload.service} · ${ev.payload.sessionNumber}/${ev.payload.totalSessions}`,
      };
    default: {
      const _exhaustive: never = ev;
      void _exhaustive;
      return { dot: "muted", title: "Событие", description: "—" };
    }
  }
}

function ingestAgentEvent(ev: AgentEvent): void {
  const d = describeAgentEvent(ev);
  pushShortEvent(d.dot, d.title, d.description, formatTime(ev.ts));

  // Transition into processing if something is happening and we were idle
  if (paneState.mode === "idle" && d.dot !== "error") {
    setPaneState({ mode: "processing" });
  }
}

// ------------------------------------------------------------------ //
// Verify triggers                                                     //
// ------------------------------------------------------------------ //
type ScheduleGeneratedPayload = Extract<AgentEvent, { type: "schedule_generated" }>["payload"];

const SCHEDULE_STATUS_LABEL: Readonly<Record<ScheduleGeneratedPayload["result"]["status"], string>> =
  Object.freeze({
    optimal: "Оптимум",
    feasible: "Готово",
    infeasible: "Не найдено",
    unknown: "Неизвестно",
  });

function enterVerifySchedule(payload: ScheduleGeneratedPayload): void {
  const result = payload.result;
  const assignments = Array.isArray(result.assignments) ? result.assignments : [];
  const uniqueDoctors = new Set<string>();
  for (const a of assignments) {
    if (typeof a.doctorId === "string" && a.doctorId.length > 0) uniqueDoctors.add(a.doctorId);
  }
  const days = typeof result.horizonDays === "number" && result.horizonDays > 0 ? result.horizonDays : 9;
  setPaneState({
    mode: "verify",
    content: {
      kind: "schedule",
      title: `Расписание на ${days} дней`,
      status: result.status,
      statusLabel: SCHEDULE_STATUS_LABEL[result.status] ?? result.status,
      days,
      assigned: assignments.length,
      specialists: uniqueDoctors.size,
    },
  });
}

function enterVerifyFill(
  correlationId: string,
  title: string,
  fields: Array<{ field: string; label?: string; value: string }>,
): void {
  setPaneState({
    mode: "verify",
    content: { kind: "fill", correlationId, title, fields },
  });
}

function enterVerifyConfirm(content: Omit<VerifyConfirm, "kind">): void {
  setPaneState({ mode: "verify", content: { kind: "confirm", ...content } });
}

function enterVerifyPdf(content: Omit<VerifyPdf, "kind">): void {
  setPaneState({ mode: "verify", content: { kind: "pdf", ...content } });
}

// ------------------------------------------------------------------ //
// Navigation / bridges                                                //
// ------------------------------------------------------------------ //
async function emitNavigateToSchedule(): Promise<void> {
  try {
    const raw = (await chrome.runtime.sendMessage({ type: "navigate_to_schedule" })) as
      | { ok: true }
      | { ok: false; error?: string }
      | undefined;
    if (raw && typeof raw === "object" && "ok" in raw && raw.ok === false) {
      pushShortEvent("warning", "Расписание", raw.error ?? "не удалось открыть");
      return;
    }
    pushShortEvent("info", "Расписание", "Открыто");
  } catch (err: unknown) {
    pushShortEvent("error", "Расписание", String(err));
  }
}

// ------------------------------------------------------------------ //
// Voice pipeline                                                      //
// ------------------------------------------------------------------ //
async function dispatchVoiceSegment(capture: VoiceCapturedEvent): Promise<void> {
  processingSegmentCount += 1;
  if (assistantMode === "listening") {
    setAssistantMode("processing");
  } else {
    renderAssistantMode();
  }
  if (paneState.mode !== "processing") setPaneState({ mode: "processing" });
  beginAsync();
  try {
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

    pushShortEvent("info", "Голос захвачен", `${capture.durationMs} мс`);

    if (!voiceRes.ok) {
      pushShortEvent("error", "Голосовой конвейер", voiceRes.error ?? "неизвестная ошибка");
      setPaneState({ mode: "error", message: voiceRes.error ?? "Ошибка обработки голоса" });
      return;
    }

    const vr = voiceRes.result;
    if (!vr?.accepted) {
      const message =
        vr?.step === "config"
          ? vr.error
          : vr?.step === "preprocess"
            ? `Предобработка: ${vr.error}`
            : vr?.step === "transcribe"
              ? `Транскрипция: ${vr.error}`
              : vr?.error ?? "Голос не распознан";
      pushShortEvent("error", "Голос", message);
      setPaneState({ mode: "error", message });
      return;
    }

    pushShortEvent("info", "Команда", vr.text);
    try {
      await chrome.runtime.sendMessage({
        type: "user_utterance",
        correlationId: capture.correlationId,
        text: vr.text,
        transcribedDurationMs: vr.durationMs,
      });
    } catch (err: unknown) {
      pushShortEvent("error", "Отправка", String(err));
    }
  } catch (err: unknown) {
    pushShortEvent("error", "Запись", String(err));
  } finally {
    endAsync();
    processingSegmentCount = Math.max(0, processingSegmentCount - 1);
    if (processingSegmentCount === 0 && recorder.isContinuous()) {
      setAssistantMode("listening");
    } else {
      updateHeaderState();
    }
  }
}

function describeMicError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/NotAllowed|Permission|denied|dismissed/i.test(raw)) return "Нет доступа к микрофону";
  if (/NotFound|device/i.test(raw)) return "Микрофон не найден";
  return raw;
}

async function activateAssistant(): Promise<void> {
  try {
    await recorder.startContinuous((segment) => {
      void dispatchVoiceSegment(segment);
    });
    setAssistantMode("listening");
  } catch (err: unknown) {
    log.error("activate failed", String(err));
    pushShortEvent("error", "Микрофон", describeMicError(err));
    setPaneState({ mode: "error", message: describeMicError(err) });
    setAssistantMode("inactive");
  }
}

async function deactivateAssistant(): Promise<void> {
  try {
    await recorder.stopContinuous();
  } catch (err: unknown) {
    log.error("deactivate failed", String(err));
    pushShortEvent("error", "Ассистент", String(err));
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
  setPaneState({ mode: "processing" });
  try {
    const correlationId = newCorrelationId();
    await chrome.runtime.sendMessage({ type: "user_utterance", correlationId, text });
    pushShortEvent("info", "Команда", text);
    if (utterEl) utterEl.value = "";
  } catch (err: unknown) {
    pushShortEvent("error", "Команда", String(err));
    setPaneState({ mode: "error", message: String(err) });
  } finally {
    endAsync();
  }
}

// ------------------------------------------------------------------ //
// Confirmation / proactive handlers                                   //
// ------------------------------------------------------------------ //
async function sendConfirmation(correlationId: string, accepted: boolean): Promise<void> {
  beginAsync();
  try {
    await chrome.runtime.sendMessage({ type: "user_confirmation", correlationId, accepted });
    pushShortEvent(
      accepted ? "success" : "warning",
      "Подтверждение",
      accepted ? "Разрешено" : "Отклонено",
    );
    if (accepted) {
      setPaneState({ mode: "success", message: "Действие подтверждено" });
      scheduleIdleAfter(1500);
    } else {
      setPaneState({ mode: "idle" });
    }
  } catch (err: unknown) {
    pushShortEvent("error", "Подтверждение", String(err));
    setPaneState({ mode: "error", message: String(err) });
  } finally {
    endAsync();
  }
}

async function handleFillDecision(correlationId: string, approved: boolean): Promise<void> {
  beginAsync();
  try {
    await chrome.runtime.sendMessage({ type: "user_confirmation", correlationId, accepted: approved });
    pushShortEvent(
      approved ? "success" : "warning",
      "Черновик",
      approved ? "Подтверждён" : "Отклонён",
    );
    if (approved) {
      setPaneState({ mode: "success", message: "Поля сохранены" });
      scheduleIdleAfter(1500);
    } else {
      setPaneState({ mode: "idle" });
    }
  } catch (err: unknown) {
    pushShortEvent("error", "Черновик", String(err));
    setPaneState({ mode: "error", message: String(err) });
  } finally {
    endAsync();
  }
}

async function acceptProactiveSuggestion(suggestion: ProactiveSuggestion): Promise<void> {
  if (suggestion === "suggest_exam_progress") {
    setPaneState({ mode: "idle" });
    return;
  }
  if (suggestion === "suggest_schedule") {
    const correlationId = newCorrelationId();
    void chrome.runtime
      .sendMessage({ type: "auto_schedule", correlationId })
      .then(() => pushShortEvent("info", "Расписание", "Авто-расписание"))
      .catch((err: unknown) => pushShortEvent("error", "Расписание", String(err)));
    setPaneState({ mode: "processing" });
    return;
  }
  if (suggestion === "suggest_build_schedule") {
    const correlationId = newCorrelationId();
    // Step 2 of the clinician-facing flow:
    //   decision → schedule building → result
    // Flip UI immediately so the user is never in a vague loading state.
    setScheduleProgress("generating");
    void chrome.runtime
      .sendMessage({ type: "build_schedule_from_plans", correlationId })
      .then(() => pushShortEvent("info", "Расписание", "Формирование"))
      .catch((err: unknown) => pushShortEvent("error", "Расписание", String(err)));
    return;
  }

  const text = SUGGESTION_ACCEPT_UTTERANCE[suggestion];
  beginAsync();
  setPaneState({ mode: "processing" });
  try {
    const correlationId = newCorrelationId();
    await chrome.runtime.sendMessage({ type: "user_utterance", correlationId, text });
    pushShortEvent("info", "Предложение", text);
  } catch (err: unknown) {
    pushShortEvent("error", "Предложение", String(err));
    setPaneState({ mode: "error", message: String(err) });
  } finally {
    endAsync();
  }
}

// ------------------------------------------------------------------ //
// Agent event stream listener                                         //
// ------------------------------------------------------------------ //
function isEventEnvelope(m: unknown): m is { type: "event"; event: AgentEvent } {
  if (m === null || typeof m !== "object") return false;
  const obj = m as { type?: unknown; event?: unknown };
  return obj.type === "event" && typeof obj.event === "object" && obj.event !== null;
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isEventEnvelope(msg)) return;
  const ev = msg.event;
  ingestAgentEvent(ev);

  if (ev.type === "context_attached") {
    lastAttachedContextPage = ev.payload.currentPage;
    headerContextPage = ev.payload.currentPage;
    headerContextForm = ev.payload.activeForm ?? null;
    const pid = (ev.payload as { patientId?: string; patientName?: string }).patientId;
    const pname = (ev.payload as { patientId?: string; patientName?: string }).patientName;
    if (pid && pid.length > 0) {
      headerPatientId = pid;
      uploadPatientId = pid;
      updatePatientBadge();
    }
    if (pname && pname.length > 0) headerPatientName = pname;
    else if (pid) headerPatientName = `ID ${pid.slice(0, 8)}`;
    renderHeader();
    onContextAttachedForExamProgress(ev.payload);
    return;
  }

  if (ev.type === "intent_parsed") {
    interpretationByCorrelation.set(ev.correlationId, ev.payload.interpretation);
    return;
  }

  if (ev.type === "decision_made") {
    const interp = interpretationByCorrelation.get(ev.correlationId);
    interpretationByCorrelation.delete(ev.correlationId);
    if (ev.payload.decision !== "execute" || !interp) return;

    if (interp.intent.kind === "navigate") {
      clearPrimaryExamFillProgressOnAgentNavigate();
      const suggestion = suggestNext("navigate");
      if (suggestion) {
        enterVerifyConfirm({
          title: `✓ ${SUGGESTION_TEXT[suggestion]}`,
          suggestion,
          acceptLabel: "Да",
          rejectLabel: "Пропустить",
        });
      }
      return;
    }

    if (interp.intent.kind === "schedule") {
      const suggestion = suggestNext("schedule");
      if (suggestion) {
        enterVerifyConfirm({
          title: `✓ ${SUGGESTION_TEXT[suggestion]}`,
          suggestion,
          acceptLabel: "Да",
          rejectLabel: "Пропустить",
        });
      }
      return;
    }

    if (interp.intent.kind === "fill") {
      const hint = afterPrimaryExamFillExecuted(interp.intent.slots, lastAttachedContextPage);
      if (hint.kind === "schedule") {
        enterVerifyConfirm({
          title: `✓ ${SUGGESTION_TEXT[hint.suggestion]}`,
          suggestion: hint.suggestion,
          acceptLabel: "Да",
          rejectLabel: "Пропустить",
        });
      } else if (hint.kind === "progress") {
        enterVerifyConfirm({
          title: `✓ ${hint.displayMessage}`,
          suggestion: hint.suggestion,
          acceptLabel: "Да",
          rejectLabel: "Пропустить",
        });
      }
    }
    return;
  }

  if (ev.type === "care_plan_confirmed") {
    // Step 1 of the clinician-facing flow: "Назначение подтверждено".
    // Show the phase momentarily so the user sees progress, then hand
    // over to the decision card that asks whether to build the schedule.
    setScheduleProgress("confirmed");
    const sessions = ev.payload.sessionsCount;
    const sessionsWord = pluralizeSessionsRu(sessions);
    setTimeout(() => {
      scheduleProgressPhase = null;
      enterVerifyConfirm({
        title: `Построить расписание на ${sessions} ${sessionsWord}?`,
        suggestion: "suggest_build_schedule",
        acceptLabel: "Построить",
        rejectLabel: "Отмена",
      });
    }, 900);
    return;
  }

  if (ev.type === "schedule_generated") {
    // Step 3: "Расписание готово" — a short confirming beat, then the
    // verify card where the clinician reviews and opens the schedule.
    setScheduleProgress("ready");
    const payload = ev.payload;
    setTimeout(() => {
      scheduleProgressPhase = null;
      enterVerifySchedule(payload);
    }, 700);
    return;
  }

  if (ev.type === "user_confirmation_requested") {
    const payload = ev.payload as {
      summary: string;
      draftFields?: Array<{ field: string; label?: string; value: string }>;
      intentKind?: string;
    };
    if (payload.draftFields && payload.draftFields.length > 0) {
      enterVerifyFill(ev.correlationId, payload.summary, payload.draftFields);
      return;
    }
    // Intent-specific button labels (clinician-facing, never technical).
    // The summary itself is already humanized by the controller.
    const labels = confirmButtonLabelsForIntent(payload.intentKind);
    enterVerifyConfirm({
      title: payload.summary,
      correlationId: ev.correlationId,
      acceptLabel: labels.accept,
      rejectLabel: labels.reject,
    });
  }
});

// ------------------------------------------------------------------ //
// Hotkey + push-to-talk                                               //
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
    pushShortEvent("info", "Ctrl/⌘+Shift+V", "Старт записи");
    await activateAssistant();
  } else {
    pushShortEvent("info", "Ctrl/⌘+Shift+V", "Стоп записи");
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
  if (assistantMode !== "inactive") return;
  e.preventDefault();
  pttOwnsRecording = true;
  pushShortEvent("info", "Push-to-talk", "Space — запись");
  void activateAssistant();
});

window.addEventListener("keyup", (e: KeyboardEvent) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (!pttOwnsRecording) return;
  pttOwnsRecording = false;
  e.preventDefault();
  void deactivateAssistant();
});

window.addEventListener("blur", () => {
  if (!pttOwnsRecording) return;
  pttOwnsRecording = false;
  void deactivateAssistant();
});

// ------------------------------------------------------------------ //
// Boot                                                                //
// ------------------------------------------------------------------ //
renderHeader();
renderAssistantMode();
renderPane();

// ------------------------------------------------------------------ //
// File upload — patient vs reusable scopes                            //
// ------------------------------------------------------------------ //
const patientUploadDropzoneEl = document.getElementById("patientUploadDropzone") as HTMLDivElement | null;
const patientUploadFileInputEl = document.getElementById("patientUploadFileInput") as HTMLInputElement | null;
const patientUploadFileListEl = document.getElementById("patientUploadFileList") as HTMLDivElement | null;

const reusableUploadDropzoneEl = document.getElementById("reusableUploadDropzone") as HTMLDivElement | null;
const reusableUploadFileInputEl = document.getElementById("reusableUploadFileInput") as HTMLInputElement | null;
const reusableUploadFileListEl = document.getElementById("reusableUploadFileList") as HTMLDivElement | null;

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
  parsedText?: string;
  pages?: number;
};

const fileChips = new Map<string, FileChipState>();

function updatePatientBadge(): void {
  if (patientUploadDropzoneEl) {
    patientUploadDropzoneEl.style.opacity = uploadPatientId ? "1" : "0.75";
  }
}

async function attemptFetchFreshPatientContext(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return undefined;
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "extract_page_context" })) as {
      ok?: boolean;
      context?: { patientId?: string };
    };
    if (res?.ok && res.context?.patientId) {
      uploadPatientId = res.context.patientId;
      headerPatientId = uploadPatientId;
      updatePatientBadge();
      renderHeader();
      return uploadPatientId;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function showPatientUploadFallback(files?: FileList | File[]) {
  if (files) pendingFallbackFiles = Array.from(files);
  else pendingFallbackFiles = null;
  patientUploadFallbackEl?.classList.remove("hidden");
}

function hidePatientUploadFallback() {
  pendingFallbackFiles = null;
  patientUploadFallbackEl?.classList.add("hidden");
}

btnOpenPatientEl?.addEventListener("click", () => {
  void (async () => {
    hidePatientUploadFallback();
    const files = pendingFallbackFiles;
    pendingFallbackFiles = null;

    const res = (await chrome.runtime.sendMessage({ type: "navigate_to_diary" })) as { ok?: boolean };
    if (!res?.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 600));
    const id = await attemptFetchFreshPatientContext();

    if (id && id !== "unknown") {
      pushShortEvent("success", "Пациент", "Профиль открыт");
      if (files && files.length > 0) {
        for (const file of files) void handleFileUpload(file, "patient");
      }
    } else {
      pushShortEvent("error", "Пациент", "Не удалось определить");
    }
  })();
});

btnUploadAsTemplateEl?.addEventListener("click", () => {
  const files = pendingFallbackFiles;
  hidePatientUploadFallback();
  if (files && files.length > 0) {
    for (const file of files) void handleFileUpload(file, "reusable");
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

  const tag = document.createElement("span");
  tag.className = `file-chip-tag ${extType}`;
  tag.textContent = extType.toUpperCase();

  const name = document.createElement("span");
  name.className = "file-chip-name";
  name.textContent = chip.name;

  const status = document.createElement("span");
  status.className = `file-chip-status ${chip.status}`;
  status.textContent =
    chip.status === "parsing" ? "…" : chip.status === "done" ? formatFileSize(chip.sizeBytes) : "ошибка";
  if (chip.errorMsg) status.title = chip.errorMsg;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "file-chip-remove";
  remove.title = "Удалить";
  remove.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    fileChips.delete(chip.id);
    el.remove();
  });

  // Clicking chip opens verify-pdf preview
  el.addEventListener("click", () => {
    if (chip.status !== "done" || !chip.parsedText) return;
    enterVerifyPdf({
      title: chip.scope === "patient" ? "Файл пациента" : "Шаблон",
      assetId: chip.assetId ?? "",
      fileName: chip.name,
      pages: chip.pages,
      preview: chip.parsedText,
    });
  });

  el.append(tag, name, status, remove);
  return el;
}

function updateFileChipStatus(
  chipId: string,
  status: FileChipState["status"],
  errorMsg?: string,
  assetId?: string,
): void {
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
    statusEl.textContent =
      status === "parsing" ? "…" : status === "done" ? formatFileSize(chip.sizeBytes) : "ошибка";
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
      pushShortEvent("error", "Файл пациента", "Пациент не определён");
      showPatientUploadFallback([file]);
      return;
    }
  }

  const mimeType = inferMimeType(file);
  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();

  if (!ACCEPTED_MIME_TYPES.has(normalizedMime) && !ACCEPTED_MIME_TYPES.has(mimeType)) {
    pushShortEvent("error", "Файл", `Формат не поддерживается: ${file.name}`);
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    pushShortEvent("error", "Файл", `Превышен лимит ${formatFileSize(MAX_FILE_SIZE_BYTES)}`);
    return;
  }

  if (uploadedFileCount >= MAX_FILES_PER_SESSION) {
    pushShortEvent("warning", "Файл", `Лимит файлов достигнут`);
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

  if (isPatient) patientUploadFileListEl?.prepend(chipEl);
  else reusableUploadFileListEl?.prepend(chipEl);

  pushShortEvent("info", "Файл", `Обработка: ${file.name}`);

  try {
    const buffer = await file.arrayBuffer();
    const parseResult = await parseFile(buffer, file.name, normalizedMime);

    if (!parseResult.ok) {
      updateFileChipStatus(chipId, "error", parseResult.error);
      pushShortEvent("error", "Файл", parseResult.error);
      return;
    }

    chip.parsedText = parseResult.text;
    chip.pages = parseResult.pageCount;

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

    const response = (await chrome.runtime.sendMessage(payload)) as
      | { ok: boolean; assetId?: string; error?: string }
      | undefined;

    if (response?.ok && response.assetId) {
      updateFileChipStatus(chipId, "done", undefined, response.assetId);
      pushShortEvent(
        "success",
        isPatient ? "Файл пациента" : "Шаблон",
        `${file.name}${parseResult.pageCount ? ` · ${parseResult.pageCount} стр.` : ""}`,
      );
      // Auto-enter PDF verify preview so the clinician can check extracted text
      enterVerifyPdf({
        title: isPatient ? "Файл пациента загружен" : "Шаблон загружен",
        assetId: response.assetId,
        fileName: file.name,
        pages: parseResult.pageCount,
        preview: parseResult.text,
      });
    } else {
      const errorMsg = response?.error ?? "unknown_error";
      updateFileChipStatus(chipId, "error", errorMsg);
      pushShortEvent("error", isPatient ? "Файл пациента" : "Шаблон", errorMsg);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateFileChipStatus(chipId, "error", errorMsg);
    pushShortEvent("error", "Файл", `${file.name}: ${errorMsg}`);
  }
}

function setupDropzone(
  dropzoneEl: HTMLElement | null,
  inputEl: HTMLInputElement | null,
  scope: "patient" | "reusable",
) {
  if (!dropzoneEl || !inputEl) return;

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

  inputEl.addEventListener("change", () => {
    const files = inputEl.files;
    if (files && files.length > 0) {
      for (const file of files) void handleFileUpload(file, scope);
      inputEl.value = "";
    }
  });

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
      for (const file of files) void handleFileUpload(file, scope);
    })();
  });
}

setupDropzone(patientUploadDropzoneEl, patientUploadFileInputEl, "patient");
setupDropzone(reusableUploadDropzoneEl, reusableUploadFileInputEl, "reusable");

// Make headerPatientId consumed so ts --strict doesn't warn about unused
void headerPatientId;
