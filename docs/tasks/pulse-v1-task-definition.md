# Task Definition — Pulse Agent v1

Rationale-free build spec for Claude Code. Design rationale lives in `Pulse-Agent-Spec.md`; do not reproduce it here. Build against verified repo state (migrations through 20260710, `species` seeded, `listeners.id = auth.users(id)`).

## Scope

Pulse v1 = **run → store → notify-to-Slack**. It scores and stores canonical, voice-agnostic pulse payloads for a node over a time window. No node-feed posting. No voice/narrative rendering. Slack messages are operator side-effects, not node-voice publications.

---

## 1. Migration (new)

Create migration `pulses`:

- `pulse_kind` enum: `novel_detection`, `activity_spike`, `soundscape_shift`, `survey_gap_question`, `absence`.
  - `absence` is **provisioned but never emitted in v1** (gated by feature flag; see §5). Include it now so no enum migration is needed later.
- `pulses` table:
  - `id uuid pk default gen_random_uuid()`
  - `node_id` → `nodes`
  - `kind pulse_kind`
  - `window_start timestamptz`, `window_end timestamptz`, `cadence text`
  - `score numeric`
  - `components jsonb` (per-component sub-scores)
  - `weights_version text`
  - `subject jsonb`, `survey_gap jsonb null`, `evidence jsonb`
  - `posted_to_feed boolean not null default false` (v2 reserved; always false in v1)
  - `generated_at timestamptz default now()`
  - unique key on `(node_id, window_start, window_end, cadence, kind)` for batch idempotency.
- Weights config surface: a `pulse_weights` table (or equivalent versioned store) keyed by `weights_version` + `kind`; **not** hardcoded constants. Seed with `v1` defaults (§4).
- RLS: owner/service-scoped consistent with existing agent tables. No person data enters `pulses`.

## 2. Canonical payload type

```ts
type PulseCadence = string; // window/weight/routing profile name; v1 uses "on_demand" | "daily"

type PulseKind =
  | "novel_detection"
  | "activity_spike"
  | "soundscape_shift"
  | "survey_gap_question"
  | "absence"; // gated OFF in v1

interface PulsePayload {
  pulse_id: string;
  node_id: string;
  kind: PulseKind;
  window: { start: string; end: string; cadence: PulseCadence };
  generated_at: string;

  score: number;                       // aggregate notability
  components: Record<string, number>;  // per-component sub-scores (retro-tuning)
  weights_version: string;

  subject: {
    species?: string[];                // taxa involved
    metric?: string;                   // e.g. "aci", "detection_rate"
  };

  // present only when kind === "survey_gap_question"
  survey_gap?: {
    question_focus: string;            // what Magora wants to know
    relationship_rationale: string;    // the systems-thinking link (X→Z, Y→Z)
    answer_target: string;             // where the answer lands (table.field)
  };

  evidence: Record<string, unknown>;   // kind-specific supporting counts/rows
  posted_to_feed: boolean;             // always false in v1
}
```

## 3. Candidate generation (query specs against verified tables)

`generateCandidates(node_id, window) → Candidate[]`. Each spec below defines the source, grouping, and emitted subject/evidence. Implement as parameterized queries; thresholds are config, not literals.

- **novel_detection** — source `detections` (+ `species` for rarity/guild). Emit a candidate for any species detected in `window` with **no prior detection** at `node_id` before `window.start`. subject.species = [species]; evidence = first-seen timestamp, confidence, guild/conservation from `species`.

- **activity_spike** — source `detections`. Compare detection rate in `window` against the node's own trailing baseline (config: baseline length). Emit when rate exceeds baseline by a config multiple. subject.metric = "detection_rate"; evidence = window rate, baseline rate, ratio.

- **soundscape_shift** — source `aci_logs`. Compare mean ACI in `window` vs trailing baseline. Emit on significant delta in **either** direction. **In v1 a downward shift is framed as a question, not a decline claim** (see §5). subject.metric = "aci"; evidence = window mean, baseline mean, delta, direction.

- **survey_gap_question** — sources `detections` + `species` + `public_mobile_detections` + iNat-ambient. Emit when the node has a detection pattern implying a relationship whose other end is **unobserved in the node's data**. v1 grounded tier only:
  - habitat-gap: structured habitat fields (`habitat_type`, `canopy_cover`, `water_present`, `disturbance_level`) that are null/absent for the place → question focus = the missing field.
  - iNat ground-truth: an iNat-ambient nearby taxon not confirmed at the node → question focus = confirm presence.
  - Populate `survey_gap.relationship_rationale` from available structured reasoning (guild/diet). `answer_target` names the existing write target (habitat field or journal free-text). **Do not** fabricate relationships from model priors; if no structured link exists, do not emit.
  - Interfaces `relationshipSource` and `phenologySource` are **stubbed** in v1 (GloBI / USA-NPN cached layer lands in a separate task). Code against the interface; the richer flower/phenology tier activates when the reference layer ships.

- **absence** — **do not implement candidate generation in v1.** Enum + schema slot exist; generator is gated off (§5).

## 4. Scoring (with v1 default weights)

Pure function, mode-agnostic:

```
scorePulses(candidates: Candidate[], weights: WeightConfig) → PulsePayload[]  // ranked desc by score
```

- Each candidate carries named component scores in [0,1]. Aggregate `score = Σ weight_i · component_i` using the `weights_version` config. Record every component in `components` and stamp `weights_version`.
- **v1 default weights (hand-set; tuning-todo — refine against real birdnode11 + Magic Lantern payloads later):**

```
weights_version = "v1"

novel_detection:      { rarity: 0.5, recency: 0.3, confidence: 0.2 }
activity_spike:       { magnitude: 0.6, baseline_stability: 0.4 }
soundscape_shift:     { delta_magnitude: 0.7, direction: 0.3 }
survey_gap_question:  { relationship_strength: 0.5, phenology_alignment: 0.3, data_absence: 0.2 }
```

- Weights are read from the config surface, never inlined. Changing weights = new `weights_version` row, no code change, no re-run required to re-rank stored payloads.

## 5. Feature gate

- Single flag `PULSE_ABSENCE_ENABLED` (default **false**). While false: `absence` candidates are never generated or scored, and downward `soundscape_shift` is emitted only as a `survey_gap_question`-style question, never as a decline assertion.
- Enabling `absence` later requires (checked in code before emit): an external baseline present, baseline ≥ threshold, coverage-continuity over the window, and node-offline detection available. v1 does not implement these checks beyond the flag.

## 6. Entry points (two modes, one core)

```
// interactive; check-before-generate (read cache first, mirror insight-cache pattern)
pulseOnDemand(node_id: string, window?: Window): Promise<PulsePayload | null>
  → returns top-ranked stored pulse if fresh, else generate → score → store → return top.

// batch; cron-driven
pulseBatch(node_id: string, window: Window, cadence: PulseCadence): Promise<PulsePayload[]>
  → generate → score → store (idempotent on unique key) → notify-to-Slack (operator side-effect).
```

Both call the shared pure core (`generateCandidates` → `scorePulses`). Window is always a parameter. Payload shape is identical across modes.

## 7. Out of scope for v1

Node-feed posting (`posted_to_feed` stays false). Voice/narrative rendering. Cross-node emergence. eBird / year-over-year baselines. GloBI/USA-NPN live integration (interface-stubbed). `absence` emission.

## 8. Dependencies to flag back to Architect

- Node-offline detection (separate task) is the hard prerequisite for ever enabling `absence`.
- Ecological Intelligence reference layer (GloBI / USA-NPN / traits, cached in Supabase) unblocks the rich survey-gap tier; `relationshipSource` / `phenologySource` interfaces are the seam.
