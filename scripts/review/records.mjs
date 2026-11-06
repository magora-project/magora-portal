// Review records (schema 1) and the on-disk store at .review/records/.
// Consumed by the review runner and the review-evidence CI check.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { EVIDENCE_DIR } from './identity.mjs'

export const TYPES = ['spec', 'plan', 'conformance', 'prepush', 'substitute']
export const SLOTS = ['spec', 'plan', 'conformance', 'correctness', 'completeness', 'substitute:coderabbit', 'substitute:codex', 'substitute:gemini']
export const OUTCOMES = ['completed', 'failed', 'refused', 'truncated', 'timeout']
const VENDORS = ['openai', 'anthropic', 'google']
const KINDS = ['fixed', 'pre-existing', 'reclassified-nit', 'justified-deviation']
const GATE_PREFIXES = ['thread:', 'cr:', 'gemini:']

const recordsDir = (cwd) => join(cwd, EVIDENCE_DIR, 'records')
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== ''
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
const isGateId = (id) => typeof id === 'string' && GATE_PREFIXES.some((p) => id.startsWith(p))

export const slotFile = (slot) => slot.replaceAll(':', '-')

export const validateRecord = (r) => {
  if (!isObj(r)) return ['record: must be a JSON object']
  const p = []
  const oneOf = (name, v, list) => { if (!list.includes(v)) p.push(`${name}: must be one of ${list.join('|')}`) }
  if (r.schema !== 1) p.push('schema: must be 1')
  oneOf('type', r.type, TYPES)
  oneOf('slot', r.slot, SLOTS)
  if (!isObj(r.input)) p.push('input: must be an object')
  else {
    oneOf('input.kind', r.input.kind, ['pr', 'blob'])
    if (!nonEmpty(r.input.identity)) p.push('input.identity: must be a non-empty string')
    for (const k of ['path', 'mergeBase', 'head']) if (r.input[k] !== undefined && typeof r.input[k] !== 'string') p.push(`input.${k}: must be a string when present`)
  }
  if (!isObj(r.reviewer)) p.push('reviewer: must be an object')
  else {
    oneOf('reviewer.vendor', r.reviewer.vendor, VENDORS)
    if (!nonEmpty(r.reviewer.model)) p.push('reviewer.model: must be a non-empty string')
  }
  oneOf('authorVendor', r.authorVendor, [...VENDORS, 'none'])
  oneOf('outcome', r.outcome, OUTCOMES)
  if (r.verdict !== null) oneOf('verdict', r.verdict, ['pass', 'fail'])
  if (!Array.isArray(r.findings)) p.push('findings: must be an array')
  else r.findings.forEach((f, i) => {
    const n = `findings[${i}]`
    if (!isObj(f)) { p.push(`${n}: must be an object`); return }
    if (!nonEmpty(f.id)) p.push(`${n}.id: must be a non-empty string`)
    // Any string severity is representable: an unparseable one blocks (isBlockingByDefault).
    if (typeof f.severity !== 'string') p.push(`${n}.severity: must be a string`)
    if (!nonEmpty(f.summary)) p.push(`${n}.summary: must be a non-empty string`)
    if (f.file !== undefined && typeof f.file !== 'string') p.push(`${n}.file: must be a string when present`)
    if (f.line !== undefined && !Number.isInteger(f.line)) p.push(`${n}.line: must be an integer when present`)
    if (f.disposition !== undefined) {
      const d = f.disposition
      if (!isObj(d)) p.push(`${n}.disposition: must be an object when present`)
      else {
        oneOf(`${n}.disposition.kind`, d.kind, KINDS)
        for (const k of ['by', 'reason', 'issue']) if (d[k] !== undefined && typeof d[k] !== 'string') p.push(`${n}.disposition.${k}: must be a string when present`)
      }
    }
  })
  if (r.supersedes !== null && typeof r.supersedes !== 'string') p.push('supersedes: must be a string or null')
  if (typeof r.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(r.createdAt) || Number.isNaN(Date.parse(r.createdAt))) p.push('createdAt: must be an ISO 8601 timestamp')
  if (r.conformance !== undefined) {
    const c = r.conformance
    const strs = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string')
    if (!isObj(c)) p.push('conformance: must be an object when present')
    else {
      if (!strs(c.tasks)) p.push('conformance.tasks: must be an array of strings')
      if (!strs(c.deviations)) p.push('conformance.deviations: must be an array of strings')
      if (!Array.isArray(c.commands) || !c.commands.every((x) => isObj(x) && typeof x.cmd === 'string' && Number.isInteger(x.exit))) p.push('conformance.commands: must be an array of { cmd: string, exit: integer }')
    }
  }
  return p
}

// <slotfile>--<id12>--<n>.json, n the first free integer from 1. Exclusive create, so a racing writer cannot be clobbered.
export const writeRecord = ({ cwd, record }) => {
  const problems = validateRecord(record)
  if (problems.length) throw new Error(`refusing to write an invalid review record: ${problems.join('; ')}`)
  const dir = recordsDir(cwd)
  mkdirSync(dir, { recursive: true })
  const prefix = `${slotFile(record.slot)}--${record.input.identity.slice(0, 12)}--`
  const body = JSON.stringify(record, null, 2) + '\n'
  for (let n = 1; n < 100000; n++) {
    const path = join(dir, `${prefix}${n}.json`)
    try {
      writeFileSync(path, body, { flag: 'wx' })
      return path
    } catch (e) {
      if (e && e.code !== 'EEXIST') throw e
    }
  }
  throw new Error(`no free record number for ${prefix}`)
}

export const readRecords = ({ cwd }) => {
  const dir = recordsDir(cwd)
  let names
  try { names = readdirSync(dir, { withFileTypes: true }) } catch (e) { if (e && e.code === 'ENOENT') return []; throw e }
  return names.filter((d) => d.isFile() && d.name.endsWith('.json')).map((d) => d.name).sort().map((name) => {
    const stem = basename(name, '.json')
    let obj
    try { obj = JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch (e) { return { stem, invalid: [`not parseable JSON: ${e.message}`] } }
    const problems = validateRecord(obj)
    return problems.length ? { ...(isObj(obj) ? obj : {}), stem, invalid: problems } : { ...obj, stem }
  })
}

export const chainHeads = (records) => {
  const superseded = new Set(records.map((r) => r.supersedes).filter((s) => typeof s === 'string'))
  return records.filter((r) => !superseded.has(r.stem))
}

// P0-P2 block; a severity that is not exactly P3 is unparseable and blocks too.
export const isBlockingByDefault = (finding) => finding.severity !== 'P3'

// Whether the disposition is acceptable on its face. That `fixed.by` names a real re-review record
// needs the record list and is checked by the review-evidence CI check, not here.
export const dispositionOk = (finding, { deviations = [], recordType } = {}) => {
  if (!isBlockingByDefault(finding)) return true
  const d = finding.disposition
  if (!isObj(d)) return false
  switch (d.kind) {
    case 'fixed': return nonEmpty(d.by)
    case 'pre-existing': return nonEmpty(d.reason) && nonEmpty(d.issue)
    case 'reclassified-nit': return nonEmpty(d.reason)
    case 'justified-deviation':
      return recordType === 'conformance' && deviations.some((x) => x && x.id === finding.id && nonEmpty(x.justification))
    default: return false
  }
}


// Findings to carry into a re-review. Ordinary IDs are prefixed with the old record's stem; a gate ID keeps
// its ID, and one already `fixed` is copied with its disposition so it stays verifiable at the chain head.
export const inherit = (old) => {
  const out = []
  for (const f of old.findings || []) {
    const gate = isGateId(f.id)
    if (gate && isObj(f.disposition) && f.disposition.kind === 'fixed' && dispositionOk(f)) { out.push({ ...f }); continue }
    if (!isBlockingByDefault(f) || dispositionOk(f)) continue
    const { disposition: _d, ...rest } = f // eslint-disable-line no-unused-vars
    out.push({ ...rest, id: gate ? f.id : `${old.stem}#${f.id}` })
  }
  return out
}
