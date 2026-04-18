import {
  KnowledgeAsset,
  RetrievedContext,
  type KnowledgeAsset as KnowledgeAssetType,
  type PatientContextAsset,
  type ReusableAsset,
  type RetrievedContext as RetrievedContextType,
} from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("knowledge");

// ------------------------------------------------------------------ //
// Knowledge / Assets — scope-aware in-memory registry                 //
//                                                                    //
// This module provides minimal scaffolding for knowledge asset        //
// registration and retrieval-context assembly. It is strictly an      //
// enrichment layer:                                                   //
//   - Never touches DOM.                                              //
//   - Never approves actions or decides plans.                        //
//   - Never calls the LLM, executor, or backend.                     //
//   - Never bypasses controller validation/policy.                    //
//                                                                    //
// Assets are stored in memory only (no persistence in this patch).    //
// Supabase is NOT used for knowledge storage — it remains audit-only. //
// ------------------------------------------------------------------ //

/** Max assets per retrieval call (mirrors Zod cap on RetrievedContext). */
const MAX_RETRIEVED_ASSETS = 10;

/** In-memory asset store — keyed by `asset.id`. No persistence. */
const store = new Map<string, KnowledgeAssetType>();

// ------------------------------------------------------------------ //
// Public API                                                          //
// ------------------------------------------------------------------ //

/**
 * Register a knowledge asset.
 *
 * The asset is validated through `KnowledgeAsset.safeParse()` before
 * being accepted. Invalid or oversized payloads are rejected.
 *
 * @returns `{ ok: true }` on success, `{ ok: false, error }` on validation failure.
 */
export function registerAsset(
  raw: unknown,
): { ok: true; asset: KnowledgeAssetType } | { ok: false; error: string } {
  const parsed = KnowledgeAsset.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`)
      .join(", ");
    log.warn("asset registration rejected", { issues });
    return { ok: false, error: `invalid_asset: ${issues}` };
  }

  const asset = parsed.data;
  store.set(asset.id, asset);
  log.info("asset registered", {
    id: asset.id,
    scope: asset.scope,
    label: asset.label,
  });
  return { ok: true, asset };
}

/**
 * Get all patient-scoped assets for a given patient ID.
 *
 * Assets that have expired (past `expiresAt`) are excluded.
 */
export function getPatientAssets(patientId: string): PatientContextAsset[] {
  const now = Date.now();
  const result: PatientContextAsset[] = [];
  for (const asset of store.values()) {
    if (asset.scope !== "patient") continue;
    if (asset.patientId !== patientId) continue;
    if (asset.expiresAt && new Date(asset.expiresAt).getTime() < now) continue;
    result.push(asset);
  }
  return result;
}

/**
 * Get all reusable (clinic-wide) assets.
 *
 * Assets that have expired (past `expiresAt`) are excluded.
 */
export function getReusableAssets(): ReusableAsset[] {
  const now = Date.now();
  const result: ReusableAsset[] = [];
  for (const asset of store.values()) {
    if (asset.scope !== "reusable") continue;
    if (asset.expiresAt && new Date(asset.expiresAt).getTime() < now) continue;
    result.push(asset);
  }
  return result;
}

/**
 * Remove a single asset by ID.
 *
 * @returns `true` if the asset existed and was removed.
 */
export function removeAsset(id: string): boolean {
  const removed = store.delete(id);
  if (removed) log.info("asset removed", { id });
  return removed;
}

/**
 * Assemble a `RetrievedContext` for the reasoning layer.
 *
 * Combines patient-scoped assets (when `patientId` is provided) with
 * reusable assets, capped at {@link MAX_RETRIEVED_ASSETS}. Patient
 * assets are prioritized over reusable ones.
 *
 * The returned object is validated through `RetrievedContext.safeParse()`
 * to guarantee contract compliance before it reaches the LLM prompt.
 *
 * @returns Validated `RetrievedContext`, or `undefined` if assembly
 *          fails validation (should never happen with well-formed store
 *          entries, but we validate defensively).
 */
export function assembleRetrievedContext(
  patientId?: string,
): RetrievedContextType | undefined {
  const patientAssets = patientId ? getPatientAssets(patientId) : [];
  const reusableAssets = getReusableAssets();

  // Patient assets first (higher specificity), then reusable, capped.
  const combined: KnowledgeAssetType[] = [
    ...patientAssets,
    ...reusableAssets,
  ].slice(0, MAX_RETRIEVED_ASSETS);

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
    log.warn("retrieved context assembly failed validation", { issues });
    return undefined;
  }

  log.info("retrieved context assembled", {
    patientAssetCount: patientAssets.length,
    reusableAssetCount: reusableAssets.length,
    totalReturned: parsed.data.assets.length,
  });

  return parsed.data;
}

/**
 * Clear all assets from the in-memory store.
 * Intended for session reset and test teardown.
 */
export function clear(): void {
  const count = store.size;
  store.clear();
  log.info("asset store cleared", { removedCount: count });
}

/**
 * Get asset store size (for diagnostics).
 */
export function size(): number {
  return store.size;
}
