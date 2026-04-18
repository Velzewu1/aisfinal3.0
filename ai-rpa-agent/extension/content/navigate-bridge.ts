/**
 * Forwards navigation intent to the page main world via a document CustomEvent.
 * `schedule-bridge-listener.js` (mock-ui) dispatches `navigate_to_schedule` on `window`.
 * CSP-safe: no script.textContent injection.
 */
export function injectNavigateToScheduleEvent(): void {
  document.documentElement.dispatchEvent(
    new CustomEvent("ai-rpa-navigate-to-schedule", { bubbles: true }),
  );
}
