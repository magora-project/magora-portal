// review-evidence (spec docs/superpowers/specs/2026-10-29-shared-dev-process-design.md §5.3, §5.4;
// .claude/rules/process.md § Review slots and dispatch, § Evidence). Judges the committed review records
// under .review/records/ against the PR's current input identity. The job's own exit status is the
// check; nothing posts a status. PR state (body, labels, head, base, creation time) is read LIVE from the
// API when the job runs, never from the event payload.
//
// The §5.3 acceptance predicate, applied to the chain head of each required slot and input:
//   "It passes a record only when all four hold:
//    1. The outcome is `completed`, with a recognized, non-empty result. Any other outcome fails,
//       whatever the finding count.
//    2. The input identity matches the current one. For conformance records, the task IDs must also
//       match the Plan field, and the unfixed deviation IDs must exactly match the Deviations field.
//    3. The slot ID is the required one, and the vendor meets the independence rule.
//    4. Every recorded finding has an acceptable disposition, whatever the verdict."
// Reading of each part, as implemented:
//   1. outcome === 'completed' and verdict is 'pass' or 'fail' (a null verdict is not a recognized result).
//   2. input.identity equals the current PR identity (or, for spec/plan, the doc's blob at head, same path).
//      Conformance: conformance.tasks equals the Plan field's expanded tasks as a set; conformance.deviations
//      equals the Deviations field's IDs as a set.
//   3. Only records whose slot is the required one are candidates. reviewer.vendor differs from the
//      author's vendor (every record on one input must agree on authorVendor); for `completeness` it also
//      differs from the vendor of a passing `correctness` head (spec: "whichever of the three vendors is
//      neither the author nor the `correctness` reviewer").
//   4. Every finding passes dispositionOk (P3 needs none; justified-deviation only on a conformance record
//      and only for an ID in the Deviations field), and a `fixed` finding's `by` names a record in the same
//      supersedes chain. The verdict is not consulted: a `fail` whose findings are all disposed passes.
// A slot passes when ANY of its chain heads passes (independent chains on one input are allowed), with one
// exception (§5.3 "inherits every finding the old record left undisposed"; §2: no check may pass while a review
// left a blocking finding open): a slot FAILS while any of its chain heads that THIS PR ADDED, on any identity,
// completed with a finding that fails part 4. That head must be superseded (its findings are then inherited)
// or its findings disposed. Heads that never completed may still be bypassed by another chain (reviewer
// fallback), and records already on the base belong to other PRs: they count as evidence, not against it.
//
// Grandfathering (§5.3): a PR created before the `review-evidence` time in .github/review-activation.json,
// read from the BASE branch through the API (never from the PR's tree), is exempt. A missing file or key
// exempts nothing; any other read error, or a value that does not parse, fails ("could not judge").
//
// Run (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_NUMBER=n node scripts/ci/review-evidence.mjs
// Locally: npm run review -- check --local (localCheck below), after npm run review -- init-local ….
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVIDENCE_DIR, blobIdentity, git, inputIdentity, mergeBase } from '../review/identity.mjs'
import { addedRecordStems, chainHeads, dispositionOk, isBlockingByDefault, readRecords, repoPath, undisposedBlocking } from '../review/records.mjs'
import { LANES, parseBody } from '../review/pr-body.mjs'
import { DEPTH_LABELS, inferLabel, parseControlFiles } from './label-gate.mjs'

export const ACTIVATION_PATH = '.github/review-activation.json'
export const ACTIVATION_KEY = 'review-evidence'
export const DOC_DIRS = { spec: 'docs/superpowers/specs/', plan: 'docs/superpowers/plans/' }
export const INIT_LOCAL = 'npm run review -- init-local --lane <lane> --depth <label> [--spec <path>] [--plan "<path> <tasks>"]'
const PREPUSH = { mechanical: [], standard: ['correctness'], 'subtle-correctness': ['correctness', 'completeness'] }
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/

const short = (s) => (typeof s === 'string' ? s.slice(0, 12) : 'missing')
const isIso = (s) => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s))
const setDiff = (a, b) => { const sb = new Set(b); return [...new Set(a)].filter((x) => !sb.has(x)) }
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)

// ---------- which records a PR needs (§5.3 table) ----------

// changedDocs: [{slot: 'spec'|'plan', path, identity, error?}]: for `specced` the linked spec and plan at
// their current blobs; for `docs-only` each spec or plan the PR adds or changes. Other lanes ignore it.
export function requiredSlots({ lane, depth, changedDocs = [] }) {
  const pr = (slot) => ({ slot, input: { kind: 'pr' } })
  const docs = () => changedDocs.map((d) => ({ slot: d.slot, input: { kind: 'blob', path: d.path, identity: d.identity ?? null, ...(d.error ? { error: d.error } : {}) } }))
  const byDepth = () => {
    if (!(depth in PREPUSH)) throw new Error(`unknown depth "${depth}" (one of ${DEPTH_LABELS.join(', ')})`)
    return PREPUSH[depth].map(pr)
  }
  switch (lane) {
    case 'specced': return [...docs(), pr('conformance'), ...byDepth()]
    case 'docs-only': return docs()
    case 'direct': return byDepth()
    case 'dependency': return [pr('correctness')]
    default: throw new Error(`unknown lane "${lane}" (one of ${LANES.join(', ')})`)
  }
}

// ---------- the depth judged (David's ruling, 2026-11-06) ----------

// The PR's depth label is the floor, not the answer: the depth judged is the higher of the label and what
// label-gate's inferLabel makes of the changed paths, so a person's `standard` on a control-file or migration
// PR still needs a completeness record. inferLabel never infers `mechanical` and answers `standard` for any
// ordinary path; that `standard` is no floor (it would make `mechanical` unreachable, against AGENTS.md
// § Depth labels), so only an inferred `subtle-correctness` raises the label.
export function requiredDepth({ label, paths, controlFiles }) {
  return inferLabel(paths, controlFiles) === 'subtle-correctness' ? 'subtle-correctness' : label
}

// The paths that make inferLabel answer subtle-correctness, for the log line.
const subtlePaths = (paths, controlFiles) => paths.filter((p) => inferLabel([p], controlFiles) === 'subtle-correctness')

// ---------- the predicate ----------

const inputKey = (input) => (input.kind === 'blob' ? `blob ${input.path} ${input.identity}` : `pr ${input.identity}`)

// The author vendor of the records on one input: all must agree, or a problem names them.
export function authorVendorFromRecords(recs) {
  const vendors = new Set(recs.map((r) => r.authorVendor))
  if (vendors.size <= 1) return { vendor: [...vendors][0] }
  return { problem: `records on this input disagree on authorVendor: ${recs.map((r) => `${r.stem}=${r.authorVendor}`).join(', ')}` }
}

// addedStems: the stems of the records this PR adds (see the header). Omitted, every record counts as added.
export function evaluate({ records, required, identity, body, addedStems, authorVendorOf = authorVendorFromRecords }) {
  const lines = []
  const added = addedStems === undefined ? null : new Set(addedStems)
  let ok = true
  const fail = (line) => { ok = false; lines.push(line) }
  for (const p of body?.problems ?? []) fail(`FAIL PR body: ${p}`)
  for (const r of records) if (r.invalid) fail(`FAIL ${EVIDENCE_DIR}/records/${r.stem}.json: invalid record: ${r.invalid.join('; ')}`)
  if (identity === 'empty') fail(`FAIL PR has no changes outside ${EVIDENCE_DIR}/ (input identity "empty"): nothing to review`)
  if (body?.lane === 'docs-only' && required.length === 0) fail('FAIL docs-only lane, but the PR adds or changes no spec or plan')

  const byStem = new Map(records.map((r) => [r.stem, r]))
  // Heads are computed over every record, invalid ones included, so an invalid successor still hides its
  // predecessor (and fails the check by name above) rather than resurrecting it.
  const heads = chainHeads(records).filter((r) => !r.invalid)
  const valid = records.filter((r) => !r.invalid)
  const chainOf = (head) => {
    const stems = new Set()
    for (let r = head; r && !stems.has(r.stem); r = byStem.get(r.supersedes)) stems.add(r.stem)
    return stems
  }
  const devIds = (body?.deviations ?? []).map((d) => d.id)
  const planTasks = body?.plan?.tasks ?? []
  const passingCorrectness = new Map() // input key -> vendors of passing correctness heads

  const judge = (rec, want) => {
    const reasons = []
    // 1
    if (rec.outcome !== 'completed') reasons.push(`outcome ${rec.outcome}`)
    else if (rec.verdict !== 'pass' && rec.verdict !== 'fail') reasons.push('completed without a recognized result (no verdict)')
    // 2
    if (rec.input.identity !== want.identity) reasons.push(`identity ${short(rec.input.identity)} is not the current ${short(want.identity)}`)
    if (rec.slot === 'conformance') {
      const c = rec.conformance
      if (!isObj(c)) reasons.push('conformance record has no conformance block')
      else {
        const missing = setDiff(planTasks, c.tasks), extra = setDiff(c.tasks, planTasks)
        if (missing.length || extra.length) reasons.push(`tasks differ from the Plan field (${[missing.length ? `not covered: ${missing.join(',')}` : '', extra.length ? `not in the Plan field: ${extra.join(',')}` : ''].filter(Boolean).join('; ')})`)
        const unlisted = setDiff(c.deviations, devIds), unknown = setDiff(devIds, c.deviations)
        if (unlisted.length || unknown.length) reasons.push(`unfixed deviations differ from the Deviations field (${[unlisted.length ? `not in the Deviations field: ${unlisted.join(',')}` : '', unknown.length ? `not in the record: ${unknown.join(',')}` : ''].filter(Boolean).join('; ')})`)
      }
    }
    // 3
    const author = authorVendorOf(valid.filter((r) => r.slot !== undefined && inputKey(r.input) === inputKey(rec.input)))
    if (author.problem) reasons.push(author.problem)
    else if (rec.reviewer.vendor === author.vendor) reasons.push(`reviewer vendor ${rec.reviewer.vendor} is the author's vendor`)
    if (rec.slot === 'completeness') {
      const cv = passingCorrectness.get(inputKey(want)) ?? []
      if (cv.length === 0) reasons.push('vendor independence: no passing correctness record to compare with')
      else if (cv.every((v) => v === rec.reviewer.vendor)) reasons.push(`reviewer vendor ${rec.reviewer.vendor} already reviewed correctness`)
    }
    // 4
    const chain = chainOf(rec)
    for (const f of rec.findings) {
      if (!dispositionOk(f, { deviations: body?.deviations ?? [], recordType: rec.type })) {
        reasons.push(`finding ${f.id} (${f.severity}) has no acceptable disposition${f.disposition ? ` (${f.disposition.kind})` : ''}`)
      } else if (isBlockingByDefault(f) && f.disposition?.kind === 'fixed' && !chain.has(f.disposition.by)) {
        reasons.push(`finding ${f.id} is fixed by ${f.disposition.by}, which is not a record in this chain`)
      }
    }
    return reasons
  }

  if (required.length === 0 && ok) lines.push(`ok no records required (lane ${body?.lane ?? '?'})`)
  for (const { slot, input } of required) {
    const want = input.kind === 'blob' ? input : { kind: 'pr', identity }
    const label = input.kind === 'blob' ? `${slot} ${input.path}@${short(input.identity)}` : `${slot} pr ${short(identity)}`
    if (input.error) { fail(`FAIL ${label}: ${input.error}`); continue }
    const candidates = heads.filter((r) => r.slot === slot && r.input.kind === input.kind && (input.kind !== 'blob' || r.input.path === input.path))
    if (candidates.length === 0) {
      // Conformance records come from `review.mjs conformance` (plan Task 18, PR C); `run --slot conformance` refuses.
      const how = slot === 'conformance'
        ? 'conformance records come from npm run review -- conformance, which arrives with plan Task 18'
        : `write one with npm run review -- run --slot ${slot}${input.kind === 'blob' ? ` --path ${input.path}` : ''}`
      fail(`FAIL ${label}: no record (${how})`)
      continue
    }
    const judged = candidates.map((r) => ({ r, reasons: judge(r, want) }))
    const passing = judged.filter((j) => j.reasons.length === 0)
    const judgedText = () => judged.map((j) => `${j.r.stem}: ${j.reasons.join('; ')}`).join(' | ')
    // Any head this PR added that still carries an open blocking finding fails the slot, whatever its outcome:
    // a failed re-review carries its inherited findings forward undisposed, so it must not let a fresh passing
    // chain bypass them. A head with no open finding (a fresh run that never completed) does not block.
    const open = candidates.filter((r) => (added === null || added.has(r.stem)))
      .map((r) => ({ r, ids: undisposedBlocking(r, { deviations: body?.deviations ?? [] }).map((f) => f.id) })).filter((x) => x.ids.length)
    if (open.length) {
      fail(`FAIL ${label}: ${open.map(({ r, ids }) => `${r.stem} (a review this PR added) left ${ids.join(', ')} open: re-review with --supersedes ${r.stem}, or dispose ${ids.length === 1 ? 'it' : 'them'}`).join(' | ')}${passing.length ? '' : ` | ${judgedText()}`}`)
    } else if (passing.length) {
      if (slot === 'correctness') passingCorrectness.set(inputKey(want), passing.map((j) => j.r.reviewer.vendor))
      lines.push(`ok ${label} (${passing.map((j) => j.r.stem).join(', ')})`)
    } else {
      fail(`FAIL ${label}: ${judgedText()}`)
    }
  }
  return { ok, lines }
}

// ---------- grandfathering ----------

export function isGrandfathered({ prCreatedAt, requiredSince }) {
  if (!isIso(requiredSince) || !isIso(prCreatedAt)) return false
  return Date.parse(prCreatedAt) < Date.parse(requiredSince)
}

// ---------- git: identity, changed docs ----------

const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`)
  return r.stdout.toString()
}

export const defaultGit = {
  head: async ({ cwd }) => must(await git(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd }), 'git rev-parse HEAD').trim(),
  inputIdentity, blobIdentity, mergeBase, addedRecordStems,
  // Every path the PR changes (both sides of a rename, as label-gate counts previous_filename), .review/ excluded.
  changedPaths: async ({ cwd, base, head }) =>
    must(await git(['diff', '--name-only', '-z', '--no-renames', base, head, '--', '.', `:(exclude)${EVIDENCE_DIR}`], { cwd }), 'git diff --name-only')
      .split('\0').filter(Boolean),
  // AGENTS.md at a commit, or null when that commit has none.
  agentsAt: async ({ cwd, rev }) => {
    const r = await git(['cat-file', 'blob', `${rev}:AGENTS.md`], { cwd })
    return r.code === 0 ? r.stdout.toString() : null
  },
  // Spec and plan paths the PR adds or changes. Deleted docs need no review; renames count as added.
  changedDocPaths: async ({ cwd, base, head }) =>
    must(await git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=d', base, head, '--', DOC_DIRS.spec, DOC_DIRS.plan], { cwd }), 'git diff --name-only')
      .split('\0').filter(Boolean),
}

async function docsFor({ cwd, lane, body, base, head, gitImpl }) {
  const one = async (slot, path) => {
    try { return { slot, path, identity: await gitImpl.blobIdentity({ cwd, rev: head, path }) } } catch {
      return { slot, path, identity: null, error: `${path} is not in the PR head` }
    }
  }
  if (lane === 'specced') {
    // Normalised as the runner normalises --path, so `./docs/x.md` or `docs\x.md` finds the record for `docs/x.md`.
    return [...(body.spec ? [await one('spec', repoPath(body.spec))] : []), ...(body.plan?.path ? [await one('plan', repoPath(body.plan.path))] : [])]
  }
  if (lane === 'docs-only') {
    const mb = await gitImpl.mergeBase({ cwd, base, head })
    const paths = await gitImpl.changedDocPaths({ cwd, base: mb, head })
    return Promise.all(paths.map((p) => one(p.startsWith(DOC_DIRS.spec) ? 'spec' : 'plan', p)))
  }
  return []
}

// The control-file list from AGENTS.md at the head. A head that narrows the list it is judged by (issue #61)
// changes AGENTS.md, which inferLabel always counts as subtle, so the head's copy cannot lower the depth; a
// head that leaves AGENTS.md alone has the merge base's copy. No AGENTS.md, or no list in it: throws.
async function controlFilesFor({ cwd, head, gitImpl }) {
  const text = await gitImpl.agentsAt({ cwd, rev: head })
  if (text === null) throw new Error('the head has no AGENTS.md, so the depth floor (its control-file list) cannot be computed')
  return parseControlFiles(text)
}

// untracked: also count records not committed yet as added (localCheck).
async function judgeCheckout({ cwd, lane, depth: label, body, base, head, gitImpl, untracked = false }) {
  const identity = await gitImpl.inputIdentity({ cwd, base, head })
  const changedDocs = lane ? await docsFor({ cwd, lane, body, base, head, gitImpl }) : []
  const records = readRecords({ cwd })
  const mb = await gitImpl.mergeBase({ cwd, base, head })
  const paths = await gitImpl.changedPaths({ cwd, base: mb, head })
  const controlFiles = await controlFilesFor({ cwd, head, gitImpl })
  const depth = requiredDepth({ label, paths, controlFiles })
  const required = lane ? requiredSlots({ lane, depth, changedDocs }) : []
  const addedStems = await (gitImpl.addedRecordStems ?? addedRecordStems)({ cwd, mergeBase: mb, head, untracked })
  const result = evaluate({ records, required, identity, body, addedStems })
  // docs-only "only adds or changes a spec or plan" (spec §5.2), and needs only their records: any other path
  // would skip the pre-push records its depth requires.
  if (lane === 'docs-only') {
    const other = paths.filter((p) => !p.startsWith(DOC_DIRS.spec) && !p.startsWith(DOC_DIRS.plan))
    if (other.length) {
      result.ok = false
      result.lines.unshift(`FAIL docs-only lane, but the PR changes ${other.slice(0, 5).join(', ')}${other.length > 5 ? ` and ${other.length - 5} more` : ''} outside ${DOC_DIRS.spec} and ${DOC_DIRS.plan}: use the specced or direct lane`)
    }
  }
  if (depth !== label && (lane === 'specced' || lane === 'direct')) {
    const why = subtlePaths(paths, controlFiles)
    result.lines.unshift(`depth: judged as ${depth}, not the ${label} label: ${why.slice(0, 5).join(', ')}${why.length > 5 ? ` and ${why.length - 5} more` : ''} (label-gate's inferLabel)`)
  }
  return result
}

// ---------- CI entry ----------

async function getJson(fetchImpl, token, url) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  return { status: res.status, ok: res.ok, body: res.ok || res.status === 404 ? await res.json() : null }
}

// requiredSince from the base branch's activation file: { since } (undefined when the file or key is
// missing), or { error }.
export async function readActivation({ fetchImpl, token, repo, ref }) {
  const r = await getJson(fetchImpl, token, `https://api.github.com/repos/${repo}/contents/${ACTIVATION_PATH}?ref=${encodeURIComponent(ref)}`)
  if (r.status === 404) return { since: undefined }
  if (!r.ok) return { error: `GitHub API ${r.status} reading ${ACTIVATION_PATH} at ${ref}` }
  if (!isObj(r.body) || r.body.encoding !== 'base64' || typeof r.body.content !== 'string') return { error: `${ACTIVATION_PATH} at ${ref}: no base64 content in the API reply` }
  let obj
  try { obj = JSON.parse(Buffer.from(r.body.content, 'base64').toString('utf8')) } catch (e) { return { error: `${ACTIVATION_PATH} at ${ref} is not JSON (${e.message})` } }
  if (!isObj(obj)) return { error: `${ACTIVATION_PATH} at ${ref} is not a JSON object` }
  const v = obj[ACTIVATION_KEY]
  if (v === undefined) return { since: undefined }
  if (!isIso(v)) return { error: `${ACTIVATION_PATH} at ${ref}: "${ACTIVATION_KEY}" is ${JSON.stringify(v)}, not an ISO 8601 time` }
  return { since: v }
}

export async function main({ env = process.env, fetchImpl = fetch, gitImpl = defaultGit, cwd = process.cwd() } = {}) {
  const cnj = (m) => { console.log(`review-evidence: FAIL (could not judge): ${m}`); return 1 }
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: n } = env
  if (!token || !repo || !n) return cnj('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')

  // 1. PR state, live. The PR object carries the current labels, so `pull-requests: read` is enough.
  let pr
  try {
    const r = await getJson(fetchImpl, token, `https://api.github.com/repos/${repo}/pulls/${n}`)
    if (!r.ok) return cnj(`GitHub API ${r.status} reading PR #${n}`)
    pr = r.body
  } catch (e) { return cnj(e.message) }
  const sha = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s)
  if (!isObj(pr) || !sha(pr.head?.sha) || !sha(pr.base?.sha) || typeof pr.base?.ref !== 'string' || !Array.isArray(pr.labels)) return cnj(`PR #${n}: the API reply lacks head, base or labels`)

  // 2. Grandfathering, from the BASE branch's file, only after every PR-state read succeeded.
  let act
  try { act = await readActivation({ fetchImpl, token, repo, ref: pr.base.ref }) } catch (e) { return cnj(e.message) }
  if (act.error) return cnj(act.error)
  if (isGrandfathered({ prCreatedAt: pr.created_at, requiredSince: act.since })) {
    console.log(`review-evidence: ok (grandfathered: PR #${n} was created ${pr.created_at}, before review-evidence was required at ${act.since})`)
    return 0
  }

  // 3. Depth and the body fields. label-gate is the check that enforces exactly one depth label; this one does not
  // fail on the count, because it can read the labels before label-gate's auto-label lands, and a label written with
  // the workflow token starts no new run, so a valid PR would stay red. With no depth label it judges at `standard`,
  // the lowest the bot ever applies; with several, at the highest. The changed-path floor (requiredDepth) still
  // applies. A person's later label change is a `labeled`/`unlabeled` event and so a new run.
  const depths = pr.labels.map((l) => l?.name).filter((x) => DEPTH_LABELS.includes(x))
  const label = depths.length === 0 ? 'standard' : DEPTH_LABELS.filter((d) => depths.includes(d)).at(-1)
  if (depths.length !== 1) console.log(`depth: ${depths.length ? `several depth labels (${depths.join(', ')})` : 'no depth label'}; judging at ${label} (label-gate enforces exactly one)`)
  const body = parseBody(pr.body ?? '', { author: pr.user?.login })

  // 4. The checkout must be the PR's current head: records are read from it, and the identity is its diff.
  let result
  try {
    const local = await gitImpl.head({ cwd })
    if (local !== pr.head.sha) return cnj(`the checkout is ${local}, but the PR's head is now ${pr.head.sha} (a newer push; its own run judges it)`)
    result = await judgeCheckout({ cwd, lane: body.lane, depth: label, body, base: pr.base.sha, head: pr.head.sha, gitImpl })
  } catch (e) { return cnj(e.message) }
  for (const l of result.lines) console.log(l)
  console.log(result.ok ? 'review-evidence: ok' : 'review-evidence: FAIL')
  return result.ok ? 0 : 1
}

// ---------- local ----------

const LOCAL_FILE = (root) => join(root, EVIDENCE_DIR, 'local.json')

// Rebuilds the PR-body fields from local.json and parses them with the same parser CI uses.
const localBody = (local) => {
  const lines = [`Lane: ${local.lane}`]
  if (local.spec !== undefined) lines.push(`Spec: ${local.spec}`)
  if (local.plan !== undefined) lines.push(`Plan: ${local.plan.path} ${(local.plan.tasks ?? []).join(',')}`.trimEnd())
  const devs = local.deviations ?? []
  lines.push(devs.length ? 'Deviations:' : 'Deviations: none', ...devs.map((d) => `- ${d.id}: ${d.justification}`))
  return parseBody(lines.join('\n'))
}

export function validateLocal(local) {
  const p = []
  if (!isObj(local)) return ['local.json must be a JSON object']
  if (!LANES.includes(local.lane)) p.push(`lane must be one of ${LANES.join(', ')}`)
  if (!DEPTH_LABELS.includes(local.depth)) p.push(`depth must be one of ${DEPTH_LABELS.join(', ')}`)
  if (local.spec !== undefined && typeof local.spec !== 'string') p.push('spec must be a path')
  if (local.plan !== undefined && !(isObj(local.plan) && typeof local.plan.path === 'string' && Array.isArray(local.plan.tasks) && local.plan.tasks.every((t) => typeof t === 'string'))) p.push('plan must be { path, tasks: [...] }')
  if (local.deviations !== undefined && !(Array.isArray(local.deviations) && local.deviations.every((d) => isObj(d) && typeof d.id === 'string' && typeof d.justification === 'string'))) p.push('deviations must be [{ id, justification }]')
  if (p.length === 0) p.push(...localBody(local).problems)
  return p
}

// Default base: origin/main as last fetched when it exists, else local main (as scripts/review/runner.mjs).
const localBase = async (cwd) => ((await git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], { cwd })).code === 0 ? 'origin/main' : 'main')

export async function localCheck({ cwd = process.cwd(), gitImpl = defaultGit } = {}) {
  try {
    const root = must(await git(['rev-parse', '--show-toplevel'], { cwd }), 'git rev-parse --show-toplevel').trim()
    const file = LOCAL_FILE(root)
    if (!existsSync(file)) return { ok: false, lines: [`FAIL no ${EVIDENCE_DIR}/local.json: run ${INIT_LOCAL}`] }
    let local
    try { local = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { ok: false, lines: [`FAIL ${EVIDENCE_DIR}/local.json is not JSON (${e.message}): rewrite it with ${INIT_LOCAL}`] } }
    const problems = validateLocal(local)
    if (problems.length) return { ok: false, lines: [...problems.map((x) => `FAIL ${EVIDENCE_DIR}/local.json: ${x}`), `rewrite it with ${INIT_LOCAL}`] }
    const head = await gitImpl.head({ cwd: root })
    return await judgeCheckout({ cwd: root, lane: local.lane, depth: local.depth, body: localBody(local), base: await localBase(root), head, gitImpl, untracked: true })
  } catch (e) {
    return { ok: false, lines: [`FAIL (could not judge): ${e.message}`] }
  }
}

// Writes .review/local.json; returns its path. Throws with every problem on bad input.
export async function initLocal({ cwd = process.cwd(), lane, depth, spec, plan, deviations = [] }) {
  const local = { lane, depth }
  if (spec !== undefined) local.spec = spec
  const problems = []
  if (plan !== undefined) {
    // The PR-body parser checks the task syntax (expandTasks), so local and CI agree on it.
    const parsed = parseBody(`Lane: direct\nPlan: ${plan}\nDeviations: none`)
    problems.push(...parsed.problems.filter((x) => x.startsWith('Plan:')))
    if (parsed.plan) local.plan = { path: parsed.plan.path, tasks: parsed.plan.tasks }
  }
  if (deviations.length) {
    local.deviations = deviations.map((d) => {
      const m = /^(D\d+):\s*(.*)$/.exec(d.trim())
      return m ? { id: m[1], justification: m[2].trim() } : { id: d.trim(), justification: '' }
    })
  }
  for (const x of validateLocal(local)) if (!problems.includes(x)) problems.push(x)
  if (problems.length) throw new Error(problems.join('; '))
  const root = must(await git(['rev-parse', '--show-toplevel'], { cwd }), 'git rev-parse --show-toplevel').trim()
  mkdirSync(join(root, EVIDENCE_DIR), { recursive: true })
  const file = LOCAL_FILE(root)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(local, null, 2) + '\n')
  renameSync(tmp, file)
  return file
}

// Node realpaths the main module's import.meta.url but not argv[1]: compare both through realpathSync, so a
// symlinked path still runs the check instead of exiting 0 with no output; Windows compares case-insensitively.
const isMain = () => {
  if (process.argv[1] === undefined) return false
  try {
    const [a, b] = [realpathSync(process.argv[1]), realpathSync(fileURLToPath(import.meta.url))]
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch { return false }
}
if (isMain()) process.exit(await main())
