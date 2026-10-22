import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { scanPage, writeScans } from '../src/playwright.js';
import { scanBundle, draftBaseline, compare } from '../src/index.js';
import { renderHtml } from '../src/report.js';

const html = `<!doctype html><html lang="en"><head><title>Checkout test fixture</title></head>
<body style="color:#111;background:#fff"><main><h1>Checkout</h1><button id="save"></button></main></body></html>`;
let reportHtml = '';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url === '/report' ? reportHtml : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.LEDGER_BROWSER_CHANNEL || undefined });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(origin);
  const options = { scope: 'checkout:empty:desktop', profile: 'wcag2aa-desktop-v1', tags: ['wcag2a', 'wcag2aa'] };
  const initial = scanBundle([await scanPage(page, options)]);
  const baseline = draftBaseline(initial);
  assert.equal(baseline.exceptions.length, 1, 'Fixture must expose one unlabeled button');
  for (const exception of baseline.exceptions) Object.assign(exception, {
    owner: 'checkout-team', reason: 'Replace the legacy button in the next sprint.',
    expires: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), ticket: 'DEMO-42',
  });
  assert.equal(compare(initial, baseline).ok, true);
  await page.locator('#save').evaluate(button => {
    button.textContent = 'Save';
    const input = document.createElement('input');
    input.id = 'email';
    button.parentNode.append(input);
  });
  const current = scanBundle([await scanPage(page, options)]);
  const report = compare(current, baseline);
  assert.equal(report.ok, false);
  assert.equal(report.summary.new, 1);
  assert.equal(report.summary.resolved, 1);
  assert.equal(report.new[0].rule, 'label');
  assert.equal(report.resolved[0].rule, 'button-name');
  const excluded = scanBundle([await scanPage(page, { ...options, exclude: ['#email'] })]);
  assert.equal(compare(excluded, baseline).coverage[0].code, 'SCAN_CHANGED');
  await mkdir('artifacts', { recursive: true });
  const runPath = `artifacts/browser-scan-${Date.now()}.json`;
  await writeScans(runPath, current.scans);
  assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), current);
  reportHtml = renderHtml(report);
  await writeFile('artifacts/browser-report.html', reportHtml);
  await page.goto(`${origin}/report`);
  const reportAudit = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(reportAudit.violations.map(rule => rule.id), [], 'Report should pass the automated desktop audit');
  await page.screenshot({ path: 'artifacts/report-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile document must not overflow');
  const mobileAudit = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(mobileAudit.violations.map(rule => rule.id), [], 'Report should pass the automated mobile audit');
  await page.screenshot({ path: 'artifacts/report-mobile.png', fullPage: true });
  const table = page.getByRole('region', { name: 'New findings table', exact: true });
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#new .table-wrap').scrollLeft > 0);
  console.log('Browser smoke passed: real axe scans, same-count regression, changed exclusions, bundle round-trip, desktop/mobile report audits and screenshots.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
