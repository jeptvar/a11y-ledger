const safeText = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const labels = {
  new: 'New findings', known: 'Reviewed exceptions', expired: 'Expired exceptions', worsened: 'Increased severity',
  resolved: 'Resolved exceptions', unverified: 'Unverified exceptions', review: 'Needs manual review', coverage: 'Scan coverage changes',
};
const targetText = item => JSON.stringify(item.target ?? item.targets ?? []);

export function renderText(report) {
  const lines = [`A11y Ledger | ${report.ok ? 'PASS' : 'FAIL'} | ${report.today} UTC`, '',
    Object.entries(report.summary).map(([key, count]) => `${key}: ${count}`).join(' | '), ''];
  for (const [key, label] of Object.entries(labels)) {
    if (!report[key].length) continue;
    lines.push(`${label} (${report[key].length})`);
    for (const item of report[key]) {
      lines.push(`  ${safeText(item.scope)} / ${safeText(item.rule ?? item.code)}`);
      if (item.target || item.targets) lines.push(`    ${safeText(targetText(item))}`);
      if (item.owner) lines.push(`    Owner: ${safeText(item.owner)}; expires: ${item.expires}`);
      if (item.explanation || item.message) lines.push(`    ${safeText(item.explanation ?? item.message)}`);
      if (item.fingerprint) lines.push(`    ${item.fingerprint}`);
    }
    lines.push('');
  }
  lines.push('This gate compares automated findings; it does not certify accessibility.');
  return lines.join('\n') + '\n';
}

export function renderHtml(report) {
  const cards = Object.entries(labels).map(([key, label]) => `<a class="metric" href="#${key}"><strong>${report.summary[key]}</strong><span>${label}</span></a>`).join('');
  const sections = Object.entries(labels).map(([key, label]) => {
    const rows = report[key].map(item => {
      let guidance = '';
      if (item.helpUrl) {
        try {
          const url = new URL(item.helpUrl);
          if (url.protocol === 'https:' || url.protocol === 'http:') guidance = `<a href="${escape(url.href)}" rel="noreferrer">Rule guidance</a>`;
        } catch { /* Invalid links are displayed only as plain rule descriptions. */ }
      }
      return `<tr><th scope="row"><strong>${escape(item.rule ?? item.code)}</strong><small>${escape(item.scope)}</small>${item.impact ? `<span class="badge">${escape(item.impact)}</span>` : ''}</th>
        <td>${item.target || item.targets ? `<code>${escape(targetText(item))}</code>` : ''}<p>${escape(item.help ?? item.explanation ?? item.message ?? '')}</p>${guidance}
        ${item.explanation && item.help ? `<p>${escape(item.explanation)}</p>` : ''}</td>
        <td>${item.owner ? `<strong>${escape(item.owner)}</strong><small>Expires ${escape(item.expires)} UTC</small><p>${escape(item.reason)}</p>${item.ticket ? `<small>Reference: ${escape(item.ticket)}</small>` : ''}` : '<span class="muted">—</span>'}</td></tr>`;
    }).join('');
    return `<section id="${key}" aria-labelledby="heading-${key}"><div class="section-heading"><h2 id="heading-${key}">${label}</h2><span>${report[key].length}</span></div>
      ${rows ? `<div class="table-wrap" role="region" aria-label="${label} table" tabindex="0"><table><caption class="sr-only">${label}</caption><thead><tr><th scope="col">Rule / page state</th><th scope="col">Finding</th><th scope="col">Accountability</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">No items in this category.</p>'}</section>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>A11y Ledger · ${report.ok ? 'Gate passed' : 'Action needed'}</title>
<style>
:root{color-scheme:light;--ink:#17243a;--muted:#52627a;--line:#dce3ed;--accent:#3548ab}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--accent);text-underline-offset:3px}a:focus-visible{outline:3px solid #bc5300;outline-offset:4px}.skip{position:absolute;top:-100px;left:20px;background:white;padding:10px;z-index:2}.skip:focus{top:12px}.container{max-width:1180px;margin:auto;padding:32px 28px}header{background:#fff;border-bottom:1px solid var(--line)}.brand{font-weight:750;letter-spacing:-.5px;font-size:22px}.brand span{color:var(--accent)}.eyebrow{font:700 12px/1.5 system-ui;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-top:32px}h1{font-size:clamp(32px,4vw,46px);line-height:1.15;letter-spacing:-1.6px;margin:12px 0 16px}.intro{color:var(--muted);max-width:760px;margin:0 0 22px}.status{display:inline-block;border:1px solid;padding:5px 13px;border-radius:20px;font-weight:700;font-size:14px}.fail{color:#8c2a18;background:#fff0e9;border-color:#e6b6a8}.pass{color:#165c3d;background:#e9f7ef;border-color:#a7d6ba}.meta{color:var(--muted);margin-left:14px;font-size:14px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 30px}.metric{display:block;background:white;border:1px solid var(--line);border-radius:10px;padding:18px;text-decoration:none;color:var(--ink)}.metric:hover{border-color:var(--accent)}.metric strong{display:block;font-size:30px;line-height:1.1}.metric span{display:block;font-size:13px;color:var(--muted);margin-top:9px}section{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:20px;scroll-margin-top:20px}.section-heading{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--line)}h2{font-size:19px;margin:0}.section-heading>span{border-radius:20px;background:#eef1f8;min-width:30px;text-align:center;font-size:13px;font-weight:700}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;table-layout:fixed}th,td{padding:18px 24px;vertical-align:top;overflow-wrap:anywhere}thead th{font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);background:#fafbfe}thead th:first-child{width:25%}thead th:last-child{width:28%}tbody tr+tr{border-top:1px solid var(--line)}tbody th{font-weight:400;font-size:14px}small{display:block;font-size:12px;color:var(--muted);margin-top:4px}td{font-size:14px}td p{margin:7px 0;color:var(--muted)}code{font:12px/1.7 ui-monospace,Consolas,monospace;white-space:pre-wrap;color:#293d66}.badge{display:inline-block;margin-top:10px;padding:1px 7px;background:#edf0fa;color:#344583;border-radius:4px;font-size:11px}.empty{padding:0 24px;color:var(--muted);font-size:14px}.muted{color:var(--muted)}footer{font-size:13px;color:var(--muted);padding-top:4px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:700px){.container{padding:24px 16px}.metrics{grid-template-columns:repeat(2,1fr)}th,td{padding:14px 12px}table{min-width:650px}.meta{display:block;margin:10px 0 0}}@media print{body{background:white}.container{max-width:none;padding:10px}section{break-inside:avoid}.metrics{grid-template-columns:repeat(4,1fr)}a{color:inherit}.skip{display:none}}
</style></head><body><a class="skip" href="#main">Skip to findings</a><header><div class="container"><div class="brand">a11y<span>/</span>ledger</div><p class="eyebrow">Accessibility exception review</p>
<h1>${report.ok ? 'Known debt. Clear ownership.' : 'Keep the next release accountable.'}</h1>
<p class="intro">Track reviewed exceptions without losing sight of new barriers. Every exception belongs to a page state, an owner, and a deadline.</p>
<span class="status ${report.ok ? 'pass' : 'fail'}">${report.ok ? 'Gate passed' : 'Action needed'}</span><span class="meta">${escape(report.today)} UTC · ${report.scans.length} scanned page states</span></div></header>
<main id="main" class="container"><nav class="metrics" aria-label="Finding categories">${cards}</nav>${sections}<footer>Generated locally by A11y Ledger. A passing gate is not an accessibility certification. Combine automated checks with manual testing and feedback from disabled users.</footer></main></body></html>`;
}
