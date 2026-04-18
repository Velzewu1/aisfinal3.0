import { z } from "zod";
import { IsoTimestamp } from "./common.js";

// ------------------------------------------------------------------ //
// Knowledge / Assets layer — contracts                               //
//                                                                    //
// These schemas define the cross-layer shape for knowledge assets     //
// that enrich the reasoning pipeline. They are STRICTLY SEPARATE      //
// from PageContext (which reflects the currently visible page).        //
//                                                                    //
// Policy invariants:                                                  //
//   1. Knowledge assets are READ-ONLY supporting context.             //
//   2. They NEVER approve actions, mutate DOM, or bypass validation.  //
//   3. `content` is capped plain text — never raw HTML.               //
//   4. Supabase is NOT used for knowledge storage (audit only).       //
// ------------------------------------------------------------------ //

/**
 * Asset scope discriminator.
 *
 * - `patient` — runtime, session/case-scoped data for the current patient.
 * - `reusable` — clinic-wide templates, presets, and seeded examples.
 */
export const AssetScope = z.enum(["patient", "reusable"]);
export type AssetScope = z.infer<typeof AssetScope>;

// ------------------------------------------------------------------ //
// Shared metadata                                                     //
// ------------------------------------------------------------------ //

/** Base metadata common to all knowledge asset types. */
export const AssetMetadata = z.object({
  /** Unique asset identifier (UUID or deterministic slug). */
  id: z.string().min(1).max(128),

  /** Scope discriminator. */
  scope: AssetScope,

  /** Human-readable label for audit/display. */
  label: z.string().min(1).max(256),

  /** Free-form tags for filtering (max 20, each ≤ 64 chars). */
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),

  /** ISO-8601 creation timestamp. */
  createdAt: IsoTimestamp,

  /** Optional expiry — consumers may ignore stale assets. */
  expiresAt: IsoTimestamp.optional(),
});
export type AssetMetadata = z.infer<typeof AssetMetadata>;

// ------------------------------------------------------------------ //
// Patient-scoped assets                                               //
// ------------------------------------------------------------------ //

/**
 * Content types for patient-scoped assets.
 *
 * These represent runtime data relevant to the current patient/case.
 * They are supporting context only — they never drive execution.
 */
export const PatientContentType = z.enum([
  "diagnosis_history",
  "allergy_snapshot",
  "treatment_plan",
  "observation_note",
  "custom",
]);
export type PatientContentType = z.infer<typeof PatientContentType>;

/**
 * Patient-scoped runtime asset.
 *
 * Bound to a specific `patientId` and optionally to a `sessionId`.
 * Examples: prior diagnoses carried forward, allergy lists, current
 * treatment plans from the HIS, clinician observation notes.
 *
 * Scope classification rule:
 *   An asset is `patient`-scoped when its relevance is limited to a
 *   single patient's case. It becomes stale when the session/patient
 *   changes and should be discarded or refreshed.
 */
export const PatientContextAsset = AssetMetadata.extend({
  scope: z.literal("patient"),

  /** The patient this asset belongs to. */
  patientId: z.string().min(1),

  /** Optional session binding for lifecycle management. */
  sessionId: z.string().min(1).optional(),

  /** Content category. */
  contentType: PatientContentType,

  /**
   * Plain-text content — never raw HTML, never unrestricted DOM.
   * Capped at 8000 characters to bound prompt budget.
   */
  content: z.string().max(8000),
});
export type PatientContextAsset = z.infer<typeof PatientContextAsset>;

// ------------------------------------------------------------------ //
// Reusable assets (clinic-wide)                                       //
// ------------------------------------------------------------------ //

/**
 * Content types for reusable assets.
 *
 * These represent clinic-wide templates, presets, and reference data
 * that are not patient-specific.
 */
export const ReusableContentType = z.enum([
  "form_template",
  "phrase_preset",
  "field_default",
  "protocol_snippet",
  "custom",
]);
export type ReusableContentType = z.infer<typeof ReusableContentType>;

/**
 * Reusable clinic-wide asset.
 *
 * Not bound to any patient. Examples: standard phrase templates for
 * epicrisis, default field values for common diagnoses, protocol
 * snippets, form-fill presets.
 *
 * Scope classification rule:
 *   An asset is `reusable` when it applies across patients and
 *   sessions. It persists until explicitly updated or deleted.
 */
export const ReusableAsset = AssetMetadata.extend({
  scope: z.literal("reusable"),

  /** Content category. */
  contentType: ReusableContentType,

  /**
   * Plain-text content — never raw HTML, never unrestricted DOM.
   * Capped at 8000 characters to bound prompt budget.
   */
  content: z.string().max(8000),
});
export type ReusableAsset = z.infer<typeof ReusableAsset>;

// ------------------------------------------------------------------ //
// Discriminated union                                                 //
// ------------------------------------------------------------------ //

/**
 * Any knowledge asset — discriminated on `scope`.
 *
 * Used as the element type in `RetrievedContext.assets`.
 */
export const KnowledgeAsset = z.discriminatedUnion("scope", [
  PatientContextAsset,
  ReusableAsset,
]);
export type KnowledgeAsset = z.infer<typeof KnowledgeAsset>;

// ------------------------------------------------------------------ //
// Retrieved context envelope                                          //
// ------------------------------------------------------------------ //

/**
 * The assembled knowledge context passed to the reasoning layer.
 *
 * Conceptually, reasoning input = utterance + PageContext + RetrievedContext.
 * `PageContext` is current-page-only (live DOM extraction).
 * `RetrievedContext` is stored/preloaded knowledge from the assets layer.
 * These two are NEVER merged.
 *
 * Constraints:
 *   - Max 10 assets per reasoning call (prompt budget).
 *   - Assets are read-only — they never approve actions.
 *   - `retrievedAt` proves recency for staleness checks.
 */
export const RetrievedContext = z.object({
  /** Knowledge assets selected for this reasoning call. Max 10. */
  assets: z.array(KnowledgeAsset).max(10),

  /** ISO-8601 timestamp of when retrieval/assembly occurred. */
  retrievedAt: IsoTimestamp,
});
export type RetrievedContext = z.infer<typeof RetrievedContext>;
