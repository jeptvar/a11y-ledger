import { mkdir, writeFile } from 'node:fs/promises';
import { compare } from '../src/core.js';
import { renderText, renderHtml } from '../src/report.js';
import { finding, bundle, approved } from '../examples/fixtures.js';

const today = new Date().toISOString().slice(0, 10);
const dateOffset = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const initial = bundle([finding('button-name', '#checkout-icon'), finding('image-alt', '#product-photo')]);
const baseline = approved(initial, dateOffset(-14), dateOffset(14));
baseline.exceptions.find(entry => entry.rule === 'button-name').expires = today;
const current = bundle([finding('button-name', '#checkout-icon'), finding('label', '#email')], { passes: [{ id: 'image-alt', nodes: [] }] });
const report = compare(current, baseline, { today });
await mkdir('artifacts', { recursive: true });
for (const [name, value] of Object.entries({ 'scan.json': current, 'baseline.json': baseline, 'report.json': report })) {
  await writeFile(`artifacts/${name}`, JSON.stringify(value, null, 2) + '\n');
}
await writeFile('artifacts/report.html', renderHtml(report));
console.log(renderText(report));
console.log('Demo generated: artifacts/report.html. This synthetic demo deliberately fails the gate.');
if (report.summary.new !== 1 || report.summary.expired !== 1 || report.summary.resolved !== 1) throw new Error('Unexpected demo outcome');
