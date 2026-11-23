# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `d60226b7d7d3ce964d3197513dedd8780c73e42f` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), chained `codex review --commit` passes
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (delta re-reviews of `e13e77a`, `212bcd9`, and `8dcb29d`, all completed with non-empty recognized results)
- **Verdict:** PASS at the current identity — re-review of `212bcd9` raised one P2 in its own fix (memoized cadence eligibility froze across time boundaries); fixed in `8dcb29d`, whose re-review reports "no actionable regressions were identified."
- **Supersedes:** `correctness-77a235a9.md` (identity `77a235a99e5d54491c8d119f2f35b3505d64c8ae`)

## Inherited findings (all fixed; dispositions unchanged)

F1–F9 (`94098a3`/`d4c7541`), S1–S3 (`83eed4f`), C2/C3 (`e13e77a`) — see the superseded records.

## This chain

| ID | Finding | Disposition |
|---|---|---|
| N1 | `observedSpan` end-capped mid-period but narration still claimed the full span | fixed — `212bcd9` (`partial` flag; elapsed-hours/days framing); tested in `report-tenure.test.mjs` |
| N2 | Stale cadence posted after switching to a young node | fixed — `212bcd9` (`activeCadence` fallback in `useNodeReport`) |
| N3 | Tenure began-listening date rendered in UTC | fixed — `212bcd9` (node-local via `tenureDescription`); tested in `insight-dawn.test.mjs` |
| N4 | Early-node prompt kept seasonal inference + "node patterns" window label | fixed — `212bcd9` (`observationWindowLine` / `behaviorInferenceBullet`); tested |
| N5 | NodePage tenure fallback excluded quarantined rows, unlike the server | fixed — `212bcd9` (range filter dropped from the fallback query) |
| R1 | N2's `useMemo` froze time-dependent eligibility | fixed — `8dcb29d` (re-derive per render; NodePage's 30s refresh drives it) |

No undisposed blocking findings remain open in this record.
