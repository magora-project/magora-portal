# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `a6eb05f4e5dfde59a1f55364af461c8f5f301b0d` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), `codex review` non-interactive
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (delta re-review of `9447b78`..`83eed4f` against the superseded identity, completed with a non-empty recognized result)
- **Verdict:** PASS at the current identity — "No actionable regressions were identified in the commit. The observed-span separation preserves query coverage, and the dawn-flag trust gate is applied consistently; both new targeted test suites pass."
- **Supersedes:** `correctness-74e3c0f9.md` (identity `74e3c0f98b34d5743d834135a1b06a19961031c8`)

## Inherited findings (from the superseded record; all fixed, dispositions unchanged)

| ID | Finding | Disposition |
|---|---|---|
| F1 | On-demand daily `period_key` defaulted to UTC | fixed — `94098a3` |
| F2 | `minutes_from_sunrise` trusted without server-side check | fixed — `94098a3` |
| F3 | `assemble()` never received `tz` | fixed — `94098a3` |
| F4 | `prettyDate` shifted the local period key back a day | fixed — `94098a3` |
| F5 | Clipped daily span never stated | fixed — `94098a3` + `d4c7541` |
| F6 | Seasonal/annual windows never clipped to `first_heard_at` | fixed — `94098a3` (superseded in form by S1: clipping moved out of the query window into `payload.observed`, `83eed4f`) |
| F7 | UI cadence gating used lifetime tenure | fixed — `94098a3` |
| F8 | `Etc/GMT` solar fallback had inverted sign | fixed — `94098a3` |
| F9 | Clipped spans counted future time through `window.end` | fixed — `d4c7541` |

## Delta question ("did the fixes break anything, is anything blocking still open?")

The delta (`9447b78`..`83eed4f`) restructures the F6 fix per substitute:coderabbit finding S1: the query window is no longer narrowed; the clipped span is carried as `payload.observed` and consumed only by narration. The re-review verified the new `observedSpan`/`localHourUtc` behavior, the DST-safe `peakBand` anchor, and the S3 dawn-flag trust gate. No undisposed blocking findings remain open in this record.
