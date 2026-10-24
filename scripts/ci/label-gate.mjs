// label-gate (repo harness spec §5.3): a PR must carry exactly one depth label. Reads the PR's
// CURRENT labels from the API at run time, not the event payload, so a run always judges the labels
// that exist when it executes. The job's own exit status is the check; nothing posts a status.
// Run (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_NUMBER=n node scripts/ci/label-gate.mjs
import { pathToFileURL } from 'node:url'

export const DEPTH_LABELS = ['mechanical', 'standard', 'subtle-correctness']

export function evaluateLabels(names) {
  const depth = names.filter((n) => DEPTH_LABELS.includes(n))
  if (depth.length === 1) return { ok: true, line: `label-gate: ok (${depth[0]})` }
  const have = depth.length ? `found ${depth.join(', ')}` : 'found none'
  return { ok: false, line: `label-gate: FAIL, need exactly one of ${DEPTH_LABELS.join(', ')}; ${have}` }
}

export async function fetchLabels({ repo, pr, token, fetchImpl = fetch }) {
  const names = []
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${pr}/labels?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status} reading labels`)
    const batch = await res.json()
    if (!Array.isArray(batch)) throw new Error('GitHub API returned a non-array label list')
    names.push(...batch.map((l) => l.name))
    if (batch.length < 100) return names
  }
}

export async function main({ env = process.env, fetchImpl } = {}) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: pr } = env
  if (!token || !repo || !pr) {
    console.error('label-gate: FAIL (could not judge): GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
    return 1
  }
  let names
  try { names = await fetchLabels({ repo, pr, token, ...(fetchImpl ? { fetchImpl } : {}) }) } catch (e) {
    console.error(`label-gate: FAIL (could not judge): ${e.message}`)
    return 1
  }
  const v = evaluateLabels(names)
  ;(v.ok ? console.log : console.error)(v.line)
  return v.ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main())
