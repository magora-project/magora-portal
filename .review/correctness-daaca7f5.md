# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `daaca7f5a25dc46f3b6a503aad35557764bb2f7f` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), chained `codex review --commit` passes
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (delta re-reviews of `c44132b` and `1cec893`, both completed with non-empty recognized results)
- **Verdict:** PASS at the current identity — re-review of `c44132b` raised one P2 in its own fix (M1's cache bust hid inactive nodes' historical reports); fixed in `1cec893`, whose re-review reports "No actionable regressions were identified in the commit."
- **Supersedes:** `correctness-d60226b7.md` (identity `d60226b7d7d3ce964d3197513dedd8780c73e42f`)

## Inherited findings (all fixed; dispositions unchanged)

F1–F9 (`94098a3`/`d4c7541`), S1–S3 (`83eed4f`), C2/C3 (`e13e77a`), N1–N5 (`212bcd9`), R1 (`8dcb29d`) — see the superseded records.

## This chain

| ID | Finding | Disposition |
|---|---|---|
| M1 | Pre-fix UTC-window daily rows served indefinitely under the same period_key | fixed — `c44132b` (cache trusts only rows whose payload carries `observed`); refined `1cec893` (inactive nodes keep stale rows) |
| M2 | Pre-heartbeat detections counted while narration says listening began at the heartbeat | **kept + documented** — operator decision 2026-11-05: the Pi buffers before its first heartbeat, so those detections are real; the observed span narrates the formal start |
| M3 | ISO week derived from the local-midnight UTC instant | fixed — `c44132b` (`isoWeekOfDate` on the node-local civil date); Auckland Monday pinned in `tenure-span.test.mjs` |
| M4 | `nodeTenure` collapsed lookup failure to empty history | fixed — `c44132b` (primary read throws on non-2xx; failure no longer reads as zero tenure) |
| M5 | Impossible civil dates normalized by `Date.UTC` | fixed — `c44132b` (`isValidLocalDate` rejects 2026-13-01 / 2026-02-30) |
| R2 | M1's bust hid inactive nodes' historical reports | fixed — `1cec893` (stale rows still served when `is_active === false`) |

No undisposed blocking findings remain open in this record.
