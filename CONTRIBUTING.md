# Contributing

Use Node.js 22 or newer. Install with `npm ci`, then run `npm test`.
For integration checks, run `npx playwright install chromium` and `npm run test:browser`.
An installed browser channel can be selected with `LEDGER_BROWSER_CHANNEL` (for example, `msedge`).
`npm run demo` regenerates the synthetic files in `artifacts/`.

Keep changes focused. Include a reproduction for bugs and a test for changes to
finding identity, coverage, expiry, or gate behavior. Never replace the gate with
a comparison of total violation counts. Preserve nested iframe/shadow targets.
Do not automatically approve, extend, or delete exceptions during a check.

Use synthetic fixtures without credentials, private page content, or customer
data. Report rendering must escape all untrusted strings and must not execute
scripts. The report's automated accessibility audit is a regression check, not
a substitute for keyboard and assistive-technology testing.

The project uses the MIT license. Contributions are made under that license.
