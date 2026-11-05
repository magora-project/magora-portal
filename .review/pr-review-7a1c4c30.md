# PR review record — PR #69 (fix/node-tenure-local-time)

- **Type / slot:** PR-stage / review record (process §5.6)
- **Input identity:** `7a1c4c3071bcdf8a6a10ce65e3fc76e0b39eb552` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597`
- **Depth:** `subtle-correctness` — required PR-stage slots: CodeRabbit, Codex GitHub App, Gemini
- **Author vendor:** Anthropic (Claude)
- **Supersedes:** `pr-review-daaca7f5.md`

## Required slots

| Slot | Filled by | Record / evidence | Status |
|---|---|---|---|
| CodeRabbit | `substitute:coderabbit` — Codex CLI (OpenAI) | `substitute-coderabbit-7a1c4c30.md` | covered; terminal "Review skipped" on every head |
| Codex GitHub App | Codex App reviews at `93e22a7`, `9447b78`, `23fec3c`, `4c03aca` (OpenAI) | review ids 5786071769, 5786368691, 5786732545, 5787291618 + 5787305159 | all findings dispositioned below; the app has not posted a review of the final head (`b57a71c`, evidence-only on top of `1cec893`/`087bbcb`) — the chained substitute re-reviews cover those commits |
| Gemini | Gemini bot (Google) | advisory comments at `93e22a7`, `9447b78`, `4c03aca`, and **final head `b57a71c`** | final-head review: **no findings** (2026-11-05T15:51Z); earlier findings dispositioned below |

## Default-blocking findings and dispositions

### Codex App @ `93e22a7` — 11 findings, all fixed `94098a3` + `d4c7541` (`correctness-74e3c0f9.md`)
### Codex App @ `9447b78` — C1 fixed `83eed4f`; C2/C3 fixed `e13e77a`
### Codex App @ `23fec3c` — N1–N5 fixed `212bcd9`; R1 fixed `8dcb29d`
### Codex App @ `4c03aca` — M1 fixed `c44132b`+`1cec893`; M2 kept + documented (operator decision); M3/M4/M5 fixed `c44132b`; R2 fixed `1cec893`

### Gemini @ `93e22a7` — G1/G3/G4/G5 fixed `94098a3` (+`d4c7541`); G6 fixed `e13e77a`; **G2 reclassified nit — false positive** (hoisted `labelForHour` declaration, `api/insight.js:92`)
### Gemini @ `9447b78` — **G7 reclassified nit — false positive** (same hoisted declaration, `api/insight.js:107`; same root as G2)

### Gemini @ `4c03aca` — 1 finding

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| G8 | P1 | `node.location.coordinates` undefined on the EWKB (PostgREST) form — solar validation always failed, dawn flag dropped; eBird context skipped | fixed — `087bbcb`: both reads use the shared `locationCoordinates` parser (GeoJSON + EWKB); regression test pins the EWKB form validating a correct dawn reading |

### Gemini @ `b57a71c` (final head) — **no findings**

## Notes

- Gemini's reviews are advisory comments by design (`gemini-review.yml` posts no commit status). All findings are nonetheless default-blocking per §5.6 and dispositioned above.
- CodeRabbit never reviewed any head (terminal "Review skipped"), so its slot is filled by `substitute:coderabbit` per § Substitution.
- Reclassifications: G2 and G7 (blocking → nit, false positive, hoisted function declaration). Recorded for the merging maintainer per §5.6. G8, by contrast, was a true positive.
