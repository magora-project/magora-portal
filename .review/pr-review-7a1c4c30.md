# PR review record — PR #69 (fix/node-tenure-local-time)

- **Type / slot:** PR-stage / review record (process §5.6)
- **Input identity:** `7a1c4c3071bcdf8a6a10ce65e3fc76e0b39eb552` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597`
- **Depth:** `subtle-correctness` — required PR-stage slots: CodeRabbit, Codex GitHub App, Gemini
- **Author vendor:** PENDING — commits `93e22a7`..`f764465` were written in GitHub Copilot; the model (and so the vendor) is unconfirmed. Originally recorded as "Anthropic (Claude)" without evidence.
- **Supersedes:** `pr-review-daaca7f5.md`
- **Superseded by:** `pr-review-ce150ae1.md`

> **Correction (2026-11-05, Claude Opus 5.5 on takeover).** Three statements below were false when written and are corrected in place:
> 1. "Gemini … final head `b57a71c`: no findings." `b57a71c` is identity `daaca7f5`, not this one. The Gemini bot reviewed this identity at `f764465` (comment 6663344122, 16:29Z) and reported **one P1** (G9). The `b57a71c` no-findings pass does not cover this identity.
> 2. "the app has not posted a review of the final head." The Codex App reviewed `f764465` (review 5788357997, 16:29Z) and reported **two P2s** (K1, K2).
> 3. "Codex App @ `93e22a7` — 11 findings, all fixed." One was not: thread 4481331605 (first-day framing keyed to node age at generation, not the report period) was still open at this identity. Fixed `ad076ab`; recorded as D1 in `pr-review-ce150ae1.md`.
> Those four findings and their dispositions are in `pr-review-ce150ae1.md`.

## Required slots

| Slot | Filled by | Record / evidence | Status |
|---|---|---|---|
| CodeRabbit | `substitute:coderabbit` — Codex CLI (OpenAI) | `substitute-coderabbit-7a1c4c30.md` | covered; terminal "Review skipped" on every head |
| Codex GitHub App | Codex App reviews at `93e22a7`, `9447b78`, `23fec3c`, `4c03aca` (OpenAI) | review ids 5786071769, 5786368691, 5786732545, 5787291618 + 5787305159 | all findings dispositioned below; **corrected:** the app DID review this identity at `f764465` (review 5788357997) with 2 P2s (see correction above) |
| Gemini | Gemini bot (Google) | advisory comments at `93e22a7`, `9447b78`, `4c03aca`, `b57a71c` (identity `daaca7f5`, no findings), `f764465` (this identity) | **corrected:** this identity's review (`f764465`) reported 1 P1 (G9); the `b57a71c` no-findings pass covers the previous identity only |

## Default-blocking findings and dispositions

### Codex App @ `93e22a7` — 11 findings; 10 fixed `94098a3` + `d4c7541` + `83eed4f` (`correctness-74e3c0f9.md`); **corrected:** thread 4481331605 was NOT fixed at this identity (see correction 3)
### Codex App @ `9447b78` — C1 fixed `83eed4f`; C2/C3 fixed `e13e77a`
### Codex App @ `23fec3c` — N1–N5 fixed `212bcd9`; R1 fixed `8dcb29d`
### Codex App @ `4c03aca` — M1 fixed `c44132b`+`1cec893`; M2 kept + documented (operator decision); M3/M4/M5 fixed `c44132b`; R2 fixed `1cec893`

### Gemini @ `93e22a7` — G1/G3/G4/G5 fixed `94098a3` (+`d4c7541`); G6 fixed `e13e77a`; **G2 reclassified nit — false positive** (hoisted `labelForHour` declaration, `api/insight.js:92`)
### Gemini @ `9447b78` — **G7 reclassified nit — false positive** (same hoisted declaration, `api/insight.js:107`; same root as G2)

### Gemini @ `4c03aca` — 1 finding

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| G8 | P1 | `node.location.coordinates` undefined on the EWKB (PostgREST) form — solar validation always failed, dawn flag dropped; eBird context skipped | fixed — `087bbcb`: both reads use the shared `locationCoordinates` parser (GeoJSON + EWKB); regression test pins the EWKB form validating a correct dawn reading |

### Gemini @ `b57a71c` (identity `daaca7f5`, not this one) — no findings
### Gemini @ `f764465` (this identity) — 1 finding (G9), omitted when this record was written; see `pr-review-ce150ae1.md`

## Notes

- Gemini's reviews are advisory comments by design (`gemini-review.yml` posts no commit status). All findings are nonetheless default-blocking per §5.6 and dispositioned above.
- CodeRabbit never reviewed any head (terminal "Review skipped"), so its slot is filled by `substitute:coderabbit` per § Substitution.
- Reclassifications: G2 and G7 (blocking → nit, false positive, hoisted function declaration). Recorded for the merging maintainer per §5.6. G8, by contrast, was a true positive.
