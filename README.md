# A11y Ledger

**Keep existing accessibility debt from hiding new barriers.**

A11y Ledger compares axe findings by page state, rule, and target. Every accepted
exception needs an owner, a reason, and an expiry date. A fixed button and a newly
broken form field still fail the gate—even when the total issue count is unchanged.

It provides a Node.js CLI, a small Playwright adapter, and a standalone HTML report.
The comparison CLI has no required third-party runtime dependencies. MIT licensed.

## Try it

Requires Node.js 22 or newer. From this source checkout:

```sh
git clone https://github.com/jeptvar/a11y-ledger.git
cd a11y-ledger
npm ci
npm test
npm run demo
```

Open `artifacts/report.html`. The synthetic demo intentionally shows one new
finding, one expired exception, and one resolved exception. It regenerates its
own demo artifacts each time.

This package has not been published to npm. To install into another project,
run `npm pack` here, then run `npm install --save-dev /path/to/a11y-ledger-0.1.0.tgz`
in that project. The commands below use the installed `a11y-ledger` executable.
In this checkout, replace `npx a11y-ledger` with `node bin/a11y-ledger.js`.

## Capture the states your users visit

Install `@axe-core/playwright` and `@playwright/test` in the consuming project,
then install the browser with `npx playwright install chromium`.

```js
// collect-a11y.mjs — run with node collect-a11y.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { scanPage, writeScans } from 'a11y-ledger/playwright';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, locale: 'en-US',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/checkout');
  // Wait for your application to finish loading, and open any UI being tested.
  const scan = await scanPage(page, {
    scope: 'checkout:empty:desktop:guest:en-US',
    profile: 'wcag2aa-chromium-1280x900-v1',
    tags: ['wcag2a', 'wcag2aa'],
  });
  await mkdir('a11y-results', { recursive: true });
  await writeScans('a11y-results/checkout.json', [scan]);
} finally {
  await browser.close();
}
```

Use a fresh results directory for every run. `writeScans` refuses to overwrite
existing files. For parallel tests, use a unique path for each worker and pass
the collected files explicitly to the CLI. Duplicate scopes are rejected.

`scope` identifies one reproducible page state. Use different scopes for dialogs,
viewports, locales, authentication states, or browser projects you test separately.
`profile` identifies the intended scan setup. Change it when changing conditions
the adapter cannot record automatically, such as viewport or custom axe setup.
The adapter records include/exclude selectors and axe's engine version/options.
It does not automatically record browser version, locale, viewport, or login state.

The adapter also accepts `include`, `exclude`, and `disableRules` arrays. Avoid
excluding affected components merely to make a scan pass: that prevents new
findings within those components from being detected.

## Review existing debt once

```sh
npx a11y-ledger draft a11y-results/checkout.json --output ledger.json
```

This creates a **draft**, not an approved baseline. Fill in `owner`, `reason`,
and `expires` for each exception you accept; optionally add a ticket reference.
Remove exceptions you do not accept. Keep the generated fingerprint, target,
scope, rule, impact, and scan signature intact. Example review fields:

```json
{
  "owner": "checkout-team",
  "reason": "Replace the legacy icon button in the next sprint.",
  "created": "2026-10-22",
  "expires": "2026-11-05",
  "ticket": "A11Y-42"
}
```

These are illustrative dates, not defaults. Choose actual review dates. Expiry
is at **00:00 UTC on the named date** and must be later than creation. Commit the
reviewed ledger alongside your tests. Blank review fields are invalid; the CLI
does not verify that an owner or ticket exists in an external system.

## Gate the next change

Collect fresh scan files first, then run:

```sh
npx a11y-ledger check a11y-results/checkout.json --baseline ledger.json --html report.html
```

Without `--baseline`, no exceptions are accepted. For multiple files, list them
as separate arguments; the CLI does not expand globs itself. `--format json`
emits a machine-readable report on stdout. `--today YYYY-MM-DD` is available for
reproducible historical reviews; omit it in CI so deadlines use the actual date.

| Result | Gate behavior |
| --- | --- |
| New finding | Fail |
| Reviewed, unexpired exception | Pass for that finding |
| Expired exception or increased severity | Fail |
| Missing baseline scope or changed scan configuration | Fail |
| Rule not conclusively evaluated for an absent exception | Fail; keep it unverified |
| axe `incomplete` result | Fail; needs investigation/manual review |
| Exception conclusively absent from a comparable scan | Mark resolved |

Exit codes: **0** pass/success, **1** failed gate, **2** invalid input or file error.
Checks never change the baseline or extend exceptions. HTML and draft outputs
refuse to overwrite existing files; use a clean artifact directory or a new name.
There is no mechanism to suppress `incomplete` results in this initial version.

## Remove confirmed fixes

```sh
npx a11y-ledger prune a11y-results/checkout.json --baseline ledger.json --output ledger.next.json
```

Review the diff before replacing `ledger.json`. Prune removes only resolved
exceptions and refuses to run if a baseline scope is missing or its scan
configuration changed. It may produce a pruned copy while other findings still
fail the gate; its success does not mean the accessibility check passed.

After an engine/configuration upgrade, collect a complete fresh scan, draft a
new file, and review the changes before replacing the ledger. Draft does not
merge old approvals or automatically renew them. Unchanged approvals can be
carried forward deliberately during that review.

## API and input format

The main export provides `packScan`, `scanBundle`, `draftBaseline`,
`validateBaseline`, `compare`, `pruneBaseline`, `fingerprint`, `renderText`,
`renderHtml`, and `InputError`. Supply raw axe results through:

```js
import { packScan, scanBundle, compare } from 'a11y-ledger';
const scan = packScan({ scope: 'checkout:empty', profile: 'desktop-v1', results });
const report = compare(scanBundle([scan]), reviewedBaseline);
```

`results` must contain `testEngine` and all four axe result arrays: `violations`,
`passes`, `incomplete`, and `inapplicable`. At least one rule must be evaluated.
Supply `context` explicitly when using custom inclusion/exclusion settings.
Passing only violations is insufficient to establish whether old findings are
resolved. Bundles and ledgers currently use `schemaVersion: 1`.

Identity uses the exact scope, rule ID, and nested axe target array. HTML content
is not part of identity. A selector change appears as a new finding plus a
potentially resolved old finding and requires review. Nested iframe/shadow-root
targets are preserved. Findings are not matched heuristically.

## Limits and data handling

- This tracks automated findings, not WCAG compliance. Include keyboard,
  assistive-technology, and user testing in your accessibility work.
- The gate compares the input you supply. It cannot prove that a scan is fresh,
  every required state was visited, or an element was not intentionally excluded.
  Run collection and comparison together in CI and review baseline/config changes.
- Raw HTML, page URLs, check data, and browser environment are omitted from packed
  results. Selectors, descriptions, scan options, and review metadata remain and
  can contain private information. Inspect artifacts before sharing them.
- A hash identifies a finding; it is not a signature authenticating approval.
  Treat ledger edits as code-review changes.
- There is no hosted service, telemetry, GitHub bot, automatic issue creation,
  or npm release in this version. The adapter scans the page you give it; rule
  guidance links in the report open external documentation when followed.

## Development

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

The browser smoke test checks real axe findings, a same-count regression,
configuration changes, and automated accessibility of the generated desktop
and mobile report. It also verifies keyboard scrolling of mobile result tables.
Screenshots are written to `artifacts/`. See [CONTRIBUTING.md](CONTRIBUTING.md).

Built around [axe-core](https://github.com/dequelabs/axe-core) and
[Playwright's accessibility testing workflow](https://playwright.dev/docs/accessibility-testing).
