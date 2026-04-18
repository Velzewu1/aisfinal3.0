import { createLogger } from "../shared/logger.js";

const log = createLogger("knowledge.file-parser");

// ------------------------------------------------------------------ //
// File parser — lightweight text extraction for PDF and plain text.   //
//                                                                    //
// No OCR, no model fine-tuning, no heavy document processing.        //
// PDF extraction uses pdf.js (pdfjs-dist) in the sidepanel context.  //
// Plain text is decoded as UTF-8.                                     //
//                                                                    //
// This module never touches DOM, never mutates host page, never      //
// calls the LLM or backend.                                          //
// ------------------------------------------------------------------ //

/** Maximum content length (matches PatientContextAsset.content cap). */
const MAX_CONTENT_LENGTH = 8000;

/** Maximum file size in bytes (5 MB). */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum files per session. */
export const MAX_FILES_PER_SESSION = 10;

/** Accepted MIME types. */
export const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/plain; charset=utf-8",
]);

export type ParseResult =
  | { ok: true; text: string; pageCount?: number; truncated: boolean }
  | { ok: false; error: string };

/**
 * Parse a file buffer into normalized plain text.
 *
 * Dispatches to the appropriate parser based on MIME type.
 * Content is always normalized and capped at {@link MAX_CONTENT_LENGTH}.
 */
export async function parseFile(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<ParseResult> {
  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();

  if (normalizedMime === "text/plain") {
    return parsePlainText(buffer, filename);
  }

  if (normalizedMime === "application/pdf") {
    return parsePdf(buffer, filename);
  }

  return { ok: false, error: `unsupported_mime_type: ${normalizedMime}` };
}

/**
 * Parse a plain text file.
 */
export function parsePlainText(buffer: ArrayBuffer, filename: string): ParseResult {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const raw = decoder.decode(buffer);
    const normalized = normalizeContent(raw);

    if (normalized.length === 0) {
      return { ok: false, error: "empty_file" };
    }

    const truncated = normalized.length > MAX_CONTENT_LENGTH;
    const text = truncated
      ? normalized.slice(0, MAX_CONTENT_LENGTH - 1) + "…"
      : normalized;

    log.info("plain text parsed", { filename, chars: text.length, truncated });
    return { ok: true, text, truncated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("plain text parse failed", { filename, error: message });
    return { ok: false, error: `parse_error: ${message}` };
  }
}

let pdfWorkerConfigured = false;

function ensurePdfWorkerConfigured(pdfjsLib: typeof import("pdfjs-dist")): void {
  if (pdfWorkerConfigured) return;
  // Initialize worker correctly for Chrome extension environment.
  // The build script copies this file to the /dist folder.
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("dist/pdf.worker.min.mjs");
  pdfWorkerConfigured = true;
}

/**
 * Parse a PDF file using pdf.js (pdfjs-dist).
 *
 * Falls back gracefully if pdf.js is not available (e.g. in service worker).
 * Image-only PDFs will produce empty text — this is an accepted MVP limitation.
 */
export async function parsePdf(buffer: ArrayBuffer, filename: string): Promise<ParseResult> {
  try {
    // Dynamic import — pdf.js may not be bundled in all entry points.
    // In service worker context this will fail; that's fine — file ingestion
    // happens in the sidepanel context where it's available.
    let pdfjsLib: typeof import("pdfjs-dist");
    try {
      pdfjsLib = await import("pdfjs-dist");
    } catch {
      // Fallback: try to extract text with a basic heuristic for simple PDFs
      return parsePdfFallback(buffer, filename);
    }

    ensurePdfWorkerConfigured(pdfjsLib);

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? (item as { str: string }).str : ""))
        .filter((s) => s.length > 0)
        .join(" ");
      if (pageText.trim().length > 0) {
        pageTexts.push(pageText.trim());
      }
    }

    const raw = pageTexts.join("\n\n");
    const normalized = normalizeContent(raw);

    if (normalized.length === 0) {
      return { ok: false, error: "pdf_no_text_content" };
    }

    const truncated = normalized.length > MAX_CONTENT_LENGTH;
    const text = truncated
      ? normalized.slice(0, MAX_CONTENT_LENGTH - 1) + "…"
      : normalized;

    log.info("pdf parsed", {
      filename,
      pages: doc.numPages,
      chars: text.length,
      truncated,
    });

    return { ok: true, text, pageCount: doc.numPages, truncated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("pdf parse failed", { filename, error: message });
    return { ok: false, error: `pdf_parse_error: ${message}` };
  }
}

/**
 * Minimal fallback for PDF text extraction when pdf.js is unavailable.
 * Extracts visible text streams from simple PDFs using regex heuristics.
 * NOT reliable for complex PDFs — this is a last-resort fallback.
 */
function parsePdfFallback(buffer: ArrayBuffer, filename: string): ParseResult {
  try {
    const decoder = new TextDecoder("latin1");
    const raw = decoder.decode(buffer);

    // Extract text between BT..ET (text blocks) — very basic
    const textBlocks: string[] = [];
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let match: RegExpExecArray | null;
    while ((match = btEtRegex.exec(raw)) !== null) {
      const block = match[1];
      // Extract text from Tj and TJ operators
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        textBlocks.push(tjMatch[1]);
      }
    }

    const text = normalizeContent(textBlocks.join(" "));
    if (text.length === 0) {
      return { ok: false, error: "pdf_fallback_no_text" };
    }

    const truncated = text.length > MAX_CONTENT_LENGTH;
    const finalText = truncated
      ? text.slice(0, MAX_CONTENT_LENGTH - 1) + "…"
      : text;

    log.info("pdf fallback parsed", { filename, chars: finalText.length, truncated });
    return { ok: true, text: finalText, truncated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pdf_fallback_error: ${message}` };
  }
}

// ------------------------------------------------------------------ //
// Content normalization                                               //
// ------------------------------------------------------------------ //

/**
 * Normalize extracted content:
 * 1. Remove null bytes and control characters (except newline/tab).
 * 2. Collapse runs of whitespace into single space.
 * 3. Collapse runs of newlines into max 2.
 * 4. Trim leading/trailing whitespace.
 */
function normalizeContent(raw: string): string {
  return raw
    // Remove null bytes and most control chars (keep \n, \r, \t)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Normalize line endings
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Collapse horizontal whitespace runs (spaces, tabs)
    .replace(/[^\S\n]+/g, " ")
    // Collapse 3+ newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    // Trim each line
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    // Final trim
    .trim();
}
