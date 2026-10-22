import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { writeScans } from '../src/playwright.js';
import { approved, bundle, finding } from '../examples/fixtures.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'a11y-ledger-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scans = join(directory, 'scan.json'), baseline = join(directory, 'baseline.json');
  await writeFile(scans, JSON.stringify(bundle()));
  await writeFile(baseline, JSON.stringify(approved()));
  return { directory, scans, baseline };
}
async function run(args) {
  let out = '', err = '';
  const code = await main(args, { out: text => { out += text; }, err: text => { err += text; } });
  return { code, out, err };
}
test('installed-style CLI supports text, JSON, and standalone HTML', async t => {
  const { directory, scans, baseline } = await setup(t);
  const html = join(directory, 'report.html');
  const result = await run(['check', scans, '--baseline', baseline, '--today', '2026-10-22', '--format', 'json', '--html', html]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.out).summary.known, 1);
  assert.match(await readFile(html, 'utf8'), /Gate passed/);
  assert.match((await run(['check', scans, '--today', '2026-10-22'])).out, /FAIL/);
});
test('new findings return exit 1, malformed input returns exit 2', async t => {
  const { directory, scans } = await setup(t);
  assert.equal((await run(['check', scans])).code, 1);
  await writeFile(join(directory, 'broken.json'), '{ SECRET_VALUE');
  const result = await run(['check', join(directory, 'broken.json'), '--format', 'json']);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.out).ok, false);
  assert.doesNotMatch(result.out + result.err, /SECRET_VALUE/);
});
test('draft and report creation never overwrite existing files', async t => {
  const { directory, scans, baseline } = await setup(t);
  const before = await readFile(baseline, 'utf8');
  assert.equal((await run(['draft', scans, '--output', baseline])).code, 2);
  assert.equal((await run(['check', scans, '--html', baseline])).code, 2);
  assert.equal(await readFile(baseline, 'utf8'), before);
  const draft = join(directory, 'draft.json');
  assert.equal((await run(['draft', scans, '--output', draft])).code, 0);
  assert.equal((await run(['check', scans, '--baseline', draft])).code, 2);
});
test('multiple input files merge unique states and reject duplicate states', async t => {
  const { directory, scans } = await setup(t);
  const other = join(directory, 'other.json');
  await writeFile(other, JSON.stringify(bundle([finding()], {}, 'profile')));
  const result = await run(['check', scans, other, '--format', 'json']);
  assert.equal(JSON.parse(result.out).summary.new, 2);
  assert.equal((await run(['check', scans, scans])).code, 2);
});
test('prune produces a separate copy without modifying the original baseline', async t => {
  const { directory, scans, baseline } = await setup(t);
  const original = await readFile(baseline, 'utf8');
  await writeFile(scans, JSON.stringify(bundle([], { passes: [{ id: 'button-name', nodes: [] }] })));
  const output = join(directory, 'pruned.json');
  assert.equal((await run(['prune', scans, '--baseline', baseline, '--output', output, '--today', '2026-10-22'])).code, 0);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).exceptions.length, 0);
  assert.equal(await readFile(baseline, 'utf8'), original);
});
test('invalid commands and missing files have predictable errors', async () => {
  for (const args of [['check'], ['other', 'x'], ['prune', 'x'], ['draft', 'x'], ['check', 'nonexistent.json'], ['check', 'x', '--format', 'csv'], ['check', 'x', '--output', 'y']]) {
    assert.equal((await run(args)).code, 2);
  }
  assert.equal((await run(['--help'])).code, 0);
});
test('parallel capture helper refuses to clobber another worker output', async t => {
  const { scans } = await setup(t);
  await assert.rejects(writeScans(scans, bundle().scans), { code: 'EEXIST' });
});
