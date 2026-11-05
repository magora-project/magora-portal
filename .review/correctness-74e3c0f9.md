# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `74e3c0f98b34d5743d834135a1b06a19961031c8` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), `codex exec --sandbox read-only`
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (initial review + two chained re-reviews, all completed with non-empty recognized results)
- **Verdict:** PASS at final identity — chained re-review #2: "Disposition: fixed. NO BLOCKING FINDINGS."
- **Supersedes:** none

## Findings (all default-blocking P2; all fixed and verified by chained re-review)

| ID | Finding | Disposition |
|---|---|---|
| F1 | On-demand daily `period_key` defaulted to UTC, not the node's local date | fixed — `generateReportForNode` resolves "today" in the node's zone (`api/_report/generate.js`) |
| F2 | `minutes_from_sunrise` trusted without a server-side sunrise check | fixed — validated against NOAA calc (`minutesFromSunriseAt`); mismatch ignored + logged |
| F3 | `assemble()` never received `tz`; `time_zone` always null | fixed — all three builders pass `tz: common.tz` |
| F4 | `prettyDate` shifted the local period key back a day in western zones | fixed — the key is already the local calendar date, rendered unshifted |
| F5 | Clipped daily span never stated (strict `>`; clipped start equals `first_heard_at`) | fixed — `>=` plus span cap at `generated_at` (F9) |
| F6 | Seasonal/annual windows never clipped to `first_heard_at` | fixed — both builders clip like daily |
| F7 | UI cadence gating used lifetime tenure, not in-period tenure | fixed — `reportCadencesForTenure` mirrors server in-period thresholds (≥14 days in season, ≥60 in year) |
| F8 | `Etc/GMT` solar fallback had inverted sign | fixed — POSIX inversion corrected, tests pin both hemispheres |
| F9 | Clipped spans counted future time through `window.end` | fixed — span capped at `generated_at` (`narrate-report.js`) |

Chain: initial review (8 P2) → fix commit `94098a3` → re-review #1 (F1–F4/F6–F8 fixed; F5 partly; new P2 F9) → fix commit `d4c7541` → re-review #2 (all fixed, no blocking findings).
