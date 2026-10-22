import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, draftBaseline, pruneBaseline, scanBundle, fingerprint, packScan } from '../src/core.js';
import { renderHtml, renderText } from '../src/report.js';
import { approved, bundle, finding, rawResults } from '../examples/fixtures.js';

const options = { today: '2026-10-22' };

test('unchanged reviewed findings pass while retaining accountability', () => {
  const result = compare(bundle(), approved(), options);
  assert.equal(result.ok, true);
  assert.equal(result.known.length, 1);
  assert.equal(result.known[0].owner, 'checkout-team');
});
test('fixing one issue cannot hide a new issue at the same total count', () => {
  const current = bundle([finding('label', '#email')], { passes: [{ id: 'button-name', nodes: [] }] });
  const result = compare(current, approved(), options);
  assert.equal(result.ok, false);
  assert.equal(result.new[0].rule, 'label');
  assert.equal(result.resolved[0].rule, 'button-name');
});
test('expiry takes effect at the start of the named UTC day', () => {
  const baseline = approved(bundle(), '2026-10-01', '2026-10-22');
  assert.equal(compare(bundle(), baseline, { today: '2026-10-21' }).ok, true);
  assert.equal(compare(bundle(), baseline, options).expired.length, 1);
});
test('malformed or impossible dates never silently extend an exception', () => {
  for (const expires of ['2026-02-30', 'tomorrow', '2026-1-1', '2026-10-01']) {
    const baseline = approved(); baseline.exceptions[0].expires = expires;
    assert.throws(() => compare(bundle(), baseline, options));
  }
  assert.throws(() => compare(bundle(), approved(), { today: '2026-13-01' }));
});
test('drafts are intentionally unusable until a human supplies approval metadata', () => {
  const draft = draftBaseline(bundle(), options);
  assert.equal(draft.exceptions[0].owner, '');
  assert.throws(() => compare(bundle(), draft, options), /owner/);
  draft.exceptions[0].owner = 'team';
  assert.throws(() => compare(bundle(), draft, options), /reason/);
});
test('HTML-only changes do not invalidate a reviewed exception', () => {
  const changed = finding(); changed.nodes[0].html = '<button class="new">Different markup</button>';
  assert.equal(compare(bundle([changed]), approved(), options).ok, true);
});
test('capture omits HTML, browser details, and page URL query strings', () => {
  const scan = packScan({ scope: 'login', profile: 'default', results: rawResults(undefined, { url: 'https://site/?token=SECRET', testEnvironment: { userAgent: 'PRIVATE' } }) });
  assert.doesNotMatch(JSON.stringify(scan), /private content|SECRET|PRIVATE|"html"|"url"/);
});
test('nested shadow and iframe target boundaries stay distinct', () => {
  const one = fingerprint({ scope: 'home', rule: 'label', target: [['#host', '#input']] });
  const two = fingerprint({ scope: 'home', rule: 'label', target: ['#host', '#input'] });
  assert.notEqual(one, two);
});
test('an exception cannot cover the same selector in another page state', () => {
  const result = compare(bundle(undefined, {}, 'checkout:submitted'), approved(), options);
  assert.equal(result.new.length, 1);
  assert.equal(result.unverified.length, 1);
  assert.equal(result.coverage[0].code, 'MISSING_SCOPE');
});
test('missing states are unverified, never fixed or pruned', () => {
  const other = bundle([], {}, 'account');
  const report = compare(other, approved(), options);
  assert.equal(report.resolved.length, 0);
  assert.equal(report.unverified.length, 1);
  assert.throws(() => pruneBaseline(other, approved(), options), /coverage/);
});
test('changed engine, options, context, or profile requires a new review', () => {
  for (const mutate of [
    scan => { scan.results.testEngine.version = '5.0.0'; },
    scan => { scan.results.toolOptions.rules = { 'button-name': { enabled: false } }; },
    scan => { scan.context.exclude = ['#save']; },
    scan => { scan.profile = 'mobile'; },
  ]) {
    const changed = bundle(); mutate(changed.scans[0]);
    const result = compare(changed, approved(), options);
    assert.equal(result.coverage[0].code, 'SCAN_CHANGED');
    assert.equal(result.ok, false);
    assert.equal(result.known.length, 0);
  }
});
test('object key order does not change scan signatures', () => {
  const original = bundle(); original.scans[0].results.toolOptions = { a: 1, b: 2 };
  const changed = bundle(); changed.scans[0].results.toolOptions = { b: 2, a: 1 };
  assert.equal(compare(changed, approved(original), options).ok, true);
});
test('a rule missing from results cannot make an exception disappear', () => {
  const report = compare(bundle([]), approved(), options);
  assert.equal(report.unverified.length, 1);
  assert.equal(report.resolved.length, 0);
  assert.equal(pruneBaseline(bundle([]), approved(), options).exceptions.length, 1);
});
test('inconclusive evaluation fails the gate and blocks resolution for that rule', () => {
  const current = bundle([], { incomplete: [finding()], passes: [{ id: 'button-name', nodes: [] }] });
  const report = compare(current, approved(), options);
  assert.equal(report.ok, false);
  assert.equal(report.review.length, 1);
  assert.equal(report.unverified.length, 1);
  assert.equal(report.resolved.length, 0);
});
test('inapplicable rules can resolve removed elements after a comparable scan', () => {
  const current = bundle([], { inapplicable: [{ id: 'button-name', nodes: [] }] });
  assert.equal(compare(current, approved(), options).resolved.length, 1);
});
test('prune removes only confirmed fixes and does not mutate source objects', () => {
  const baseline = approved(); const original = structuredClone(baseline);
  const current = bundle([], { passes: [{ id: 'button-name', nodes: [] }] });
  assert.equal(pruneBaseline(current, baseline, options).exceptions.length, 0);
  assert.deepEqual(baseline, original);
});
test('severity escalation fails even with a current matching exception', () => {
  const report = compare(bundle([finding('button-name', '#save', 'critical')]), approved(), options);
  assert.equal(report.worsened.length, 1);
  assert.equal(report.ok, false);
});
test('no baseline means no accepted exceptions', () => {
  assert.equal(compare(bundle(), undefined, options).new.length, 1);
});
test('baseline tampering and duplicate identities fail validation', () => {
  const baseline = approved(); baseline.exceptions[0].target = ['#different'];
  assert.throws(() => compare(bundle(), baseline, options), /fingerprint/);
  const duplicated = approved(); duplicated.exceptions.push({ ...duplicated.exceptions[0] });
  assert.throws(() => compare(bundle(), duplicated, options), /Duplicate/);
});
test('empty, incomplete, or duplicate scan bundles cannot report a clean result', () => {
  assert.throws(() => compare({ schemaVersion: 1, scans: [] }), /at least one/);
  const partial = bundle(); delete partial.scans[0].results.passes;
  assert.throws(() => compare(partial), /passes/);
  const empty = bundle([]); empty.scans[0].results.passes = [];
  assert.throws(() => compare(empty), /no evaluated rules/);
  assert.throws(() => scanBundle([bundle().scans[0], bundle().scans[0]]), /unique/);
});
test('future-dated approvals do not authorize current failures', () => {
  const report = compare(bundle(), approved(bundle(), '2026-10-23'), options);
  assert.equal(report.unverified.length, 1);
});
test('reports escape injected markup and terminal controls and reject script links', () => {
  const bad = finding(); bad.help = '<script>alert(1)</script>'; bad.helpUrl = 'javascript:alert(1)';
  const input = bundle([bad], {}, 'home\x1b[31m<script>');
  const report = compare(input, undefined, options);
  const html = renderHtml(report);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(renderText(report), /\x1b/);
});
