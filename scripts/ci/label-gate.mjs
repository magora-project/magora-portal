// label-gate (repo harness spec §5.3): a PR must carry exactly one depth label. Reads the PR's
// CURRENT labels from the API at run time, not the event payload, so a run always judges the labels
// that exist when it executes. The job's own exit status is the check; nothing posts a status.
//
// Auto-label (AUTO_LABEL=true; the workflow sets it for same-repo PRs only, whose token can write):
// - No depth label, or only ones this bot applied: keep exactly one, inferred from the changed paths
//   on every run (so a later push that adds a migration raises it; it is never lowered).
//   `subtle-correctness` if any path is a migration, under `api/`, or a control file listed in
//   AGENTS.md; else `standard`. `mechanical` is never inferred. Labels added with the workflow token
//   start no new run, so this run is the one that turns the check green.
// - A person applied a depth label: remove the bot's, so a person's label always wins. A person's
//   labels are never removed.
// After any write the labels are re-read and that state is judged.
// Gemini (GEMINI_DISPATCH=true): a label written with the workflow token starts no `labeled` run, and
// gemini-review.yml's `pull_request` runs judge the event payload's labels, so a head the bot raises
// to `subtle-correctness` would get no Gemini review. When this run applies `subtle-correctness`
// itself, it dispatches gemini-review.yml on `main` (a `workflow_dispatch` event always starts a run,
// even from the workflow token). That run reads the PR from the API and reviews its current head.
// A failed dispatch is a warning, not a failed gate: Gemini is advisory and gates nothing.
// Without AUTO_LABEL (fork and Dependabot PRs, read-only token) the gate only judges, as before.
// Run (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_NUMBER=n [AUTO_LABEL=true] node scripts/ci/label-gate.mjs
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const DEPTH_LABELS = ['mechanical', 'standard', 'subtle-correctness']
export const BOT_LOGIN = 'github-actions[bot]'
// GitHub's pull-request files endpoint stops listing at 3000 files.
const FILES_CAP = 3000

export function evaluateLabels(names) {
  const depth = names.filter((n) => DEPTH_LABELS.includes(n))
  if (depth.length === 1) return { ok: true, line: `label-gate: ok (${depth[0]})` }
  const have = depth.length ? `found ${depth.join(', ')}` : 'found none'
  return { ok: false, line: `label-gate: FAIL, need exactly one of ${DEPTH_LABELS.join(', ')}; ${have}` }
}

// The backticked entries of AGENTS.md's "## Control files" section. Throws if none are found, so a
// moved or reworded section cannot silently shrink the list to nothing.
export function parseControlFiles(agentsMd) {
  const section = agentsMd.split(/\r?\n## /).find((s) => s.startsWith('Control files'))
  const entries = section ? [...section.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]) : []
  if (!entries.length) throw new Error('no control files found under "## Control files" in AGENTS.md')
  return entries
}

const matches = (path, pattern) =>
  pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern

export function inferLabel(paths, controlFiles) {
  const subtle = paths.some((p) =>
    p.startsWith('supabase/migrations/') || p.startsWith('api/') || controlFiles.some((c) => matches(p, c)))
  return subtle ? 'subtle-correctness' : 'standard'
}

async function api(fetchImpl, token, url, method = 'GET', body) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${method} ${new URL(url).pathname}`)
  // A workflow dispatch answers 204 No Content (or 200 with run details, on newer API versions).
  return res.status === 204 ? null : res.json()
}

async function paginate(fetchImpl, token, base) {
  const all = []
  for (let page = 1; ; page++) {
    const batch = await api(fetchImpl, token, `${base}${base.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub API returned a non-array list')
    all.push(...batch)
    if (batch.length < 100) return all
  }
}

export async function fetchLabels({ repo, pr, token, fetchImpl = fetch }) {
  const labels = await paginate(fetchImpl, token, `https://api.github.com/repos/${repo}/issues/${pr}/labels`)
  return labels.map((l) => l.name)
}

export async function fetchFiles({ repo, pr, token, fetchImpl = fetch }) {
  const files = await paginate(fetchImpl, token, `https://api.github.com/repos/${repo}/pulls/${pr}/files`)
  return { paths: files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)), capped: files.length >= FILES_CAP }
}

// Depth labels whose current application is the bot's, replayed from the PR's label events:
// a person applying a label makes it theirs, a person removing it clears their claim, and the bot
// applying it makes it the bot's only if no person's claim stands. The bot's own removal never
// clears a person's claim, so when the bot deletes a label a person re-applied in the same moment
// (the API has no conditional delete) and then restores it, it is still the person's.
// Returns { bot, human, botRemoved }: the depth labels each currently owns, and the person-claimed
// labels whose latest event is the bot's own removal (deleted in a race; see autoLabel).
export async function fetchOwnership({ repo, pr, token, fetchImpl = fetch }) {
  const events = await paginate(fetchImpl, token, `https://api.github.com/repos/${repo}/issues/${pr}/events`)
  const owner = new Map(), botRemoved = new Set()
  for (const e of events) {
    const n = e.label?.name
    if (!DEPTH_LABELS.includes(n)) continue
    const isBot = e.actor?.login === BOT_LOGIN
    if (e.event === 'labeled') {
      botRemoved.delete(n)
      if (!isBot) owner.set(n, 'human')
      else if (owner.get(n) !== 'human') owner.set(n, 'bot')
    } else if (e.event === 'unlabeled') {
      if (!isBot) { owner.delete(n); botRemoved.delete(n) } else if (owner.get(n) === 'human') botRemoved.add(n)
    }
  }
  const pick = (who) => new Set([...owner].filter(([, o]) => o === who).map(([n]) => n))
  return { bot: pick('bot'), human: pick('human'), botRemoved }
}

// Ownership, checked against the labels present now. Two states mean the events endpoint has not
// caught up with the labels endpoint: a present label with no owner (every application logs a
// `labeled` event), and an absent label a person still claims that the bot did not remove (their
// removal's event is not visible yet). Wait and re-read, then fail closed rather than guess.
async function ownershipOf(present, { repo, pr, token, fetchImpl, sleep, tries = 3 }) {
  for (let i = 1; ; i++) {
    const o = await fetchOwnership({ repo, pr, token, fetchImpl })
    const unknown = [
      ...present.filter((n) => !o.bot.has(n) && !o.human.has(n)),
      ...[...o.human].filter((n) => !present.includes(n) && !o.botRemoved.has(n)),
    ]
    if (!unknown.length) return o
    if (i >= tries) throw new Error(`the PR's label events do not yet match its labels (${unknown.join(', ')})`)
    await sleep(2000)
  }
}

// Brings the depth labels to the state the rules want, then RE-READS them, so the caller judges the
// PR as it now is, not this run's view of it (a person can change labels while it runs).
// - A person applied any depth label: remove every bot-applied one. A person's are never touched.
// - Otherwise (none, or only the bot's): the target is the label inferred from the CURRENT paths,
//   but never lower than a bot `subtle-correctness` already there (upgrade only, so a later push
//   adding a migration raises `standard`, and nothing lowers it). Add the target, remove the rest.
// `onApply(label)` is called after the bot itself applies a label (not after a restore of a person's).
export async function autoLabel({ repo, pr, token, names, fetchImpl = fetch, readAgents, log, onApply = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = `https://api.github.com/repos/${repo}/issues/${pr}/labels`
  const depth = names.filter((n) => DEPTH_LABELS.includes(n))
  const ctx = { repo, pr, token, fetchImpl, sleep }
  const { bot, human: claims, botRemoved } = await ownershipOf(depth, ctx)
  // A label a person applied, which the bot then removed, was lost in a race (the API has no
  // conditional delete) that this or an earlier run could not see: put it back, then reconcile as
  // usual, so the bot's own label beside it is removed in this same run.
  const lost = [...claims].filter((n) => !depth.includes(n) && botRemoved.has(n))
  if (lost.length) {
    await api(fetchImpl, token, base, 'POST', { labels: lost })
    log(`label-gate: restored ${lost.join(', ')}; a person applied it and did not remove it`)
    depth.push(...lost)
  }
  const human = depth.filter((n) => !bot.has(n))
  let add = null, drop
  if (human.length) {
    drop = depth.filter((n) => bot.has(n))
  } else {
    const { paths, capped } = await fetchFiles({ repo, pr, token, fetchImpl })
    const inferred = capped ? 'subtle-correctness' : inferLabel(paths, parseControlFiles(readAgents()))
    const target = depth.includes('subtle-correctness') ? 'subtle-correctness' : inferred
    if (!depth.includes(target)) add = target
    drop = depth.filter((n) => n !== target)
  }
  if (!add && !drop.length) return lost.length ? fetchLabels({ repo, pr, token, fetchImpl }) : names
  if (add) {
    await api(fetchImpl, token, base, 'POST', { labels: [add] })
    log(`label-gate: applied ${add} from the changed paths (add a different depth label to override)`)
    onApply(add)
  }
  // Ownership is re-read just before deleting: a person may have applied one of these since.
  const stillBot = drop.length ? (await fetchOwnership(ctx)).bot : new Set()
  const deleted = []
  for (const n of drop) {
    if (!stillBot.has(n)) continue
    try { await api(fetchImpl, token, `${base}/${encodeURIComponent(n)}`, 'DELETE') } catch (e) {
      // Already gone: a person removed it (runs per PR do not overlap). Their removal stands.
      if (/GitHub API 404 /.test(e.message)) continue
      throw e
    }
    deleted.push(n)
  }
  if (deleted.length) {
    log(`label-gate: removed auto-applied ${deleted.join(', ')}`)
    // A person who applied one between that read and the DELETE lost it: put it back. It stays
    // theirs (they have applied it), and their own labeled event has queued a run that settles it.
    const after = await fetchOwnership(ctx)
    const restore = deleted.filter((n) => after.human.has(n))
    if (restore.length) {
      await api(fetchImpl, token, base, 'POST', { labels: restore })
      log(`label-gate: restored ${restore.join(', ')}; a person applied it during this run`)
    }
  }
  return fetchLabels({ repo, pr, token, fetchImpl })
}

// Starts gemini-review.yml from `main`'s copy of the workflow, never the PR's: the dispatched run's
// YAML comes from the protected branch. It takes only the PR number and resolves the rest itself.
export async function dispatchGemini({ repo, pr, token, fetchImpl = fetch }) {
  await api(fetchImpl, token, `https://api.github.com/repos/${repo}/actions/workflows/gemini-review.yml/dispatches`, 'POST',
    { ref: 'main', inputs: { pr_number: String(pr) } })
}

export async function main({ env = process.env, fetchImpl, readAgents = () => readFileSync('AGENTS.md', 'utf8'), sleep } = {}) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: pr } = env
  if (!token || !repo || !pr) {
    console.error('label-gate: FAIL (could not judge): GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
    return 1
  }
  const f = fetchImpl ? { fetchImpl } : {}
  let names
  try { names = await fetchLabels({ repo, pr, token, ...f }) } catch (e) {
    console.error(`label-gate: FAIL (could not judge): ${e.message}`)
    return 1
  }
  let botAppliedSubtle = false
  // Dispatch whenever this run applied subtle-correctness, EVEN IF the run then fails: a re-run
  // finds the label already there, applies nothing, and so would never dispatch (Codex review).
  // The dispatched run reads the PR's live labels and skips if the label has gone.
  // Residual: a POST that lands on GitHub but whose response is lost never calls onApply, so that
  // head has no Gemini review until a person labels it or a later push carries the label.
  const maybeDispatch = async () => {
    if (!botAppliedSubtle || env.GEMINI_DISPATCH !== 'true') return
    try {
      await dispatchGemini({ repo, pr, token, ...f })
      console.log('label-gate: started gemini-review for this PR (the bot applied subtle-correctness)')
    } catch (e) {
      console.log(`::warning::label-gate could not start gemini-review (${e.message}); this head has no Gemini review. Run "Gemini review" by hand from main with this PR's number.`)
    }
  }
  if (env.AUTO_LABEL === 'true') {
    const onApply = (label) => { if (label === 'subtle-correctness') botAppliedSubtle = true }
    try { names = await autoLabel({ repo, pr, token, names, readAgents, log: console.log, onApply, ...f, ...(sleep ? { sleep } : {}) }) } catch (e) {
      // Fail closed: a failed reconcile may have left a label the paths no longer allow (a refused
      // upgrade) or two labels. Re-running the job retries it.
      console.error(`label-gate: FAIL (could not judge): auto-label failed (${e.message}); re-run label-gate on the PR's latest commit to retry`)
      await maybeDispatch()
      return 1
    }
  }
  const v = evaluateLabels(names)
  ;(v.ok ? console.log : console.error)(v.line)
  await maybeDispatch()
  return v.ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main())
