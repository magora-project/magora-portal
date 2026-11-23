# PR review record — PR #69 (fix/node-tenure-local-time)

- **Type / slot:** PR-stage / review record (process §5.6)
- **Input identity:** `77a235a99e5d54491c8d119f2f35b3505d64c8ae` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597`
- **Depth:** `subtle-correctness` — required PR-stage slots: CodeRabbit, Codex GitHub App, Gemini
- **Author vendor:** Anthropic (Claude)

## Required slots

| Slot | Filled by | Record / evidence | Status |
|---|---|---|---|
| CodeRabbit | `substitute:coderabbit` — Codex CLI (OpenAI) | `substitute-coderabbit-77a235a9.md` | covered; terminal "Review skipped" on every head |
| Codex GitHub App | Codex App review at `9447b78` (OpenAI) | review id 5786368691 | findings dispositioned below; fresh full review requested at the final head (`@codex review` comment) |
| Gemini | Gemini bot (Google), advisory comments at `93e22a7` + `9447b78` | findings dispositioned below | covered pending any new finding on the final head |

## Default-blocking findings and dispositions

### Codex App @ `93e22a7` (review 5786071769) — 11 findings (1 P1, 10 P2), all fixed in `94098a3` + `d4c7541`, verified by the correctness chain (`correctness-74e3c0f9.md`)

### Codex App @ `9447b78` (review 5786368691) — 3 findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| C1 | P2 | Dawn flag appended despite rejected sunrise telemetry (`api/insight.js:357`) | fixed — `83eed4f`; verified by substitute:coderabbit chained re-review |
| C2 | P2 | `cadenceTenureGate` bypassed seasonal/annual on null `first_heard_at` (`api/_report/generate.js:86`) | fixed — `e13e77a` (null = zero tenure → gated; 422 on-demand, named in cron `cadenceSkipped`); tested in `cadence-gate.test.mjs`; verified by chained re-review of `e13e77a` |
| C3 | P2 | `nodeDayWindow` oscillated on skipped-midnight dates (`api/_lib/nodeTime.js:67`) | fixed — `e13e77a` (first valid instant of the local date); Havana + Santiago pinned in `nodeTime.test.mjs`; verified by chained re-review of `e13e77a` |

### Gemini @ `93e22a7` (advisory comment) — 6 P1 findings

| ID | Finding | Disposition |
|---|---|---|
| G1 | `solarOffset` inverted `Etc/GMT` sign (`api/_lib/nodeTime.js:24`) | fixed — `94098a3` (F8) |
| G2 | `labelForHour` neither imported nor defined (`api/insight.js:43`) | **reclassified nit — false positive**: `labelForHour` is a function *declaration* at `api/insight.js:92` in that commit (line 112 currently), hoisted to module top; the call at line 43 cannot throw ReferenceError. Verified by inspection of `git show 93e22a7:api/insight.js` and by the passing insight test paths. |
| G3 | `prettyDate` shifted the local period key back a day (`narrate-report.js:62`) | fixed — `94098a3` (F4) |
| G4 | Clipped-span check always false (`narrate-report.js:83`) | fixed — `94098a3` + `d4c7541` (F5/F9); restructured in `83eed4f` (observed span) |
| G5 | `assemble()` missing `tz` (`payload.js:556`) | fixed — `94098a3` (F3) |
| G6 | `cadenceTenureGate` bypassed on null `first_heard_at` (`generate.js:84`) | fixed — `e13e77a` (same as C2) |

### Gemini @ `9447b78` (advisory comment) — 1 P1 finding

| ID | Finding | Disposition |
|---|---|---|
| G7 | `labelForHour` never defined or imported (`api/insight.js:42`) | **reclassified nit — false positive**: same hoisted function declaration (`api/insight.js:107` in that commit; line 112 currently). Hoisting makes the call safe; the suite's insight-path tests exercise it. Same root as G2. |

## Notes

- Gemini's reviews are posted as advisory comments (no commit status; `gemini-review.yml` gates nothing by design). All its findings are nonetheless default-blocking per §5.6 and dispositioned above.
- CodeRabbit never reviewed any head (terminal "Review skipped"), so its slot is filled by `substitute:coderabbit` per § Substitution.
