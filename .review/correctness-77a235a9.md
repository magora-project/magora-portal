# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `77a235a99e5d54491c8d119f2f35b3505d64c8ae` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), `codex review --commit e13e77a`
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (delta re-review of `23fec3c`..`e13e77a` against the superseded identity, completed with a non-empty recognized result)
- **Verdict:** PASS at the current identity — "No actionable regressions were found in the commit. The null-tenure gate and skipped-midnight boundary handling match the intended behavior, and both affected test suites pass."
- **Supersedes:** `correctness-a6eb05f4.md` (identity `a6eb05f4e5dfde59a1f55364af461c8f5f301b0d`)

## Inherited findings (from the superseded chain; all fixed, dispositions unchanged)

| ID | Finding | Disposition |
|---|---|---|
| F1 | On-demand daily `period_key` defaulted to UTC | fixed — `94098a3` |
| F2 | `minutes_from_sunrise` trusted without server-side check | fixed — `94098a3` |
| F3 | `assemble()` never received `tz` | fixed — `94098a3` |
| F4 | `prettyDate` shifted the local period key back a day | fixed — `94098a3` |
| F5 | Clipped daily span never stated | fixed — `94098a3` + `d4c7541` |
| F6 | Seasonal/annual windows never clipped | fixed — `94098a3`; restructured `83eed4f` (observed span) |
| F7 | UI cadence gating used lifetime tenure | fixed — `94098a3` |
| F8 | `Etc/GMT` solar fallback inverted sign | fixed — `94098a3` |
| F9 | Clipped spans counted future time | fixed — `d4c7541` |
| S1 | Clipped window dropped midnight-stored pulses | fixed — `83eed4f` |
| S2 | `peakBand` anchored to `first_heard_at`, not local midnight | fixed — `83eed4f` |
| S3 | Rejected sunrise still carried the device dawn flag | fixed — `83eed4f` |
| C2 | `cadenceTenureGate` bypassed on null `first_heard_at` | fixed — `e13e77a` (null = zero tenure; gated) |
| C3 | `nodeDayWindow` oscillated on skipped-midnight dates | fixed — `e13e77a` (first valid instant of the local date) |

## Delta question ("did the fixes break anything, is anything blocking still open?")

The delta changes `cadenceTenureGate` (null tenure → zero days → gated) and `wallMidnightUtc`/`firstInstantOfLocalDate` (skipped-midnight zones). Re-review verified both, with tests pinning null-tenure gating in both hemispheres and both named skipped-midnight zones plus their neighboring normal days. No undisposed blocking findings remain open in this record.
