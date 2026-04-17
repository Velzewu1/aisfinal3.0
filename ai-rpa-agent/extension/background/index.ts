import { createLogger } from "../shared/logger.js";
import { isExtensionMessage, type ExtensionMessage } from "../shared/messages.js";
import { eventBus } from "./event-bus.js";
import { syncEvent } from "./supabase-sync.js";
import { router } from "./router.js";

const log = createLogger("background");

chrome.runtime.onInstalled.addListener(() => {
  log.info("installed");
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => log.error("sidePanel.setPanelBehavior failed", String(err)));
});

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
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
