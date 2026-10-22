import { scanBundle, draftBaseline } from '../src/core.js';

export const finding = (id = 'button-name', selector = '#save', impact = 'serious') => ({
  id, impact, help: id === 'button-name' ? 'Buttons must have discernible text' : 'Form elements must have labels',
  helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}`,
  nodes: [{ target: [selector], impact, html: '<button>private content that must not be stored</button>' }],
});

export function rawResults(violations = [finding()], overrides = {}) {
  return {
    testEngine: { name: 'axe-core', version: '4.14.0' },
    toolOptions: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } },
    violations, passes: [{ id: 'document-title', nodes: [] }], incomplete: [], inapplicable: [],
    ...overrides,
  };
}
export function bundle(violations = [finding()], overrides = {}, scope = 'checkout:empty') {
  return scanBundle([{ scope, profile: 'wcag2aa-desktop', results: rawResults(violations, overrides) }]);
}
export function approved(input = bundle(), today = '2026-10-22', expires = '2026-11-22') {
  const baseline = draftBaseline(input, { today });
  for (const entry of baseline.exceptions) Object.assign(entry, { owner: 'checkout-team', reason: 'Replace the legacy icon button in the next checkout release.', expires, ticket: 'A11Y-42' });
  return baseline;
}
