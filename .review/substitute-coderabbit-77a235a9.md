# Review record — substitute:coderabbit (PR stage)

- **Type / slot:** PR-stage / `substitute:coderabbit`
- **Input identity:** `77a235a99e5d54491c8d119f2f35b3505d64c8ae` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), `codex review --base 9b8326d` full review, then chained re-reviews of `83eed4f` and `e13e77a`
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (full review + two chained re-reviews, all completed with non-empty recognized results)
- **Verdict:** PASS at the current identity — final chained re-review: "No actionable regressions were found in the commit."
- **Supersedes:** `substitute-coderabbit-a6eb05f4.md` (identity `a6eb05f4e5dfde59a1f55364af461c8f5f301b0d`)
- **Substitution basis:** CodeRabbit's commit status is terminal "Review skipped" on every head of this PR (check-run conclusion `skipped`, output title "Review skipped"). Vendor rule: OpenAI is not the author vendor (Anthropic); CodeRabbit never reviewed, so there were no undisposed findings to inherit.

## Findings (all default-blocking P2; all fixed and verified by chained re-reviews)

| ID | Finding | Disposition |
|---|---|---|
| S1 | Clipping `window.start` excluded the first day's midnight-stored pulses | fixed — `83eed4f`; re-review of `83eed4f` verified |
| S2 | `peakBand` anchored the local-hour index to `first_heard_at` | fixed — `83eed4f`; re-review of `83eed4f` verified |
| S3 | Rejected `minutes_from_sunrise` still carried the device dawn flag | fixed — `83eed4f`; re-review of `83eed4f` verified |
| C2-echo | (Raised independently by the Codex App at `9447b78`) null-tenure gate bypass | fixed — `e13e77a`; re-review of `e13e77a` verified |
| C3-echo | (Raised independently by the Codex App at `9447b78`) skipped-midnight oscillation | fixed — `e13e77a`; re-review of `e13e77a` verified |

Chain: full review at `9447b78` (3 P2) → fix `83eed4f` → re-review #1 (all fixed) → fix `e13e77a` (Codex App's two open findings, adopted into this record) → re-review #2 (all fixed, no blocking findings).
