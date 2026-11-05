# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `ce150ae14b862680ffd54d792346b72ab666a2c8` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI 0.164.0, model `gpt-6.1-sol` (OpenAI); `codex exec --sandbox read-only`, delta re-review of `git diff b535fe8 ad076ab`
- **Author vendor:** delta commit `ad076ab`: Anthropic (Claude Opus 5.5). Earlier commits `93e22a7`..`f764465`: **PENDING** (GitHub Copilot; model unconfirmed)
- **Outcome:** `completed` (non-empty, recognized result)
- **Verdict:** PASS on the delta — "No actionable findings. VERDICT: PASS"
- **Supersedes:** `correctness-519a3be2.md` (identity `519a3be249ff7f099b38bda677dece4ba1cf36cf`, PASS)
- **Validity of the chain:** PENDING. If the Copilot model was OpenAI's, every Codex CLI record in this chain fails the independence rule and `correctness` must be re-run in full by Anthropic (Opus or Fable).

## Question asked

Does `ad076ab` fully fix D1? Did it break anything (no-history nodes with `first_heard_at` null, payloads missing `window`, reports for days before `first_heard_at`, cached legacy payloads)? Can the new tests in `api/_report/report-tenure.test.mjs` fail?

## Inherited findings

K1, K2 (fixed `694cf94`, PASS in `correctness-519a3be2.md`); earlier chains all fixed (see superseded records). None undisposed.

## This chain

| ID | Finding | Disposition |
|---|---|---|
| D1 | Codex App @`93e22a7` P2 (thread 4481331605), `api/_report/narrate-report.js:78`: "new to my records" suppressed only while the node was < 24h old at generation, so the 10:00 UTC cron and regenerations of the first day restored it. Recorded as fixed in earlier records; it was not. | fixed — `ad076ab`: a daily report is first-day when its window contains `first_heard_at`; two new cases in `report-tenure.test.mjs` fail on the previous code |

Local checks at `ad076ab`: `npm test` 27 files pass; `npm run lint:ratchet` ok; `npm run build` ok.
