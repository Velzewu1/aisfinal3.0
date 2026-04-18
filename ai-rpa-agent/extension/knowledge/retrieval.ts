import type { ReusableAsset, RetrievedContext as RetrievedContextType } from "@ai-rpa/schemas";
import { RetrievedContext } from "@ai-rpa/schemas";
import { getReusableAssets, getPatientAssets } from "./index.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("knowledge.retrieval");

// ------------------------------------------------------------------ //
// Reusable asset retrieval — lightweight, tag-based selection.        //
//                                                                    //
// This module selects relevant reusable assets for the reasoning      //
// layer using simple tag/metadata matching — no vector search,        //
// no embeddings, no model fine-tuning.                                //
//                                                                    //
// Retrieval signals:                                                  //
//   - documentType  → matches tags like "primary_exam", "epicrisis"  //
//   - diagnosis     → matches tags like "g93.2", "cerebral_palsy"    //
//   - specialty     → matches tags like "lkf", "psychologist"        //
//   - contentType   → matches asset.contentType directly             //
//                                                                    //
// Policy:                                                             //
//   - Reusable assets are STYLE/TEMPLATE guidance — never factual    //
//     truth about the current patient.                                //
//   - Retrieved assets are read-only context that enriches the LLM   //
//     prompt. They never approve actions or bypass validation.        //
//   - Patient-scoped assets are combined separately and always have   //
//     higher priority in the final RetrievedContext bundle.           //
// ------------------------------------------------------------------ //

/** Maximum reusable assets per retrieval call. */
const MAX_REUSABLE_IN_BUNDLE = 6;

/** Maximum patient assets per retrieval call. */
const MAX_PATIENT_IN_BUNDLE = 4;

/** Total cap (must match RetrievedContext.assets.max(10)). */
const MAX_TOTAL = 10;

/**
 * Retrieval query signals.
 *
 * All fields are optional — omitting a field means "don't filter on it".
 * When multiple fields are set, assets matching more signals rank higher.
 */
export interface RetrievalQuery {
  /** Current document/page type (e.g. "primary_exam", "epicrisis", "diary"). */
  readonly documentType?: string;
  /** Current diagnosis code or keyword (e.g. "g93.2", "cerebral_palsy"). */
  readonly diagnosis?: string;
  /** Current specialty context (e.g. "lkf", "psychologist", "speech"). */
  readonly specialty?: string;
  /** Filter by asset content type. */
  readonly contentType?: ReusableAsset["contentType"];
  /** Current patient ID — used to include patient-scoped assets. */
  readonly patientId?: string;
}

/**
 * Score a reusable asset against a retrieval query.
 *
 * Returns a relevance score ∈ [0, N] where N is the number of matching
 * signals. Higher = more relevant. Score 0 means no match on any signal,
 * but the asset may still be included as general context if there's space.
 */
function scoreReusableAsset(asset: ReusableAsset, query: RetrievalQuery): number {
  let score = 0;
  const tagsLower = asset.tags.map((t) => t.toLowerCase());
  const labelLower = asset.label.toLowerCase();

  // Document type match (tag or label contains the documentType)
  if (query.documentType) {
    const dt = query.documentType.toLowerCase();
    if (tagsLower.some((t) => t === dt || t.includes(dt)) || labelLower.includes(dt)) {
      score += 3; // Strong signal — document type is the most important filter
    }
  }

  // Content type match
  if (query.contentType && asset.contentType === query.contentType) {
    score += 2;
  }

  // Diagnosis match (tag contains diagnosis code or keyword)
  if (query.diagnosis) {
    const dx = query.diagnosis.toLowerCase();
    if (tagsLower.some((t) => t === dx || t.includes(dx))) {
      score += 2;
    }
  }

  // Specialty match
  if (query.specialty) {
    const sp = query.specialty.toLowerCase();
    if (tagsLower.some((t) => t === sp || t.includes(sp)) || labelLower.includes(sp)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Retrieve relevant reusable assets for a given query.
 *
 * Returns assets sorted by relevance score (descending), capped at
 * {@link MAX_REUSABLE_IN_BUNDLE}. Assets with score 0 are included only
 * if they have a "general" tag or if there's remaining capacity.
 */
export function retrieveReusableAssets(query: RetrievalQuery): ReusableAsset[] {
  const all = getReusableAssets();
  if (all.length === 0) return [];

  // Score and sort
  const scored = all.map((asset) => ({
    asset,
    score: scoreReusableAsset(asset, query),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Take top matches. Include zero-score assets only if they have "general" tag.
  const result: ReusableAsset[] = [];
  for (const { asset, score } of scored) {
    if (result.length >= MAX_REUSABLE_IN_BUNDLE) break;
    if (score > 0) {
      result.push(asset);
    } else if (asset.tags.some((t) => t.toLowerCase() === "general")) {
      result.push(asset); // General-purpose assets are always welcome
    }
  }

  log.info("reusable assets retrieved", {
    query: {
      documentType: query.documentType,
      diagnosis: query.diagnosis,
      specialty: query.specialty,
      contentType: query.contentType,
    },
    totalAvailable: all.length,
    returned: result.length,
  });

  return result;
}

/**
 * Assemble a complete `RetrievedContext` bundle for the reasoning layer.
 *
 * Combines:
 *   1. Patient-scoped assets (higher priority, max {@link MAX_PATIENT_IN_BUNDLE})
 *   2. Reusable assets filtered by query (max {@link MAX_REUSABLE_IN_BUNDLE})
 *
 * The two pools are kept conceptually separate:
 *   - Patient assets = factual context about the current case.
 *   - Reusable assets = style/template guidance, not patient facts.
 *
 * The output is validated through `RetrievedContext.safeParse()`.
 */
export function assembleFilteredContext(
  query: RetrievalQuery,
): RetrievedContextType | undefined {
  const patientAssets = query.patientId
    ? getPatientAssets(query.patientId).slice(0, MAX_PATIENT_IN_BUNDLE)
    : [];

  const reusableAssets = retrieveReusableAssets(query);

  // Combine: patient first (factual), then reusable (guidance), cap total.
  const combined = [...patientAssets, ...reusableAssets].slice(0, MAX_TOTAL);

  if (combined.length === 0) {
    log.info("no assets to assemble");
    return undefined;
  }

  const raw = {
    assets: combined,
    retrievedAt: new Date().toISOString(),
  };

  const parsed = RetrievedContext.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`)
      .join(", ");
    log.warn("filtered context validation failed", { issues });
    return undefined;
  }

  log.info("filtered context assembled", {
    patientCount: patientAssets.length,
    reusableCount: reusableAssets.length,
    total: parsed.data.assets.length,
    // Debug: which patient assets were included (confirms file→retrieval linkage)
    patientLabels: patientAssets.map((a) => a.label),
    reusableLabels: reusableAssets.map((a) => a.label),
  });

  return parsed.data;
}
