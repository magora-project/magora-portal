# Review record — substitute:coderabbit (PR stage)

- **Type / slot:** PR-stage / `substitute:coderabbit`
- **Input identity:** `d60226b7d7d3ce964d3197513dedd8780c73e42f` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), `codex review --base 9b8326d` full review, then chained re-reviews of `83eed4f`, `e13e77a`, `212bcd9`, `8dcb29d`
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (full review + four chained re-reviews, all completed with non-empty recognized results)
- **Verdict:** PASS at the current identity — final chained re-review: "no actionable regressions were identified."
- **Supersedes:** `substitute-coderabbit-77a235a9.md` (identity `77a235a99e5d54491c8d119f2f35b3505d64c8ae`)
- **Substitution basis:** CodeRabbit's commit status is terminal "Review skipped" on every head of this PR. Vendor rule: OpenAI is not the author vendor (Anthropic); CodeRabbit never reviewed, so there were no undisposed findings to inherit.

## Findings (all default-blocking P2; all fixed and verified by chained re-reviews)

| ID | Finding | Disposition |
|---|---|---|
| S1 | Clipped `window.start` excluded midnight-stored pulses | fixed — `83eed4f` |
| S2 | `peakBand` anchored to `first_heard_at`, not local midnight | fixed — `83eed4f` |
| S3 | Rejected sunrise still carried the device dawn flag | fixed — `83eed4f` |
| C2/C3 (echoes) | Codex App's null-tenure bypass + skipped-midnight oscillation | fixed — `e13e77a` |
| N1–N5 (echoes) | Codex App's `23fec3c` findings (partial framing, stale cadence, UTC tenure date, early-node prompt, tenure fallback parity) | fixed — `212bcd9` |
| R1 | `useMemo` in the N2 fix froze time-based eligibility | fixed — `8dcb29d` |

Chain: full review at `9447b78` (3 P2) → `83eed4f` → re-review (clean) → `e13e77a` → re-review (clean) → `212bcd9` → re-review (1 P2, R1) → `8dcb29d` → re-review (clean). One round's finding sat in that round's own fix once (R1); the stop rule (two such rounds in a row) is not triggered.
