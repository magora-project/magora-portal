// Parses the process fields of a PR body (Lane, Spec, Plan, Deviations). Pure.
// Spec: .claude/rules/process.md § Lanes. Problems are returned, never thrown.

export const LANES = ['specced', 'direct', 'docs-only', 'dependency']
const FIELD = /^\s*(?:[-*]\s+)?(?:\*\*)?(Lane|Spec|Plan|Deviations):(?:\*\*)?\s*(.*)$/
const MAX_RANGE = 1000

// A deviation ID exactly as the conformance record lists it: `D<n>` from the run that found it, or, once a re-review
// inherited it, `<record stem>#D<n>` (possibly chained), a stem being `<slotfile>--<id12>--<n>` (records.mjs).
// <id12> is 12 hex digits, or `empty` for a PR whose only change is under .review/ (identity.mjs).
export const DEVIATION_ID = '(?:[a-z]+(?:-[a-z]+)*--(?:[0-9a-f]{12}|empty)--[1-9][0-9]*#)*D[0-9]+'
// One Deviations entry, "<id>: justification" -> [, id, justification].
export const DEVIATION_ENTRY = new RegExp(`^(${DEVIATION_ID}):\\s*(.*)$`)
const ENTRY_HELP = '"- <id>: justification" line per deviation, the ID copied from the conformance record (D<n> or <stem>#D<n>)'

const clean = (v) => v.replace(/\s+$/, '').trim()
const unquote = (v) => clean(v).replace(/^`+|`+$/g, '').trim()
const isNone = (v) => /^none$/i.test(unquote(v))

// 'T1-T3,T6' -> ['T1','T2','T3','T6']. Throws on anything malformed, never returns [].
export function expandTasks(text) {
  const tokens = String(text).split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0) throw new Error('no task IDs')
  const out = []
  // Past 2^53 a Number stops counting (i++ leaves it unchanged), so a range there would never end.
  const num = (s, tok) => {
    const n = Number(s)
    if (!Number.isSafeInteger(n)) throw new Error(`task number ${s} in "${tok}" is too large`)
    return n
  }
  for (const tok of tokens) {
    let m = /^T(\d+)$/.exec(tok)
    if (m) { out.push(`T${num(m[1], tok)}`); continue }
    m = /^T(\d+)-T(\d+)$/.exec(tok)
    if (!m) throw new Error(`malformed task token "${tok}"`)
    const a = num(m[1], tok), b = num(m[2], tok)
    if (a > b) throw new Error(`invalid range "${tok}": start is after end`)
    if (b - a + 1 > MAX_RANGE) throw new Error(`invalid range "${tok}": more than ${MAX_RANGE} tasks`)
    for (let i = a; i <= b; i++) out.push(`T${i}`)
  }
  return [...new Set(out)]
}

export function parseBody(body, { author } = {}) {
  const problems = []
  const lines = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const fields = {}
  let devLines = null // bullet lines following Deviations:
  let collecting = false
  for (const line of lines) {
    const m = FIELD.exec(line)
    if (m) {
      collecting = false
      const [, name, value] = m
      if (name in fields) { problems.push(`${name}: appears more than once`); continue }
      fields[name] = clean(value)
      if (name === 'Deviations') { devLines = []; collecting = true }
      continue
    }
    if (!collecting) continue
    if (clean(line) === '' || /^\s*#/.test(line)) { collecting = false; continue }
    if (/^\s*[-*]\s+/.test(line)) devLines.push(line.replace(/^\s*[-*]\s+/, ''))
    else collecting = false
  }

  let lane = null
  if ('Lane' in fields) {
    const v = unquote(fields.Lane)
    if (LANES.includes(v)) lane = v
    else problems.push(`Lane: "${v}" is not one of ${LANES.join(', ')}`)
  } else if (author === 'dependabot[bot]') {
    lane = 'dependency'
  } else {
    problems.push(`Lane: missing (one of ${LANES.join(', ')})`)
  }

  let spec = null
  if ('Spec' in fields && fields.Spec !== '' && !isNone(fields.Spec)) spec = unquote(fields.Spec)

  let plan = null
  if ('Plan' in fields && fields.Plan !== '' && !isNone(fields.Plan)) {
    const [path, ...rest] = fields.Plan.split(/\s+/)
    let tasks = []
    if (rest.length > 0) {
      try { tasks = expandTasks(rest.join(' ')) } catch (e) { problems.push(`Plan: ${e.message}`) }
    }
    plan = { path: unquote(path), tasks }
  }

  if (lane === 'specced') {
    if (!spec) problems.push('Spec: required for the specced lane (a path, not none)')
    if (!plan) problems.push('Plan: required for the specced lane (a path plus task IDs)')
    else if (plan.tasks.length === 0 && !problems.some((p) => p.startsWith('Plan:'))) problems.push('Plan: needs task IDs, e.g. T1-T3')
  }

  const deviations = []
  if (!('Deviations' in fields)) {
    if (lane !== 'dependency') problems.push(`Deviations: missing (write "none" or one ${ENTRY_HELP})`)
  } else {
    const inline = fields.Deviations
    const entries = [...(inline !== '' && !isNone(inline) ? [inline] : []), ...devLines]
    if (isNone(inline)) {
      if (devLines.length) problems.push('Deviations: "none" contradicts the entries below it')
    } else if (entries.length === 0) {
      problems.push(`Deviations: empty (write "none" or one ${ENTRY_HELP})`)
    }
    const seen = new Set()
    for (const e of entries) {
      const m = DEVIATION_ENTRY.exec(e.trim())
      if (!m) { problems.push(`Deviations: bullet "${e.trim()}" is not "<id>: justification", the ID being D<n> or <stem>#D<n> as the conformance record lists it`); continue }
      const [, id, rest] = m
      const justification = rest.trim()
      if (seen.has(id)) { problems.push(`Deviations: duplicate ID ${id}`); continue }
      seen.add(id)
      if (justification === '') problems.push(`Deviations: ${id} has no justification`)
      deviations.push({ id, justification })
    }
  }

  return { lane, spec, plan, deviations, problems }
}
