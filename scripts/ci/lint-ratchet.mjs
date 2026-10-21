// Lint ratchet (repo harness spec §5.1, D-5). Runs ESLint with JSON output and compares the count of
// findings per rule with .github/lint-baseline.json. A rule's count may fall but never rise. Fails
// closed on anything that is not a counted rule finding: ESLint not starting, a config/runtime exit,
// output that is not JSON, a fatal or rule-less diagnostic (parse error), or a bad baseline.
// Run: node scripts/ci/lint-ratchet.mjs            (judge against the baseline)
//      node scripts/ci/lint-ratchet.mjs --counts   (print current counts as baseline JSON)
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASELINE_PATH = '.github/lint-baseline.json'

export function parseBaseline(text) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`${BASELINE_PATH} is not valid JSON`) }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${BASELINE_PATH} must be a JSON object of rule -> count`)
  }
  for (const [rule, n] of Object.entries(data)) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`${BASELINE_PATH}: count for ${rule} must be a non-negative integer`)
  }
  return data
}

export function countByRule(results) {
  if (!Array.isArray(results)) throw new Error('ESLint output is not a JSON array')
  // The repo always has lintable files, so an empty result means ESLint linted nothing.
  if (results.length === 0) throw new Error('ESLint linted no files')
  const counts = {}
  const unattributed = []
  for (const file of results) {
    if (file === null || typeof file !== 'object' || !Array.isArray(file.messages)) {
      throw new Error('ESLint output has a result without a messages array')
    }
    for (const m of file.messages) {
      if (m.fatal || !m.ruleId) {
        unattributed.push(`${file.filePath}:${m.line ?? '?'} ${m.message}`)
        continue
      }
      counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1
    }
  }
  return { counts, unattributed }
}

// Everything the CLI observed goes in; a verdict comes out. ESLint exits 0 (no errors) or 1 (lint
// errors found) on a completed run; anything else is an execution failure.
export function evaluate({ spawnError, status, stdout, stderr, baselineText }) {
  const fault = (reason) => ({ ok: false, lines: [`lint-ratchet: FAIL (could not judge): ${reason}`] })
  if (spawnError) return fault(`ESLint failed to start: ${spawnError.message}`)
  if (status !== 0 && status !== 1) return fault(`ESLint exited ${status}${stderr ? `\n${stderr.trim()}` : ''}`)
  if (baselineText == null) return fault(`${BASELINE_PATH} is missing`)
  let baseline, results, counts, unattributed
  try { baseline = parseBaseline(baselineText) } catch (e) { return fault(e.message) }
  try { results = JSON.parse(stdout) } catch { return fault('ESLint output is not valid JSON') }
  try { ({ counts, unattributed } = countByRule(results)) } catch (e) { return fault(e.message) }
  if (unattributed.length) return fault(`fatal or rule-less diagnostics:\n  ${unattributed.join('\n  ')}`)

  const lines = []
  let rose = false
  for (const rule of [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort()) {
    const was = baseline[rule] ?? 0
    const now = counts[rule] ?? 0
    if (now > was) { rose = true; lines.push(`  ROSE  ${rule}: ${was} -> ${now}`) }
    else if (now < was) lines.push(`  fell  ${rule}: ${was} -> ${now} (lower ${BASELINE_PATH} in this PR)`)
  }
  lines.unshift(rose ? 'lint-ratchet: FAIL, a rule\'s finding count rose' : 'lint-ratchet: ok')
  return { ok: !rose, lines, counts }
}

function runEslint() {
  try {
    const require = createRequire(import.meta.url)
    const bin = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js')
    // Through this Node, not the npm shim, so Windows needs no shell.
    return spawnSync(process.execPath, [bin, '.', '--format', 'json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } catch (error) {
    return { error }
  }
}

function readBaseline() {
  try { return readFileSync(BASELINE_PATH, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

function main(argv) {
  const r = runEslint()
  const printCounts = argv.includes('--counts')
  const verdict = evaluate({
    spawnError: r.error,
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    baselineText: printCounts ? '{}' : readBaseline(),
  })
  if (printCounts) {
    if (!verdict.counts) { console.error(verdict.lines.join('\n')); return 1 }
    const sorted = Object.fromEntries(Object.entries(verdict.counts).sort(([a], [b]) => a.localeCompare(b)))
    console.log(JSON.stringify(sorted, null, 2))
    return 0
  }
  ;(verdict.ok ? console.log : console.error)(verdict.lines.join('\n'))
  return verdict.ok ? 0 : 1
}

// Compare real paths on both sides: Node resolves symlinks in import.meta.url (unless
// --preserve-symlinks-main) and never in argv[1], and either mismatch would skip main() and exit 0
// unjudged. A realpath error is left to throw, which exits non-zero.
const isMain = process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMain) process.exit(main(process.argv.slice(2)))
