// Severity defaults (spec §5.6). Bot severity labels set the default for a finding:
//   Blocking: Codex P0-P2, CodeRabbit Critical and Major, and anything unparseable.
//   Nit:      Codex P3, CodeRabbit Minor, Trivial and Nitpick.
// (Every Gemini finding blocks by default; it emits only P0/P1 and is read from its verdict marker,
// not from here.) Pure: no network.

export const CODEX_LOGIN = 'chatgpt-codex-connector[bot]'
export const CODERABBIT_LOGIN = 'coderabbitai[bot]'

const CODEX_BLOCKING = new Set(['P0', 'P1', 'P2'])
const CR_BLOCKING = new Set(['Critical', 'Major'])

// Codex opens its inline comment with a badge: **<sub><sub>![P2 Badge](...)</sub></sub>  Title**.
// Anchored to the start of the body, so a badge quoted later in the text is not read.
const CODEX_BADGE = /^\s*\*\*(?:<sub>)*!\[(P[0-3]) Badge\]/

// CodeRabbit's severity token: an icon (an <img> in a <picture>, or an emoji), then the label.
const CR_TOKEN = '(?:<picture>[\\s\\S]*?</picture>|[🔴🟠🟡🔵]\\uFE0F?)?\\s*(Critical|Major|Minor|Trivial|Nitpick)'
// An inline comment opens (after its HTML-comment markers) with **<icon> Label** · **Category** · ...
const CR_HEADER = new RegExp(`^(?:\\s*<!--[\\s\\S]*?-->)*\\s*\\*\\*${CR_TOKEN}\\*\\*`, 'u')
// Inside a review-body block the label sits in a bold or <strong> element.
const CR_BOLD = new RegExp(`(?:\\*\\*|<strong>)${CR_TOKEN}(?:\\*\\*|</strong>)`, 'u')

// The CodeRabbit label of a review-body block (an outside-diff finding), or null.
export function crLabelIn(text) {
  return CR_BOLD.exec(text ?? '')?.[1] ?? null
}

export function severityOf({ login, body } = {}) {
  const text = body ?? ''
  if (login === CODEX_LOGIN) {
    const label = CODEX_BADGE.exec(text)?.[1]
    if (label) return { label, blocking: CODEX_BLOCKING.has(label) }
  } else if (login === CODERABBIT_LOGIN) {
    const label = CR_HEADER.exec(text)?.[1]
    if (label) return { label, blocking: CR_BLOCKING.has(label) }
  }
  return { label: null, blocking: true }
}
