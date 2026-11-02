// PreToolUse hook on the Skill tool: steers agents from the superpowers plugin's brainstorming and
// writing-plans skills to this repo's own copies of them.
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

export function main({ stdin = '', stdout = process.stdout } = {}) {
  try {
    const verdict = decide(JSON.parse(stdin))
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
