# Review record — substitute:coderabbit (PR stage)

- **Type / slot:** PR-stage / `substitute:coderabbit`
- **Input identity:** `a6eb05f4e5dfde59a1f55364af461c8f5f301b0d` (patch-id of the PR diff vs merge base, `.review` excluded)
- **Merge base:** `9b8326d7ef9b96c893df9b18d59a141cc2e27597` (provenance only)
- **Reviewer:** Codex CLI (OpenAI), `codex review --base 9b8326d` full review, then chained `codex review --commit 83eed4f`
- **Author vendor:** Anthropic (Claude)
- **Outcome:** `completed` (full review + chained re-review, both completed with non-empty recognized results)
- **Verdict:** PASS at the current identity — chained re-review: "No actionable regressions were identified."
- **Supersedes:** none
- **Substitution basis:** CodeRabbit's commit status on `9447b78` is terminal "Review skipped" (check-run conclusion `skipped`, output title "Review skipped"). Vendor rule: OpenAI is not the author vendor (Anthropic) and CodeRabbit had no undisposed findings to inherit (it never reviewed).

## Findings (all default-blocking P2; all fixed and verified by the chained re-review)

| ID | Finding | Disposition |
|---|---|---|
| S1 | Clipping `window.start` excluded the first day's midnight-stored pulses from `notablePulses()` | fixed — `83eed4f`: query window stays the full node-local day; clipped span carried separately as `payload.observed` for narration only; test pins a first-day midnight pulse stays in the window |
| S2 | `peakBand()` anchored the local-hour index to `first_heard_at`, corrupting peak timestamps on partial first days and DST transitions | fixed — `83eed4f`: `peakBand` anchors to local midnight and resolves the band's wall-clock start through the timezone (`localHourUtc`); tests pin a partial first day plus 2026-03-08 spring-forward and 2026-11-01 fall-back |
| S3 | Rejected `minutes_from_sunrise` still left the device `dawn_chorus` flag appended to the corrected local time | fixed — `83eed4f`: `localTimeContext` returns a trust flag; the dawn suffix and the soundscape "Dawn chorus active" line are emitted only on a verified solar reading; no derived replacement; tested in `api/insight-dawn.test.mjs` |

Chain: full review of identity at `9447b78` (3 P2) → fix commit `83eed4f` → chained re-review (all fixed, no blocking findings).
