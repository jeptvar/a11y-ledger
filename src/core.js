import { createHash } from 'node:crypto';

export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}

const fail = message => { throw new InputError(message); };
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
};
const array = (value, label) => {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonempty string.`);
  return value;
};
const impacts = [null, 'minor', 'moderate', 'serious', 'critical'];
const impactOf = value => {
  if (!impacts.includes(value ?? null)) fail('Finding impact is invalid.');
  return value ?? null;
};
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const targetOf = value => {
  array(value, 'Node target');
  if (!value.length) fail('Node target must not be empty.');
  return value.map(item => Array.isArray(item) ? targetOf(item) : text(item, 'Target selector'));
};
export const fingerprint = ({ scope, rule, target }) => hash([scope, rule, target]);
export const utcToday = () => new Date().toISOString().slice(0, 10);

export function dateOnly(value, label = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(`${label} is not a valid calendar date.`);
  return value;
}

// Deliberately omit page URLs, HTML snippets, check data, and browser environment.
// Selector strings and caller-supplied metadata remain visible in reports.
export function packScan({ scope, profile, context = { include: [], exclude: [] }, results }) {
  text(scope, 'Scan scope');
  text(profile, 'Scan profile');
  object(context, 'Scan context');
  object(results, 'axe results');
  const engine = object(results.testEngine, 'axe testEngine');
  text(engine.name, 'Engine name');
  text(engine.version, 'Engine version');
  const clean = {
    testEngine: { name: engine.name, version: engine.version },
    toolOptions: results.toolOptions ?? {},
  };
  object(clean.toolOptions, 'axe toolOptions');
  for (const category of ['violations', 'passes', 'incomplete', 'inapplicable']) {
    clean[category] = array(results[category], `axe ${category}`).map(raw => {
      object(raw, 'Rule result');
      const rule = {
        id: text(raw.id, 'Rule id'),
        impact: impactOf(raw.impact),
        help: typeof raw.help === 'string' ? raw.help : raw.id,
        helpUrl: typeof raw.helpUrl === 'string' ? raw.helpUrl : '',
        nodes: array(raw.nodes, 'Rule nodes').map(node => {
          object(node, 'Rule node');
          return { target: targetOf(node.target), impact: impactOf(node.impact ?? raw.impact) };
        }),
      };
      if (category === 'violations' && !rule.nodes.length) fail('A violation must include at least one node.');
      return rule;
    });
  }
  if (!['violations', 'passes', 'incomplete', 'inapplicable'].some(category => clean[category].length)) fail('axe results contain no evaluated rules. An empty result is not a completed scan.');
  // JSON round-trip prevents shared caller objects from changing captured input.
  return JSON.parse(JSON.stringify({ scope, profile, context, results: clean }));
}

export function scanBundle(scans) {
  const bundle = { schemaVersion: 1, scans: array(scans, 'Scans').map(packScan) };
  normalizeBundle(bundle);
  return bundle;
}

export function normalizeBundle(input) {
  object(input, 'Scan bundle');
  if (input.schemaVersion !== 1) fail('Unsupported scan bundle schemaVersion.');
  const source = array(input.scans, 'Bundle scans');
  if (!source.length) fail('A scan bundle must contain at least one completed scan.');
  const seen = new Set();
  return source.map(raw => {
    const scan = packScan(raw);
    if (seen.has(scan.scope)) fail('Each scan scope must be unique within a bundle.');
    seen.add(scan.scope);
    const signature = hash([scan.profile, scan.context, scan.results.testEngine, scan.results.toolOptions]);
    const findings = new Map();
    const completed = new Set();
    const uncertain = new Set();
    const review = [];
    for (const category of ['violations', 'passes', 'incomplete', 'inapplicable']) {
      const ruleIds = new Set();
      for (const rule of scan.results[category]) {
        if (ruleIds.has(rule.id)) fail('Duplicate rule id within an axe result category.');
        ruleIds.add(rule.id);
        if (category === 'incomplete') {
          uncertain.add(rule.id);
          review.push({ scope: scan.scope, rule: rule.id, help: rule.help, targets: rule.nodes.map(n => n.target) });
        } else completed.add(rule.id);
        if (category === 'violations') for (const node of rule.nodes) {
          const finding = { scope: scan.scope, rule: rule.id, target: node.target, impact: node.impact, help: rule.help, helpUrl: rule.helpUrl };
          finding.fingerprint = fingerprint(finding);
          if (findings.has(finding.fingerprint)) fail('Duplicate finding within an axe scan.');
          findings.set(finding.fingerprint, finding);
        }
      }
    }
    return { scope: scan.scope, profile: scan.profile, signature, findings, completed, uncertain, review };
  });
}

export function validateBaseline(input) {
  object(input, 'Baseline');
  if (input.schemaVersion !== 1) fail('Unsupported baseline schemaVersion.');
  const scans = new Map();
  for (const scan of array(input.scans, 'Baseline scans')) {
    object(scan, 'Baseline scan');
    text(scan.scope, 'Baseline scope');
    if (typeof scan.signature !== 'string' || !/^[a-f0-9]{64}$/.test(scan.signature)) fail('Baseline scan signature is invalid.');
    if (scans.has(scan.scope)) fail('Duplicate scope in baseline.');
    scans.set(scan.scope, scan.signature);
  }
  const entries = new Map();
  for (const entry of array(input.exceptions, 'Baseline exceptions')) {
    object(entry, 'Baseline exception');
    text(entry.scope, 'Exception scope');
    text(entry.rule, 'Exception rule');
    targetOf(entry.target);
    impactOf(entry.impact);
    if (!scans.has(entry.scope)) fail('Exception has no matching baseline scan.');
    if (entry.fingerprint !== fingerprint(entry)) fail('Exception fingerprint does not match its scope, rule, and target.');
    if (entries.has(entry.fingerprint)) fail('Duplicate exception fingerprint.');
    text(entry.owner, 'Exception owner');
    text(entry.reason, 'Exception reason');
    dateOnly(entry.created, 'Exception created');
    dateOnly(entry.expires, 'Exception expires');
    if (entry.expires <= entry.created) fail('Exception expires must be later than created.');
    if (entry.ticket !== undefined && typeof entry.ticket !== 'string') fail('Exception ticket must be a string.');
    entries.set(entry.fingerprint, entry);
  }
  return { scans, entries };
}

export function draftBaseline(bundle, { today = utcToday() } = {}) {
  dateOnly(today);
  const scans = normalizeBundle(bundle);
  return {
    schemaVersion: 1,
    scans: scans.map(({ scope, signature }) => ({ scope, signature })).sort((a, b) => a.scope.localeCompare(b.scope)),
    exceptions: scans.flatMap(scan => [...scan.findings.values()].map(({ fingerprint, scope, rule, target, impact }) => ({
      fingerprint, scope, rule, target, impact, owner: '', reason: '', created: today, expires: '', ticket: '',
    }))).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  };
}

export function compare(bundle, baseline = { schemaVersion: 1, scans: [], exceptions: [] }, { today = utcToday() } = {}) {
  dateOnly(today);
  const scans = normalizeBundle(bundle);
  const known = validateBaseline(baseline);
  const current = new Map(scans.map(scan => [scan.scope, scan]));
  const report = { schemaVersion: 1, today, scans: scans.map(({ scope, profile }) => ({ scope, profile })), new: [], known: [], expired: [], worsened: [], resolved: [], unverified: [], review: [], coverage: [] };
  const invalidScopes = new Set();
  for (const [scope, signature] of known.scans) {
    if (!current.has(scope)) {
      report.coverage.push({ scope, code: 'MISSING_SCOPE', message: 'A baseline page state was not scanned.' });
      invalidScopes.add(scope);
    } else if (current.get(scope).signature !== signature) {
      report.coverage.push({ scope, code: 'SCAN_CHANGED', message: 'Engine version, scan options, context, or profile changed. Review the baseline with the new scan configuration.' });
      invalidScopes.add(scope);
    }
  }
  const seen = new Set();
  for (const scan of scans) {
    report.review.push(...scan.review);
    for (const finding of scan.findings.values()) {
      seen.add(finding.fingerprint);
      const exception = known.entries.get(finding.fingerprint);
      if (!exception) { report.new.push(finding); continue; }
      const item = { ...finding, owner: exception.owner, reason: exception.reason, expires: exception.expires, ticket: exception.ticket ?? '' };
      if (invalidScopes.has(scan.scope)) report.unverified.push({ ...item, explanation: 'Scan configuration changed.' });
      else if (exception.created > today) report.unverified.push({ ...item, explanation: 'Exception creation date is in the future.' });
      else if (impacts.indexOf(finding.impact) > impacts.indexOf(exception.impact ?? null)) report.worsened.push(item);
      else if (exception.expires <= today) report.expired.push(item);
      else report.known.push(item);
    }
  }
  for (const [id, entry] of known.entries) {
    if (seen.has(id)) continue;
    const scan = current.get(entry.scope);
    if (!scan || invalidScopes.has(entry.scope)) report.unverified.push({ ...entry, explanation: 'Comparable scan missing.' });
    else if (!scan.completed.has(entry.rule) || scan.uncertain.has(entry.rule)) report.unverified.push({ ...entry, explanation: 'Rule was not conclusively evaluated.' });
    else report.resolved.push(entry);
  }
  const categories = ['new', 'known', 'expired', 'worsened', 'resolved', 'unverified', 'review', 'coverage'];
  for (const key of categories) report[key].sort((a, b) => canonical([a.scope, a.rule, a.target]).localeCompare(canonical([b.scope, b.rule, b.target])));
  report.summary = Object.fromEntries(categories.map(key => [key, report[key].length]));
  report.ok = ['new', 'expired', 'worsened', 'unverified', 'review', 'coverage'].every(key => !report[key].length);
  return report;
}

export function pruneBaseline(bundle, baseline, options) {
  const report = compare(bundle, baseline, options);
  if (report.coverage.length) fail('Cannot prune while baseline scan coverage is missing or changed.');
  const remove = new Set(report.resolved.map(entry => entry.fingerprint));
  return { ...baseline, exceptions: baseline.exceptions.filter(entry => !remove.has(entry.fingerprint)) };
}
