import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { compare, draftBaseline, pruneBaseline, InputError, utcToday } from './core.js';
import { renderHtml, renderText } from './report.js';

const help = `A11y Ledger 0.1.0

Usage:
  a11y-ledger check <scan.json> [...] [--baseline ledger.json] [--format text|json] [--html report.html]
  a11y-ledger draft <scan.json> [...] --output ledger.json
  a11y-ledger prune <scan.json> [...] --baseline ledger.json --output reviewed.json

Options:
  --today YYYY-MM-DD   Override the UTC evaluation date (for reproducible reviews).
  --help              Show this help.
  --version           Show the version.

No baseline means zero accepted exceptions. Draft exceptions require review:
fill in owner, reason, and expiry. Output files are created exclusively and
never overwrite existing files. Check never changes a baseline.
Exit codes: 0 pass/success, 1 gate failed, 2 invalid input or file error.
`;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new InputError('Cannot read an input file as UTF-8 JSON. Check the paths and JSON syntax.'); }
}
async function writeNew(path, contents) {
  try { await writeFile(path, contents, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { throw new InputError(error.code === 'EEXIST' ? 'Output already exists. Choose a new path; existing files are never overwritten.' : 'Cannot create output file. Check the path and permissions.'); }
}

export async function main(argv = process.argv.slice(2), io = { out: value => process.stdout.write(value), err: value => process.stderr.write(value) }) {
  let format = 'text';
  try {
    const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: {
      baseline: { type: 'string' }, output: { type: 'string' }, html: { type: 'string' },
      today: { type: 'string' }, format: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' },
    } });
    if (values.help || !argv.length) { io.out(help); return 0; }
    if (values.version) { io.out('a11y-ledger 0.1.0\n'); return 0; }
    format = values.format ?? 'text';
    if (!['text', 'json'].includes(format)) throw new InputError('Format must be text or json.');
    const [command, ...paths] = positionals;
    if (!['check', 'draft', 'prune'].includes(command) || !paths.length) throw new InputError('Choose check, draft, or prune and at least one scan JSON file. Use --help.');
    if (command === 'check' && values.output !== undefined) throw new InputError('Check uses --html for files or stdout for text/JSON; --output is not supported.');
    if (command !== 'check' && (values.html !== undefined || values.format !== undefined)) throw new InputError('--html and --format apply only to check.');
    if (command === 'draft' && values.baseline !== undefined) throw new InputError('Draft creates a fresh review file; it does not merge an existing baseline.');
    if (command !== 'check' && !values.output) throw new InputError('Draft and prune require --output.');
    if (command === 'prune' && !values.baseline) throw new InputError('Prune requires --baseline.');
    const inputs = await Promise.all(paths.map(readJson));
    const scans = [];
    for (const input of inputs) {
      if (input?.schemaVersion !== 1 || !Array.isArray(input.scans) || !input.scans.length) throw new InputError('Each input must be a nonempty schemaVersion 1 scan bundle.');
      scans.push(...input.scans);
    }
    const bundle = { schemaVersion: 1, scans };
    const baseline = values.baseline ? await readJson(values.baseline) : undefined;
    const options = { today: values.today ?? utcToday() };
    if (command === 'draft' || command === 'prune') {
      const output = command === 'draft' ? draftBaseline(bundle, options) : pruneBaseline(bundle, baseline, options);
      await writeNew(values.output, JSON.stringify(output, null, 2) + '\n');
      io.out(command === 'draft' ? 'Draft created. Review every exception and fill in owner, reason, and expiry before use.\n' : 'Pruned copy created. Only conclusively resolved exceptions were removed; review the diff.\n');
      return 0;
    }
    const report = compare(bundle, baseline, options);
    if (values.html) await writeNew(values.html, renderHtml(report));
    io.out(format === 'json' ? JSON.stringify(report, null, 2) + '\n' : renderText(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof InputError ? error.message : 'Invalid command arguments or input. Use --help to check the command format.';
    if (format === 'json') io.out(JSON.stringify({ schemaVersion: 1, ok: false, error: message }) + '\n');
    else io.err(`a11y-ledger: ${message}\n`);
    return 2;
  }
}
