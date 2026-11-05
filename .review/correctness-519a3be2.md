# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `519a3be249ff7f099b38bda677dece4ba1cf36cf` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI 0.164.0, model `gpt-6.1-sol` (OpenAI); `codex exec --sandbox read-only`, delta re-review of `git diff f764465 HEAD`
- **Author vendor:** delta commits `694cf94`, `9283b0c`, `b535fe8`: Anthropic (Claude Opus 5.5). Earlier commits `93e22a7`..`f764465`: **PENDING** (written in GitHub Copilot; model unconfirmed)
- **Outcome:** `completed` (non-empty, recognized result)
- **Verdict:** PASS on the delta — "No actionable findings. VERDICT: PASS"
- **Supersedes:** `correctness-7a1c4c30.md` (identity `7a1c4c3071bcdf8a6a10ce65e3fc76e0b39eb552`)
- **Superseded by:** `correctness-ce150ae1.md` (fix commit `ad076ab` changed the identity)
- **Validity of the chain:** PENDING. If the Copilot model was OpenAI's, every Codex CLI record in this chain fails the independence rule and `correctness` must be re-run in full by Anthropic (Opus or Fable).

## Question asked

Do `694cf94`/`9283b0c`/`b535fe8` fully resolve K1 and K2? Did the fixes break anything (the other `nodeTenure` callers in `api/_report/generate.js` and `api/_report/payload.js` now see throws from the fallback path too; `api/insight.js` now catches tenure failures)? Can the new tests fail?

## Inherited findings

None undisposed. Earlier chains: F1–F9, S1–S3, C2/C3, N1–N5, R1, M1/M3/M4/M5, R2, G8: all fixed, see the superseded records.

## This chain

| ID | Finding | Disposition |
|---|---|---|
| K1 | Codex App @`f764465` P2, `api/_lib/nodeTime.js:146`: the detection-fallback tenure lookup used `pgFetch`, so a failed query read as zero tenure | fixed — `694cf94`: fallback uses the failure-preserving `firstRowOrThrow`; `api/insight-tenure.test.mjs` T1 |
| K2 | Codex App @`f764465` P2, `api/insight.js:400`: a node-less request defaulted to a mature 14-day node (pattern window, seasonal inference) | fixed — `694cf94`: null tenure is UNKNOWN → first-impression framing; a failed lookup degrades to unknown; T2 incl. end-to-end prompt tests |

Fail-first check: `api/insight-tenure.test.mjs` run against `f764465` sources fails (two T1 FAILs; T2 cannot import the new helpers).

Local checks at `b535fe8`: `npm test` 27 files pass; `npm run lint:ratchet` ok; `npm run build` ok.
