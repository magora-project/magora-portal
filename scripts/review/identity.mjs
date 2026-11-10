// Input identity: a hash of a PR's own diff, stable across machines and git configs.
// Consumed by the review-evidence records store, runner and CI check.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

// User gitattributes can mark a text file `-diff` (binary) and turn its diff into a `GIT binary patch`, so the
// identity would differ between a developer's machine and CI. core.attributesFile (and its default,
// $XDG_CONFIG_HOME/git/attributes or ~/.config/git/attributes) is pointed at this committed, empty file.
// `--text` is NOT a fix: patch-id stops reading a line at its first NUL, so two different binary edits get one ID.
// The work tree's own .gitattributes is replaced by the empty tree's (none) with `--attr-source` (git 2.40+; an
// older git refuses the option, so every call fails closed). Without it, a PR that commits `*.js -diff` hides its
// own edit from Gemini as "Binary files differ", and the identity depends on which commit is checked out.
// Known gap: $GIT_DIR/info/attributes cannot be switched off from the command line (`--attr-source` only
// replaces the work tree's .gitattributes, measured on git 2.54). A repo-local info/attributes entry that
// changes the diff attribute still changes the local identity; CI's fresh checkout has none.
export const EMPTY_ATTRIBUTES = fileURLToPath(new URL('./empty.gitattributes', import.meta.url))
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export const git = (args, { cwd } = {}) => run([`--attr-source=${EMPTY_TREE}`, '-c', 'core.quotePath=true', '-c', 'core.autocrlf=false', '-c', `core.attributesFile=${EMPTY_ATTRIBUTES}`, ...args], { cwd })

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
