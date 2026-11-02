// Self-test for the committed repo skills in .claude/skills/*/SKILL.md. Pure; reads files only.
// Run: node scripts/review/skills.test.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REQUIRED = ['brainstorming', 'writing-plans', 'push-readiness']

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

ok('the three required skills exist', requiredSkillsPresent(skills))
ok('removing any one required skill fails the check', REQUIRED.every((n) => !requiredSkillsPresent(skills.filter((s) => s.dir !== n))))
ok('every skill has frontmatter name equal to its directory', skills.every((s) => s.frontmatter.name === s.dir))
ok('every skill has a description', skills.every((s) => (s.frontmatter.description ?? '').length > 0))
ok('no skill references ~/code or claude-config', skills.every((s) => !/~\/code|claude-config|\.claude-[a-z]\b/.test(s.body)))
ok('no skill tells the agent to run bash or a .sh script', skills.every((s) => !/\bbash\b|\.sh\b/.test(s.body)))
ok('every repo-relative path a skill names exists', skills.flatMap((s) => s.repoPaths).every((p) => existsSync(join(root, p))))

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
