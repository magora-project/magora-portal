# PR review record — PR #69 (fix/node-tenure-local-time)

- **Type / slot:** PR-stage / review record (process §5.6)
- **Input identity:** `ce150ae14b862680ffd54d792346b72ab666a2c8` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597`
- **Depth:** `subtle-correctness` — required PR-stage slots: CodeRabbit, Codex GitHub App, Gemini
- **Author vendor:** `93e22a7`..`f764465`: **PENDING** (GitHub Copilot; model unconfirmed). `694cf94`..: Anthropic (Claude Opus 5.5)
- **Supersedes:** `pr-review-7a1c4c30.md` (which carried three false statements, corrected in place there)

## Required slots

| Slot | Filled by | Record / evidence | Status |
|---|---|---|---|
| CodeRabbit | `substitute:coderabbit`, Codex CLI (OpenAI) | `substitute-coderabbit-7a1c4c30.md` (previous identity) | **OPEN.** No substitute at this identity, and validity is **PENDING a ruling from David**: OpenAI is already counted via the Codex App slot (§ Substitution: "a vendor not already counted on the PR"). CodeRabbit's status is terminal "Review skipped" on every head. |
| Codex GitHub App | Codex App (OpenAI) | reviews 5786071769, 5786368691, 5786732545, 5787291618, 5787305159, 5788357997 (`f764465`) | **OPEN** until the app reviews the fix head: K1/K2 need same-bot coverage on `694cf94` or later. `@codex review` requested after push. |
| Gemini | Gemini bot (Google) | advisory comments through `f764465` | **OPEN** until the bot runs at the new head (the workflow runs on push). |

## Default-blocking findings and dispositions

Earlier rounds: see `pr-review-7a1c4c30.md` (Codex App: 10 of 11 @`93e22a7` (the 11th is D1 below), C1–C3, N1–N5, R1, M1–M5, R2; Gemini: G1–G8, G2/G7 reclassified). M2 remains "kept + documented (operator decision)", pending Noah's separate confirmation. G8 (fixed `087bbcb`): the Gemini bot's later review at `f764465` gives coverage after the fix commit and did not re-raise it.

### Codex App @ `93e22a7` — 1 finding previously mis-recorded as fixed

| ID | Severity | Thread | Finding | Disposition |
|---|---|---|---|---|
| D1 | P2 | 4481331605 | `api/_report/narrate-report.js:78`: "new to my records" suppressed only while the node was < 24h old at generation time; the 10:00 UTC cron and first-day regenerations restored it | fixed — `ad076ab` (found while verifying threads before resolving them) |

### Codex App @ `f764465` (review 5788357997) — 2 findings

| ID | Severity | Thread | Finding | Disposition |
|---|---|---|---|---|
| K1 | P2 | 4483091946 | `api/_lib/nodeTime.js:146`: the detection-fallback lookup used `pgFetch`, so a transient failure read as zero tenure (false 422s, wrong first-listening framing) | fixed — `694cf94` |
| K2 | P2 | 4483091955 | `api/insight.js:400`: a node-less fallback request defaulted to a mature 14-day node (node-pattern window, seasonal and longitudinal inference) | fixed — `694cf94` |

### Gemini @ `f764465` (comment 6663344122) — 1 finding

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| G9 | P1 | `api/_lib/nodeTime.js:30`: solar fallback returns "invalid" `Etc/GMT+0` / `Etc/GMT-0` near the meridian; claimed `tzLookup` throws over ocean and `Intl` then throws `RangeError` | **reclassified nit — false positive.** `Etc/GMT+0` and `Etc/GMT-0` are valid IANA links to `Etc/GMT`; on Node 24.15.0 both format correctly, every fallback zone for lon −5.5…+5.5 formats as UTC, and `tz-lookup` returns an `Etc/GMT±N` zone over open ocean (e.g. lat 0, lon −3) rather than throwing. Evidence pinned in `api/_lib/nodeTime.test.mjs` by `9283b0c` (test-only, no code change). |

## Reclassifications

- G2, G7 (earlier): blocking → nit, false positive (hoisted function declaration).
- **G9:** blocking → nit, false positive. Reason: the zone names it calls invalid are valid and tested on the runtime.

## Notes

- Pre-push: `correctness-ce150ae1.md` PASS (delta, chained from `correctness-519a3be2.md`); `completeness-ce150ae1.md` **failed/unrun**.
- None of the 27 review threads had been resolved before this round. Before resolving, each claimed fix was checked against the current code (D1 was not fixed and was fixed here). 26 threads are resolved, each with a reply naming its fix commit; thread 4482263239 (M2) stays open pending Noah's confirmation of the operator decision. K1/K2/D1 still need the Codex App's coverage of `ad076ab` or later before the gate accepts them.
- Thread 4481331536 (clip seasonal/annual): narration fixed (`94098a3` F6, restructured `83eed4f` as `observed`). Its `edgeTrend` concern degrades safely: an early edge before the node existed has no ACI rows, so `trend` is null rather than a false comparison.
- `694cf94`'s message and a test name call the heartbeat-failure fix "M5"; it is M4.
- `b535fe8` removes `docs/tasks/handoff-villa-magora-firstrun-debug-2026-11-04.md` (out of scope; added accidentally in `94098a3`).
