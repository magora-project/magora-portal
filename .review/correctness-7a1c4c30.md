# Review record — correctness (pre-push)

- **Type / slot:** pre-push / `correctness`
- **Input identity:** `7a1c4c3071bcdf8a6a10ce65e3fc76e0b39eb552` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), chained `codex review --commit` passes
- **Author vendor:** PENDING — written in GitHub Copilot; model unconfirmed (originally recorded as "Anthropic (Claude)" without evidence). If the model was OpenAI's, this Codex CLI record fails the independence rule.
- **Superseded by:** `correctness-519a3be2.md`
- **Outcome:** `completed` (delta re-review of `087bbcb`, completed with a non-empty recognized result)
- **Verdict:** PASS at the current identity — "no actionable regressions were identified."
- **Supersedes:** `correctness-daaca7f5.md` (identity `daaca7f5a25dc46f3b6a503aad35557764bb2f7f`)

## Inherited findings (all fixed; dispositions unchanged)

F1–F9 (`94098a3`/`d4c7541`), S1–S3 (`83eed4f`), C2/C3 (`e13e77a`), N1–N5 (`212bcd9`), R1 (`8dcb29d`), M1/M3/M4/M5 (`c44132b`), R2 (`1cec893`) — see the superseded records.

## This chain

| ID | Finding | Disposition |
|---|---|---|
| G8 | `node.location.coordinates` undefined on the EWKB (PostgREST) form — solar validation always failed, dawn flag dropped; eBird context skipped (Gemini @4c03aca P1) | fixed — `087bbcb`: both reads use the shared `locationCoordinates` parser (GeoJSON + EWKB); regression test pins the EWKB form |

No undisposed blocking findings remain open in this record.
