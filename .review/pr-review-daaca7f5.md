# PR review record — PR #69 (fix/node-tenure-local-time)

- **Type / slot:** PR-stage / review record (process §5.6)
- **Input identity:** `daaca7f5a25dc46f3b6a503aad35557764bb2f7f` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597`
- **Depth:** `subtle-correctness` — required PR-stage slots: CodeRabbit, Codex GitHub App, Gemini
- **Author vendor:** Anthropic (Claude)
- **Supersedes:** `pr-review-d60226b7.md`

## Required slots

| Slot | Filled by | Record / evidence | Status |
|---|---|---|---|
| CodeRabbit | `substitute:coderabbit` — Codex CLI (OpenAI) | `substitute-coderabbit-daaca7f5.md` | covered; terminal "Review skipped" on every head |
| Codex GitHub App | Codex App reviews at `93e22a7`, `9447b78`, `23fec3c`, `4c03aca` (OpenAI) | review ids 5786071769, 5786368691, 5786732545, 5787291618 + 5787305159 | findings dispositioned below; a review of the final head (post-`1cec893`) is outstanding and this record must be updated if it raises anything |
| Gemini | Gemini bot (Google), advisory comments at `93e22a7` + `9447b78` | findings dispositioned below | covered pending any new finding on the final head |

## Default-blocking findings and dispositions

### Codex App @ `93e22a7` — 11 findings (1 P1, 10 P2), all fixed in `94098a3` + `d4c7541` (correctness chain, `correctness-74e3c0f9.md`)

### Codex App @ `9447b78` — 3 findings: C1 fixed `83eed4f`; C2/C3 fixed `e13e77a` (see `pr-review-d60226b7.md`)

### Codex App @ `23fec3c` — 5 findings: N1–N5 fixed `212bcd9`; R1 (follow-up) fixed `8dcb29d` (see `pr-review-d60226b7.md`)

### Codex App @ `4c03aca` (reviews 5787291618 + 5787305159) — 6 findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| M1 | P1 | Pre-fix UTC-window daily rows served indefinitely under the same period_key | fixed — `c44132b` (cache trusts only rows whose payload carries `observed`); refined `1cec893` so inactive nodes keep their historical stale rows readable |
| M2 | P2 | Pre-heartbeat detections counted while narration says listening began at the heartbeat | **kept + documented** (operator decision 2026-11-05): the Pi buffers audio before its first heartbeat; those detections are real observations of the day. The observed span narrates the formal listening start. Documented in `buildDailyReport`. |
| M3 | P2 | ISO week derived from the local-midnight UTC instant | fixed — `c44132b` (`isoWeekOfDate` on the node-local civil date); Auckland Monday 2027-01-04 pinned in `tenure-span.test.mjs` |
| M4 | P2 | `nodeTenure` collapsed lookup failure to empty history | fixed — `c44132b` (primary read throws on non-2xx; a transient failure no longer reads as zero tenure / false 422) |
| M5 | P2 | Impossible civil dates normalized by `Date.UTC` | fixed — `c44132b` (`isValidLocalDate` rejects 2026-13-01 / 2026-02-30) |
| R2 | P2 | M1's cache bust hid inactive nodes' historical reports (raised on the fix) | fixed — `1cec893`; verified by chained re-review |

### Gemini @ `93e22a7` (advisory) — 6 P1: G1 fixed `94098a3`; G3 fixed `94098a3`; G4 fixed `94098a3`+`d4c7541`; G5 fixed `94098a3`; G6 fixed `e13e77a`. G2 **reclassified nit — false positive** (hoisted `labelForHour` declaration, `api/insight.js:92` in that commit).

### Gemini @ `9447b78` (advisory) — 1 P1: G7 **reclassified nit — false positive** (same hoisted `labelForHour` declaration, `api/insight.js:107` in that commit; same root as G2).

## Notes

- Gemini's reviews are advisory comments by design (`gemini-review.yml` posts no commit status). All its findings are nonetheless default-blocking per §5.6 and dispositioned above.
- CodeRabbit never reviewed any head (terminal "Review skipped"), so its slot is filled by `substitute:coderabbit` per § Substitution.
- Reclassifications: G2 and G7 (blocking → nit, false positive, hoisted function declaration). Recorded for the merging maintainer per §5.6.
