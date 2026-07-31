// Provenance vocabulary — the EIA principle ("the LLM is the reasoning/rendering layer, never
// the knowledge source") expressed as a closed, cross-surface taxonomy. This lives in lib/ and
// not next to the chip component because it is meant to be shared: node pages, detection cards,
// journals, reports, and the network map should all label claims from the SAME five classes, so
// a reader learns the vocabulary once.
//
// Two classes are defined but NOT backable yet. They are kept here so the taxonomy is complete
// and reviewable, and so lighting them up later is a one-line change to BACKABLE plus the data
// behind them — not a redesign:
//
//   * detected_correlation  — needs the statistics to exist, and for weather-shaped claims the
//     unbuilt weather reference slice plus a correlation primitive. Rendering it today would let
//     a causal claim onto the page with nothing behind it.
//   * community_observation — needs the consent model (the mobile_detections ->
//     public_mobile_detections publish-consent pattern) and the iNaturalist Stage 3 write loop.
//
// CLASSIFICATION AXIS (applies to every surface, settled 2026-07-31). `community_observation` is
// defined by CARRYING A MAGORA CONSENT OBLIGATION — i.e. contributed through Magora — and NOT by
// who originally made the observation. So external community-science datasets (iNaturalist
// research-grade, eBird, GBIF) are ESTABLISHED KNOWLEDGE even though people gathered them: Magora
// holds no consent record for those contributors and owes them nothing it can honour.
//
// Classifying them as community observation would manufacture "community observations" with no
// consent record behind them and corrupt the meaning of the class for the contributions that
// genuinely do carry one. When in doubt, ask which system owes the contributor a consent
// decision — not who was standing outside with binoculars.

/** `label` is reader-facing; `title` explains what actually stands behind such a claim. */
export const PROVENANCE = {
  direct_observation: {
    label: 'Direct observation',
    icon: '◉',
    title: 'Recorded by this node — structured detection data, not interpretation.',
  },
  established_knowledge: {
    label: 'Established ecological knowledge',
    icon: '◆',
    title: 'From a reference dataset (species traits, range, verified community-science records) — not inferred here.',
  },
  ai_interpretation: {
    label: 'AI interpretation',
    icon: '◇',
    title: 'Written by this place’s voice from the recorded data. It asks; it never asserts a cause.',
  },
  // ── Defined, not backable in v1 (see the header note). ──
  detected_correlation: {
    label: 'Detected correlation',
    icon: '◈',
    title: 'A statistical relationship measured across variables. Not available yet.',
  },
  community_observation: {
    label: 'Community observation',
    icon: '○',
    title: 'Contributed by a person who was here. Not available yet.',
  },
}

/**
 * The classes a claim may actually carry today. A class outside this set has no data behind it,
 * so ProvenanceChip renders nothing rather than implying a backing that does not exist.
 */
export const BACKABLE = new Set(['direct_observation', 'established_knowledge', 'ai_interpretation'])
