# PR review record — PR #69 (fix/node-tenure-local-time)

- **Type / slot:** PR-stage / review record (process §5.6)
- **Input identity:** `d60226b7d7d3ce964d3197513dedd8780c73e42f` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597`
- **Depth:** `subtle-correctness` — required PR-stage slots: CodeRabbit, Codex GitHub App, Gemini
- **Author vendor:** Anthropic (Claude)
- **Supersedes:** `pr-review-77a235a9.md`

## Required slots

| Slot | Filled by | Record / evidence | Status |
|---|---|---|---|
| CodeRabbit | `substitute:coderabbit` — Codex CLI (OpenAI) | `substitute-coderabbit-d60226b7.md` | covered; terminal "Review skipped" on every head |
| Codex GitHub App | Codex App reviews at `93e22a7`, `9447b78`, `23fec3c` (OpenAI); fresh review requested at the final head | review ids 5786071769, 5786368691, 5786732545 | findings dispositioned below; a review of the final head (post-`8dcb29d`) is outstanding and this record must be updated if it raises anything |
| Gemini | Gemini bot (Google), advisory comments at `93e22a7` + `9447b78` | findings dispositioned below | covered pending any new finding on the final head |

## Default-blocking findings and dispositions

### Codex App @ `93e22a7` — 11 findings (1 P1, 10 P2), all fixed in `94098a3` + `d4c7541`, verified by the correctness chain (`correctness-74e3c0f9.md`)

### Codex App @ `9447b78` — 3 findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| C1 | P2 | Dawn flag appended despite rejected sunrise telemetry | fixed — `83eed4f`; verified by substitute:coderabbit chained re-review |
| C2 | P2 | `cadenceTenureGate` bypassed on null `first_heard_at` | fixed — `e13e77a` (null = zero tenure → gated 422 on-demand, named in cron `cadenceSkipped`); tested in `cadence-gate.test.mjs`; verified by chained re-review |
| C3 | P2 | `nodeDayWindow` oscillated on skipped-midnight dates | fixed — `e13e77a` (first valid instant of the local date, second-exact); Havana 2026-03-08 + Santiago 2026-09-06 pinned in `nodeTime.test.mjs`; verified by chained re-review |

### Codex App @ `23fec3c` (review 5786732545) — 5 findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| N1 | P2 | Mid-period on-demand reports claimed the full span (`observed.end` capped but not surfaced) | fixed — `212bcd9` (`observed.partial`; "across the first X hours/days" framing); tested in `report-tenure.test.mjs` |
| N2 | P2 | Stale cadence posted after switching to a young node | fixed — `212bcd9` (`activeCadence`); follow-up flaw (frozen memo) fixed — `8dcb29d` |
| N3 | P2 | Tenure began-listening date rendered in UTC | fixed — `212bcd9` (node-local `tenureDescription`); tested in `insight-dawn.test.mjs` |
| N4 | P2 | Early-node prompt kept seasonal inference + "node patterns" window | fixed — `212bcd9` (`observationWindowLine` / `behaviorInferenceBullet`); tested |
| N5 | P2 | NodePage tenure fallback excluded quarantined rows, unlike the server | fixed — `212bcd9` |

### Gemini @ `93e22a7` (advisory comment) — 6 P1 findings

| ID | Finding | Disposition |
|---|---|---|
| G1 | `solarOffset` inverted `Etc/GMT` sign | fixed — `94098a3` (F8) |
| G2 | `labelForHour` neither imported nor defined | **reclassified nit — false positive**: `labelForHour` is a hoisted function declaration (`api/insight.js:92` in that commit; line 112 currently); the call cannot throw ReferenceError. Verified via `git show 93e22a7:api/insight.js` and passing insight-path tests. |
| G3 | `prettyDate` shifted the local period key back a day | fixed — `94098a3` (F4) |
| G4 | Clipped-span check always false | fixed — `94098a3` + `d4c7541` (F5/F9); restructured `83eed4f` |
| G5 | `assemble()` missing `tz` | fixed — `94098a3` (F3) |
| G6 | `cadenceTenureGate` bypassed on null `first_heard_at` | fixed — `e13e77a` (same as C2) |

### Gemini @ `9447b78` (advisory comment) — 1 P1 finding

| ID | Finding | Disposition |
|---|---|---|
| G7 | `labelForHour` never defined or imported | **reclassified nit — false positive**: same hoisted declaration (`api/insight.js:107` in that commit; line 112 currently). Same root as G2. |

## Notes

- Gemini's reviews are advisory comments by design (`gemini-review.yml` posts no commit status). All its findings are nonetheless default-blocking per §5.6 and dispositioned above.
- CodeRabbit never reviewed any head (terminal "Review skipped"), so its slot is filled by `substitute:coderabbit` per § Substitution.
- Reclassifications: G2 and G7 (blocking → nit, false positive, hoisted function declaration). Both are visible here for the merging maintainer per §5.6.
