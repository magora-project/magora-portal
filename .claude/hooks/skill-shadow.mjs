// Steers from the superpowers plugin's brainstorming and writing-plans skills to this repo's own
// copies, on both paths a skill starts by: PreToolUse on the Skill tool (Claude invokes it) and
// UserPromptExpansion (a person types /superpowers:<name>, which never reaches PreToolUse).
//
// It steers; it is not a security boundary. Fail-open: any parse failure or internal error allows
// (prints nothing, exits 0).
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SHADOWED = {
  'superpowers:brainstorming': 'brainstorming',
  'superpowers:writing-plans': 'writing-plans',
}

// payload -> null (allow) | { permissionDecision: 'deny', permissionDecisionReason }
export function decide(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (payload.tool_name !== 'Skill') return null
  const input = payload.tool_input
  const name = input !== null && typeof input === 'object' ? input.skill : undefined
  if (typeof name !== 'string' || !Object.hasOwn(SHADOWED, name)) return null
  const mine = SHADOWED[name]
  return {
    permissionDecision: 'deny',
    permissionDecisionReason:
      `This repo has its own \`${mine}\` skill, which replaces \`${name}\`. Invoke \`${mine}\` instead ` +
      `(the project copy under .claude/skills/${mine}/).`,
  }
}

// UserPromptExpansion payload -> null (allow) | { decision: 'block', reason }. command_name carries
// the plugin prefix (observed 2026-11-03: "superpowers:brainstorming", command_source "plugin"), so
// the project skill typed as /brainstorming is not matched.
export function decideExpansion(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (payload.hook_event_name !== 'UserPromptExpansion') return null
  const name = payload.command_name
  if (typeof name !== 'string' || !Object.hasOwn(SHADOWED, name)) return null
  const mine = SHADOWED[name]
  return {
    decision: 'block',
    reason: `This repo has its own \`${mine}\` skill, which replaces \`${name}\`. Type /${mine} instead ` +
      `(the project copy under .claude/skills/${mine}/).`,
  }
}

export function main({ stdin = '', stdout = process.stdout } = {}) {
  try {
    const payload = JSON.parse(stdin)
    if (payload !== null && typeof payload === 'object' && payload.hook_event_name === 'UserPromptExpansion') {
      const verdict = decideExpansion(payload)
      if (verdict) stdout.write(JSON.stringify(verdict) + '\n')
      return 0
    }
    const verdict = decide(payload)
    if (verdict) {
      stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...verdict } }) + '\n')
    }
  } catch {
    // fail open
  }
  return 0
}

// Compare real paths on both sides: Node resolves symlinks in import.meta.url (unless
// --preserve-symlinks-main) and never in argv[1], so a symlinked project path would skip main().
// This hook fails open, so a realpath error counts as "is main" and the hook still runs.
function isMain() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return true
  }
}

if (isMain()) {
  let stdin = ''
  try { stdin = readFileSync(0, 'utf8') } catch { /* fail open */ }
  process.stdout.on('error', () => {})
  process.exitCode = main({ stdin })
}
