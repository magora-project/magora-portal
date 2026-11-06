// Input identity: a hash of a PR's own diff, stable across machines and git configs.
// Consumed by the review-evidence records store, runner and CI check.
import { spawn } from 'node:child_process'

export const EVIDENCE_DIR = '.review'

// Every flag here pins a behavior a user's git config could otherwise change.
export const DIFF_ARGS = ['diff', '-U0', '--no-ext-diff', '--no-textconv', '--binary', '--no-color', '--no-renames',
  '--diff-algorithm=myers', '--indent-heuristic', '--inter-hunk-context=0', '--src-prefix=a/', '--dst-prefix=b/']

const EXCLUDE_EVIDENCE = ['--', '.', `:(exclude)${EVIDENCE_DIR}`]

const run = (args, { cwd, input } = {}) => new Promise((resolve, reject) => {
  const child = spawn('git', args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const out = [], err = []
  child.stdout.on('data', (d) => out.push(d))
  child.stderr.on('data', (d) => err.push(d))
  child.on('error', reject)
  child.stdin.on('error', () => {}) // git may exit before reading all of its input
  child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }))
  child.stdin.end(input)
})

export const git = (args, { cwd } = {}) => run(['-c', 'core.quotePath=true', '-c', 'core.autocrlf=false', ...args], { cwd })

const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`)
  return r.stdout
}

export const mergeBase = async ({ cwd, base, head }) =>
  must(await git(['merge-base', base, head], { cwd }), 'git merge-base').toString().trim()

export const inputIdentity = async ({ cwd, base, head }) => {
  const mb = await mergeBase({ cwd, base, head })
  const diff = must(await git([...DIFF_ARGS, mb, head, ...EXCLUDE_EVIDENCE], { cwd }), 'git diff')
  const pid = must(await run(['patch-id', '--verbatim'], { cwd, input: diff }), 'git patch-id').toString().trim()
  return pid ? pid.split(/\s+/)[0] : 'empty'
}

export const blobIdentity = async ({ cwd, rev, path }) =>
  must(await git(['rev-parse', `${rev}:${path}`], { cwd }), 'git rev-parse').toString().trim()

export const geminiDiff = async ({ cwd, base, head }) =>
  must(await git(['diff', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', `${base}...${head}`, ...EXCLUDE_EVIDENCE], { cwd }), 'git diff')
