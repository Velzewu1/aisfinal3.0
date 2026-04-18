import { createLogger } from "../shared/logger.js";
import { isExtensionMessage, type ExtensionMessage } from "../shared/messages.js";
import { eventBus } from "./event-bus.js";
import { syncEvent } from "./supabase-sync.js";
import {
  forwardAudioChunkToSidepanel,
  recordingStartFromSidepanel,
  recordingStopFromSidepanel,
  relayAudioCompleteFromContent,
  router,
} from "./router.js";

const log = createLogger("background");

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
} {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as {
    type?: unknown;
    correlationId?: unknown;
    mimeType?: unknown;
    startedAt?: unknown;
    base64?: unknown;
  };
  return (
    m.type === "audio_complete" &&
    typeof m.correlationId === "string" &&
    m.correlationId.length > 0 &&
    typeof m.mimeType === "string" &&
    typeof m.startedAt === "number" &&
    typeof m.base64 === "string" &&
    m.base64.length > 0
  );
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
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
        await relayAudioCompleteFromContent(msg);
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
