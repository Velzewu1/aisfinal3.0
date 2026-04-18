import { createLogger } from "../shared/logger.js";
import { isExtensionMessage, type ExtensionMessage } from "../shared/messages.js";
import { eventBus } from "./event-bus.js";
import { syncEvent } from "./supabase-sync.js";
import {
  continuousStartFromSidepanel,
  continuousStopFromSidepanel,
  forwardAudioChunkToSidepanel,
  recordingStartFromSidepanel,
  recordingStopFromSidepanel,
  relayAudioCompleteFromContent,
  router,
} from "./router.js";

const log = createLogger("background");

function isNavigateToScheduleSidepanel(
  msg: unknown,
): msg is { type: "navigate_to_schedule" } {
  return typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "navigate_to_schedule";
}

/**
 * Single place for "open schedule" navigation:
 * - already on `schedule.html` → ask content script to emit `navigate_to_schedule` (page scrolls);
 * - otherwise → navigate the active tab to `schedule.html` on the same origin.
 */
async function handleNavigateToScheduleFromSidepanel(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    throw new Error("no_active_tab");
  }
  const rawUrl = tab.url ?? "";
  let pathname = "";
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = "";
  }
  const onSchedulePage = pathname === "/schedule.html" || pathname.endsWith("/schedule.html");

  if (onSchedulePage) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "navigate_to_schedule" });
    } catch (e: unknown) {
      log.warn("navigate_to_schedule forward to tab failed", String(e));
      throw e instanceof Error ? e : new Error(String(e));
    }
    return;
  }

  let origin = "";
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    throw new Error("no_origin");
  }
  await chrome.tabs.update(tab.id, { url: `${origin}/schedule.html` });
}

chrome.runtime.onInstalled.addListener(() => {
  log.info("installed");
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => log.error("sidePanel.setPanelBehavior failed", String(err)));
});

function isRecordingDispatch(
  msg: unknown,
): msg is { type: "start_recording" | "stop_recording"; correlationId: string } {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: unknown; correlationId?: unknown };
  return (
    (m.type === "start_recording" || m.type === "stop_recording") &&
    typeof m.correlationId === "string" &&
    m.correlationId.length > 0
  );
}

function isContinuousDispatch(
  msg: unknown,
): msg is { type: "start_continuous_recording" | "stop_continuous_recording"; sessionId: string } {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: unknown; sessionId?: unknown };
  return (
    (m.type === "start_continuous_recording" || m.type === "stop_continuous_recording") &&
    typeof m.sessionId === "string" &&
    m.sessionId.length > 0
  );
}

function isAudioChunk(
  msg: unknown,
): msg is { type: "audio_chunk"; correlationId: string; chunk: string } {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: unknown; correlationId?: unknown; chunk?: unknown };
  return (
    m.type === "audio_chunk" &&
    typeof m.correlationId === "string" &&
    m.correlationId.length > 0 &&
    typeof m.chunk === "string"
  );
}

function isAudioComplete(
  msg: unknown,
): msg is {
  type: "audio_complete";
  correlationId: string;
  mimeType: string;
  startedAt: number;
  base64: string;
  sessionId?: string;
} {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as {
    type?: unknown;
    correlationId?: unknown;
    mimeType?: unknown;
    startedAt?: unknown;
    base64?: unknown;
    sessionId?: unknown;
  };
  return (
    m.type === "audio_complete" &&
    typeof m.correlationId === "string" &&
    m.correlationId.length > 0 &&
    typeof m.mimeType === "string" &&
    typeof m.startedAt === "number" &&
    typeof m.base64 === "string" &&
    m.base64.length > 0 &&
    (m.sessionId === undefined || typeof m.sessionId === "string")
  );
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (isNavigateToScheduleSidepanel(msg)) {
    void (async () => {
      try {
        await handleNavigateToScheduleFromSidepanel();
        sendResponse({ ok: true });
      } catch (err: unknown) {
        log.error("navigate_to_schedule failed", String(err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (isRecordingDispatch(msg)) {
    void (async () => {
      try {
        if (msg.type === "start_recording") {
          const result = await recordingStartFromSidepanel(msg.correlationId);
          sendResponse({ ok: true, result });
        } else {
          const result = await recordingStopFromSidepanel(msg.correlationId);
          sendResponse({ ok: true, result });
        }
      } catch (err: unknown) {
        log.error("recording handler error", String(err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (isContinuousDispatch(msg)) {
    void (async () => {
      try {
        if (msg.type === "start_continuous_recording") {
          const result = await continuousStartFromSidepanel(msg.sessionId);
          sendResponse({ ok: true, result });
        } else {
          const result = await continuousStopFromSidepanel(msg.sessionId);
          sendResponse({ ok: true, result });
        }
      } catch (err: unknown) {
        log.error("continuous handler error", String(err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (sender.tab?.id !== undefined && isAudioChunk(msg)) {
    void (async () => {
      try {
        await forwardAudioChunkToSidepanel(msg.correlationId, msg.chunk);
        sendResponse({ ok: true });
      } catch (err: unknown) {
        log.error("audio_chunk forward failed", String(err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (sender.tab?.id !== undefined && isAudioComplete(msg)) {
    void (async () => {
      try {
        await relayAudioCompleteFromContent({
          correlationId: msg.correlationId,
          mimeType: msg.mimeType,
          startedAt: msg.startedAt,
          base64: msg.base64,
          ...(typeof msg.sessionId === "string" && msg.sessionId.length > 0
            ? { sessionId: msg.sessionId }
            : {}),
        });
        sendResponse({ ok: true });
      } catch (err: unknown) {
        log.error("audio_complete forward failed", String(err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (!isExtensionMessage(msg)) {
    sendResponse({ ok: false, error: "invalid_message" });
    return false;
  }
  handle(msg, sender).then(
    (result) => sendResponse({ ok: true, result }),
    (err: unknown) => {
      log.error("handler error", String(err));
      sendResponse({ ok: false, error: String(err) });
    },
  );
  return true;
});

async function handle(msg: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (msg.type === "event") {
    eventBus.publish(msg.event);
    await syncEvent(msg.event);
    return { acked: true };
  }
  return router.dispatch(msg, sender);
}

eventBus.subscribe((event) => {
  log.info("event", { type: event.type, correlationId: event.correlationId });
});
