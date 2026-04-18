/**
 * Dispatches `navigate_to_schedule` in the page (MAIN) JavaScript realm.
 * Content scripts are isolated from page `window`; this follows the same
 * injection pattern as `schedule-bridge.ts` (trusted, no eval of LLM output).
 */
export function injectNavigateToScheduleEvent(): void {
  const script = document.createElement("script");
  script.setAttribute("data-ai-rpa-navigate-bridge", "");
  script.textContent = `
(function () {
  try {
    window.dispatchEvent(new CustomEvent("navigate_to_schedule"));
  } catch (e) {
    console.error("[ai-rpa] navigate_to_schedule dispatch failed", e);
  }
})();
`;
  const root = document.head ?? document.documentElement;
  root.appendChild(script);
  script.remove();
}
