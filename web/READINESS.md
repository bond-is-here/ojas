# Ojas release readiness

The improvement loop is active. A passing build alone does not establish customer readiness.

## Required gates

- Account isolation for every health record, including manual logs and goals; explicit recovery of legacy browser records.
- Honest empty, loading, saving, error, and retry states. Sample data must never silently inflate personal totals.
- Durable recovery of pending manual and workout edits; safe concurrent tabs, duplicate requests, and account switches.
- Complete workout flows: start, edit plan and sets, pause, correct duration, finish, revisit, and resolve conflicts.
- Trustworthy imports: valid streamed Apple XML, per-metric device choices, covered-window reconciliation, and retry/cancel behavior.
- Wearable authorization and refresh remain correct during outages, reauthorization, and overlapping requests.
- Desktop/mobile interaction, keyboard, focus, readable layouts, reduced motion, and accessible status checks.
- Repeatable automated checks, isolated compiled-Worker tests, migration validation, and private deployment verification.
- Customer onboarding and data controls, including clear account/storage status and usable data export.
- Real-account wearable authorization and the intended customer access policy must be verified before claiming a public customer launch is ready.

## Completed in this pass

- Moved manual records, goals, and preferences to account-scoped D1 storage. New accounts start empty. Legacy browser entries require an explicit ownership/import action.
- Added per-request recovery for manual saves and durable workout journals. Account switches, stale responses, duplicate requests, and late acknowledgments cannot silently overwrite another account or another tab's pending log.
- Preserved duration edits on Escape, repeated strength weights, fractional set weights, and recovery across interrupted saves. Plan fields lock while saving; reset restores the automatic exercise template.
- Bound source requests to the displayed account. Reauthorization invalidates older sync leases; temporary token-service outages remain retryable.
- Reworked Apple XML parsing and per-metric source selection. Imports reconcile only the selected snapshot window and metrics, reject malformed snapshots, and protect newer history from older exports. The actual built browser worker now loads from a served JavaScript asset.
- Added account and browser-recovery exports, clear account/loading/save states, and append-only migrations through 0004. An upgrade from existing 0000/0001 data preserved imported records and workout payloads.
- Added GitHub checks for type checking, lint, regression tests, build, and isolated compiled-Worker smoke tests.

## Verification

The regression suite has 90 passing tests. Compiled-Worker checks use a stable Miniflare/workerd server, snapshotted build output, a fresh temporary database, and synthetic accounts to exercise authorization, source reconciliation, workout concurrency, workspace persistence, exports, malformed response recovery, persisted sync cooldowns, rolling provider budgets, and the actual served Apple parsing worker. Type checking, lint, and the production build pass.

Browser testing was explicitly authorized and performed on desktop and a 390 × 844 mobile viewport. Verified quick water and meal logging, persistence after reload, fractional set editing, corrected duration on Escape, workout completion, mobile plan editing/reset, per-metric Apple preview/import, and account export download. With the local server stopped, workout edits remained recoverable; a fresh tab restored the exact notes and 12-minute duration and completed the session once. Synthetic fixtures were used; live personal records were not modified for testing.

Private version 5 deployed successfully. The live account dashboard, source status, and data controls loaded without browser errors; the production error log was empty during verification. Unauthenticated access still returned 401.

The first CI run exposed a test-server failure: Wrangler's development proxy returned a plain-text 503 because it restarted during a POST. The smoke runner now uses one Miniflare instance without the development proxy or file watcher. It exercises the same compiled server and assets, adds no request retries, and passes locally. CI verification of this fix remains pending.

## Remaining launch checks

- Complete real WHOOP and Oura authorization, refresh, revocation, and reconnect flows with real provider apps and test accounts. Simulated token and API tests do not establish provider approval or real-account compatibility.
- Decide and verify customer onboarding. Current wearable setup requires each account's developer-app credentials; the current publication is private to its owner. Customer access must be explicitly configured and tested before a wider launch.
- Verify the stable compiled-Worker test runner on CI. Do not label the product ready based only on local checks.
