import { createLogger } from "../shared/logger.js";

const log = createLogger("content.extractor");

/**
 * Page-slug map: URL pathname filename → logical page id.
 *
 * Must stay aligned with the mock-ui filenames and the controller's
 * `ALLOWED_NAV_TARGETS` allowlist. Changes here are integration-level;
 * the executor and schema layers are unaffected.
 */
const PAGE_BY_FILE: Readonly<Record<string, string>> = {
  "index.html": "patient_list",
  "": "patient_list",
  "primary_exam.html": "primary_exam",
  "epicrisis.html": "epicrisis",
  "diary.html": "diary",
  "schedule.html": "schedule",
};

/** Maximum number of field descriptors returned (DoS guard). */
const MAX_FIELDS = 200;

/**
 * Read-only, synchronous extraction of the current page context.
 *
 * This function is the content script's **context-extraction role**.
 * It runs in the same JS realm as the host page but:
 *   - Never mutates the DOM.
 *   - Never reads `innerHTML`, `outerHTML`, or `textContent` from
 *     arbitrary elements. Only approved `data-*` attributes, tag names,
 *     `placeholder`, and nearby `<label>` / `<th>` text are read.
 *   - Returns a plain serializable object (no DOM nodes, no functions).
 *
 * The returned shape matches `PageContext` from `@ai-rpa/schemas`;
 * the controller validates it through `PageContext.safeParse()`.
 */
export function extractCurrentPageContext(): {
  url: string;
  currentPage: string;
  activeForm?: string;
  patientId?: string;
  patientName?: string;
  availableFields: Array<{
    field: string;
    tag: string;
    placeholder: string;
    label: string;
  }>;
  extractedAt: string;
} {
  // 1. URL slug (path only — no origin, no query, no fragment).
  const rawPath = window.location.pathname ?? "";
  const filename = rawPath.split("/").pop() ?? "";
  const url = filename.length > 0 ? filename : rawPath;

  // 2. Logical page id.
  const currentPage = PAGE_BY_FILE[filename] ?? filename;

  // 3. Patient snapshot (read from Document dataset as bridge).
  let patientId = document.documentElement.dataset.patientId;
  let patientName = document.documentElement.dataset.patientName;

  if (!patientId || patientId.trim() === "") {
    patientId = undefined;
  }
  if (!patientName || patientName.trim() === "") {
    patientName = undefined;
  }

  // 4. Available [data-field] elements (deduped, capped).
  const seen = new Set<string>();
  const availableFields: Array<{
    field: string;
    tag: string;
    placeholder: string;
    label: string;
  }> = [];

  for (const el of document.querySelectorAll("[data-field]")) {
    if (!(el instanceof HTMLElement)) continue;
    const field = el.dataset.field;
    if (field === undefined || field.length === 0) continue;
    if (seen.has(field)) continue;
    seen.add(field);

    if (availableFields.length >= MAX_FIELDS) break;

    const tag = el.tagName.toLowerCase();
    const placeholder =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.placeholder
        : "";
    const row = el.closest(".form-group, .field-wrapper, tr");
    const labelEl = row?.querySelector("label, th");
    const label = labelEl?.textContent?.trim() ?? "";

    availableFields.push({ field, tag, placeholder, label });
  }

  // 4b. Active form detection — find visible form/section container.
  //     Precedence: [data-form] > form[id] > [data-section] > undefined.
  let activeForm: string | undefined;
  const dataFormEl = document.querySelector<HTMLElement>("[data-form]");
  if (dataFormEl && dataFormEl.dataset.form) {
    activeForm = dataFormEl.dataset.form;
  } else {
    const formEl = document.querySelector<HTMLFormElement>("form[id]");
    if (formEl && formEl.id) {
      activeForm = formEl.id;
    } else {
      const sectionEl = document.querySelector<HTMLElement>("[data-section]");
      if (sectionEl && sectionEl.dataset.section) {
        activeForm = sectionEl.dataset.section;
      }
    }
  }

  // 5. Extraction timestamp.
  const extractedAt = new Date().toISOString();

  log.info("page context extracted", {
    url,
    currentPage,
    activeForm: activeForm ?? null,
    fieldCount: availableFields.length,
  });

  return {
    url,
    currentPage,
    ...(activeForm !== undefined ? { activeForm } : {}),
    ...(patientId !== undefined ? { patientId } : {}),
    ...(patientName !== undefined ? { patientName } : {}),
    availableFields,
    extractedAt,
  };
}
