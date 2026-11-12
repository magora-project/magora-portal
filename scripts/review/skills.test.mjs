// Self-test for the committed repo skills in .claude/skills/*/SKILL.md. Pure; reads files only.
// Run: node scripts/review/skills.test.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SLOTS } from './records.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REQUIRED = ['brainstorming', 'writing-plans', 'push-readiness', 'codex-review', 'conformance']

let pass = 0, fail = 0
// A thenable condition is a failure: a Promise is truthy even when it resolves to false.
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

export function parseSkill(dir, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const frontmatter = {}
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
      if (kv) frontmatter[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
    }
  }
  const body = m ? m[2] : text
  const repoPaths = [...text.matchAll(/`([^`\s]+)`/g)]
    .map((t) => t[1])
    .filter((t) => t.includes('/') && /^(\.claude|scripts|docs|\.github)\//.test(t))
  return { dir, frontmatter, body, repoPaths }
}

export function loadSkills(base) {
  const skillsDir = join(base, '.claude', 'skills')
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
    .map((e) => parseSkill(e.name, readFileSync(join(skillsDir, e.name, 'SKILL.md'), 'utf8')))
}

export const requiredSkillsPresent = (skills) => REQUIRED.every((n) => skills.some((s) => s.dir === n))

const skills = loadSkills(root)

ok('the required skills exist', requiredSkillsPresent(skills))
ok('removing any one required skill fails the check', REQUIRED.every((n) => !requiredSkillsPresent(skills.filter((s) => s.dir !== n))))
ok('every skill has frontmatter name equal to its directory', skills.every((s) => s.frontmatter.name === s.dir))
ok('every skill has a description', skills.every((s) => (s.frontmatter.description ?? '').length > 0))
ok('no skill references ~/code or claude-config', skills.every((s) => !/~\/code|claude-config|\.claude-[a-z]\b/.test(s.body)))
ok('no skill tells the agent to run bash or a .sh script', skills.every((s) => !/\bbash\b|\.sh\b/.test(s.body)))
const namedPaths = skills.flatMap((s) => s.repoPaths)
ok('every repo-relative path a skill names exists', namedPaths.length > 0 && namedPaths.every((p) => existsSync(join(root, p))))

// Slot prompts: .claude/review/slots/<slot>.md, one file for all substitute:<bot> slots.
const slotsDir = join(root, '.claude', 'review', 'slots')
const slotFileFor = (s) => join(slotsDir, `${s.startsWith('substitute:') ? 'substitute' : s}.md`)
ok('every slot ID has a prompt file (substitute:* share substitute.md)', SLOTS.every((s) => existsSync(slotFileFor(s))))
const slotPrompts = SLOTS.filter((s) => existsSync(slotFileFor(s))).map((s) => readFileSync(slotFileFor(s), 'utf8'))
ok('every slot prompt ends by requiring the verdict JSON', slotPrompts.length > 0 && slotPrompts.every((p) => p.trimEnd().split('\n').at(-1).includes('verdict.schema.json')))
ok('every slot prompt names the P0-P3 severities', slotPrompts.length > 0 && slotPrompts.every((p) => /P0/.test(p) && /P3/.test(p)))
ok('substitute.md carries the {{bot}} placeholder the runner fills', existsSync(slotFileFor('substitute:codex')) && /\{\{bot\}\}/.test(readFileSync(slotFileFor('substitute:codex'), 'utf8')))
ok('brainstorming and writing-plans name codex-review and drop the not-available caveat', ['brainstorming', 'writing-plans'].every((n) => {
  const b = skills.find((x) => x.dir === n)?.body ?? ''
  return b.includes('.claude/skills/codex-review/SKILL.md') && b.includes('scripts/review/review.mjs') && !/not available yet/i.test(b)
}))
ok('codex-review documents --author, --supersedes, dispose and the scan', (() => {
  const b = skills.find((x) => x.dir === 'codex-review')?.body ?? ''
  return /--author/.test(b) && /--supersedes/.test(b) && /dispose/.test(b) && /semgrep-artifact\.mjs/.test(b)
})())

// Plan Task 18 shipped `review.mjs conformance`: codex-review hands the stage to the conformance skill, which names
// the command, the re-run and the Deviations field, and no skill still calls conformance unavailable.
const bodyOf = (n) => skills.find((x) => x.dir === n)?.body ?? ''
export const conformanceRunnable = (codexReview, conformance) => codexReview.includes('.claude/skills/conformance/SKILL.md')
  && !/not runnable yet|arrives with plan Task 18|no local conformance review yet/.test(codexReview)
  && /npm run review -- conformance --plan/.test(conformance) && /--supersedes/.test(conformance) && /Deviations:/.test(conformance)
ok('codex-review points to the conformance skill, which documents the command, --supersedes and Deviations', conformanceRunnable(bodyOf('codex-review'), bodyOf('conformance')))
ok('the conformance check fails on the old deferred wording', conformanceRunnable('see .claude/skills/conformance/SKILL.md; conformance is not runnable yet', bodyOf('conformance')) === false)
ok('writing-plans has a Typed targets section naming the five types and checkExisting', (() => {
  const b = bodyOf('writing-plans')
  return /^## Typed targets$/m.test(b) && ['existing', 'create', 'modify', 'delete', 'command'].every((t) => b.includes(`\`${t}\``)) && /checkExisting/.test(b)
})())

// The checker itself: it must be able to fail.
const fake = (dir, text) => parseSkill(dir, text)
ok('a skill with a mismatched name is caught', !(fake('a', '---\nname: b\ndescription: x\n---\nbody').frontmatter.name === 'a'))
ok('a backticked missing path is collected as a repo path', fake('a', '---\nname: a\n---\nsee `docs/nope/x.md`').repoPaths.includes('docs/nope/x.md'))
ok('a bare word or non-repo path is not a repo path', fake('a', '---\nname: a\n---\n`foo` `src/x.js`').repoPaths.length === 0)
ok('ok() counts a thenable as a failure', (() => {
  const before = fail
  const { log } = console
  console.log = () => {}
  try { ok('probe', Promise.resolve(true)) } finally { console.log = log }
  const caught = fail === before + 1
  fail = before
  return caught
})())

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
