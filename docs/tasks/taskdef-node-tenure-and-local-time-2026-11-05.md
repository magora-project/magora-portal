# TaskDef — Node tenure + node-local time on NodePage surfaces (2026-11-05)

Source: Magora Architect. Decisions CONFIRMED by Noah 2026-11-05. No migration.

## Problem
Villa Magora (`7fe2f0d2-932a-404a-9c83-cbdd6a837ee9`, Terlingua; first heartbeat ~2026-11-04 19:22 UTC) narrates as if it has listened for weeks, and its time-of-day is wrong.

- `api/insight.js` `buildNodeInsightPrompt` hardcodes tenure ("a long-term ... monitoring initiative", "You've been watching what lives here across seasons", "Weave in one thread from the pattern being built at this node over time") and always frames counts as "the past 14 days".
- No tenure fact exists in `api/_report`, `api/_pulse`, `api/_narrative` payloads.
- NodePage report card offers "this season"/"this year" to a <1-day-old node; seasonal window is the full calendar season.
- `api/insight.js` `localTimeContext` falls back to a hardcoded UTC−6 ("Mountain Time"). It prefers the Pi's `minutes_from_sunrise`, which depends on the Pi's own location config (unverified for Villa Magora).
- `api/_report/payload.js`, `api/_report/narrate-report.js`, `api/_pulse/core.js`: daily window = UTC calendar day; hour histogram uses `getUTCHours()`; dates rendered `timeZone: 'UTC'`.

## Decisions (confirmed)
1. Node age = from its **first heartbeat**: `first_heard_at` = min `aci_logs.recorded_at` for the node (fallback: min `detections.detected_at`). Not `nodes.created_at`. Bench time counts. Derived at read time.
2. Node time = **derived from its coordinates**: IANA zone from `nodes.location` at runtime (small lookup lib, e.g. `tz-lookup`), formatting via `Intl.DateTimeFormat({ timeZone })`. No stored timezone column.
3. Payload-first: tenure + local-time facts are computed and passed in; prompts never assert duration or time on their own. LLM renders, never invents.

## Tasks
Precondition: PR #68 (`fix/node-coordinate-hemispheres`) merged to `main`; branch fresh off `main`.

T1 — shared primitives (`api/_lib/nodeTime.js` or equivalent)
- `nodeTimeZone(node)`; fallback to longitude solar offset if lookup fails.
- `toNodeLocal(utc, tz)` → `{ date, hour, minute }`; `nodeDayWindow(date, tz)` → `[start,end)` UTC for that local day, DST-safe.
- `nodeTenure(nodeId)` → `{ first_heard_at, hours_listening, days_listening }`. Confirm an index covers `aci_logs(node_id, recorded_at)`.
- Tests: Terlingua (America/Chicago), Gardiner (America/Denver), a DST-boundary day, node with zero aci_logs.

T2 — `api/insight.js` node prompt
- Remove the hardcoded tenure language above.
- Window = min(14 days, tenure), stated factually ("This node began listening on Nov 4, about 16 hours ago"). Tenure < 3 days → first impression; no patterns/trends/seasons at this node.
- Time of day from T1. Use `minutes_from_sunrise` only if within ~30 min of a server-side sunrise calc for the node's coordinates; else ignore and log once. Delete the UTC−6 branch.

T3 — Reports + Pulse
- Daily window = node-local day; `period_key` = local date; hour histogram, `hourLabel`, rendered dates all node-local.
- Clip window start to `first_heard_at`; add `tenure` to report payload; narration states the real span when shorter than the cadence span.
- Cadence gating: seasonal only with ≥14 days of tenure in that season; annual only with ≥60 days in the year. NodePage selector hides below threshold (or "I've only been listening since <date>"). Batch cron skips the same and notes it in the `[report ops]` digest.
- Suppress "new to my records" framing during the node's first day.
- Pulse on-demand window → node-local day; confirm/document that the 10:00 UTC batch lands after US nodes' local day closes.

T4 — Verify (after deploy; test UNCACHED cases)
- Villa Magora insight: real tenure, no seasonal/pattern language, correct local time; NodePage shows °W.
- Daily report: local date, local peak band, span in hours.
- Season/Year hidden for Villa Magora, present for Casa Colibri.

## Not Code's job (Noah, manual prod)
- `UPDATE detections SET insight = NULL WHERE node_id = '7fe2f0d2-932a-404a-9c83-cbdd6a837ee9' AND insight IS NOT NULL;`
- Delete Villa Magora's `node_reports` rows (and consider its `pulse_narratives`).

## Docs
Update `Report-Agent-Spec.md` + `Pulse-Agent-Spec.md` (windows: UTC day → node-local day) and record decisions 1–2 as platform rules.
