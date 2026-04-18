import { z } from "zod";

/**
 * Descriptor for a single `[data-field]` element on the currently visible page.
 *
 * This is the **only** per-element shape that may cross the content-script →
 * controller boundary. It deliberately excludes `innerHTML`, `outerHTML`,
 * `textContent`, and any other raw DOM content.
 */
export const PageFieldDescriptor = z.object({
  /** Value of the `data-field` attribute. */
  field: z.string().min(1),
  /** Lowercase tag name (`input`, `textarea`, `select`, …). */
  tag: z.string().min(1),
  /** `placeholder` attribute value (empty string when absent). */
  placeholder: z.string(),
  /** Nearest visible label text (empty string when none found). */
  label: z.string(),
});
export type PageFieldDescriptor = z.infer<typeof PageFieldDescriptor>;

/**
 * Normalized, policy-approved snapshot of the **currently visible page**.
 *
 * Hard policy invariants:
 *   1. Derived exclusively from the active tab's visible DOM — never from
 *      cached / stored / retrieved content.
 *   2. Does **not** contain `innerHTML`, `outerHTML`, raw `textContent`,
 *      or any unrestricted DOM snapshot.
 *   3. `url` is a path-only slug (no origin, no query, no fragment).
 *   4. `availableFields` is capped to prevent DoS from pathological pages.
 *   5. `extractedAt` proves recency; consumers may apply staleness checks.
 *
 * Produced by the content script (`content/page-context-extractor.ts`).
 * Validated by the controller via `PageContext.safeParse()` before use.
 */
export const PageContext = z.object({
  /** Normalized URL path slug of the visible page (e.g. `"primary_exam"`). Max 256 chars. */
  url: z.string().max(256),

  /** Logical page identifier derived from the URL (e.g. `"primary_exam"`, `"schedule"`). */
  currentPage: z.string().min(1),

  /** Active form section identifier, if any. */
  activeForm: z.string().min(1).optional(),

  /** Current patient ID, read from the host page's state. */
  patientId: z.string().min(1).optional(),

  /** Current patient display name, read from the host page's state. */
  patientName: z.string().min(1).optional(),

  /**
   * `[data-field]` elements on the page, deduped by `field`.
   * Capped at 200 to bound payload size.
   */
  availableFields: z.array(PageFieldDescriptor).max(200),

  /** ISO-8601 timestamp of when this snapshot was extracted. */
  extractedAt: z.string().datetime({ offset: true }),
});
export type PageContext = z.infer<typeof PageContext>;
