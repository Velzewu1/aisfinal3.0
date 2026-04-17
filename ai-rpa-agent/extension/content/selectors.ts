const APPROVED_ATTRS = new Set([
  "data-field",
  "data-action",
  "data-nav",
  "data-status-entity",
  "data-schedule-grid",
]);

/**
 * Approved selector resolver.
 *
 * The executor is only allowed to resolve elements via this function.
 * Raw CSS selectors or XPath from the LLM are forbidden by policy and rejected here.
 */
export function selectByDataAttr(attr: string, value: string): Element | null {
  if (!APPROVED_ATTRS.has(attr)) {
    throw new Error(`unapproved_selector_attr: ${attr}`);
  }
  if (!/^[a-zA-Z0-9_\-.:]+$/.test(value)) {
    throw new Error(`invalid_selector_value: ${value}`);
  }
  return document.querySelector(`[${attr}="${value}"]`);
}
