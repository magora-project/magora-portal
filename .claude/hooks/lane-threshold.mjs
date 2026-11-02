// UserPromptSubmit hook: states the Specced/Direct lane threshold on every prompt.
//
// It deliberately does NOT classify the prompt. Deciding the lane from natural language
// fails in both directions, so the hook obliges a declaration and the model declares.
// It therefore emits on every prompt; the text says a request that changes nothing owes none.
//
// Fail-open: every internal failure (unreadable stdin, closed stdout) exits 0 with no output.
// Termination signals are not trapped. Kill-switch: LANE_THRESHOLD_DISABLE=1.
// Rules: .claude/rules/process.md § Lanes.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function laneReminder() {
  return `## Lane declaration

Before acting on a request that CHANGES anything, state which lane it is, in one line, in your first response. The lanes are mutually exclusive and Specced WINS ANY OVERLAP, so test Specced first:

- **Specced (test this first).** It changes behaviour, touches more than one module, adds a capability, or goes near schema/migrations, auth, money or PII. Full brainstorming, then a spec, then a plan, then execution, in that order: spec BEFORE implementation.
- **Direct (only if Specced does NOT apply).** Docs-only, a comment, a rename, a revert, or a one-line or single-file mechanical edit. No spec, no plan; just do it.

A config change is Specced unless it is literally a comment.

Unsure means Specced. The cost of an unnecessary spec is an hour; the cost of a missed one is a rebuild.

This hook does not classify your request and cannot. It states the threshold and you declare the lane. It fires on every prompt because it cannot tell which ones are asks.

If the request changes nothing (a question, an acknowledgement, a status check, a correction to something you just said), no declaration is owed. Say nothing and answer normally.

PR \`Lane:\` field: Specced is \`specced\`; Direct is \`direct\`, or \`docs-only\` when the PR only adds or changes a spec or plan; Dependabot PRs are \`dependency\`.

Detail: \`.claude/rules/process.md\` § Lanes.`
}

// stdin is the already-drained payload; it is never read or inspected.
export function main({ stdin = '', stdout = process.stdout, env = process.env } = {}) {
  try {
    void stdin
    if (env.LANE_THRESHOLD_DISABLE === '1') return 0
    const payload = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: laneReminder() },
    })
    stdout.write(payload + '\n')
  } catch {
    // fail open: a reminder must never block a prompt
  }
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Drain stdin first, even when disabled, so the harness never writes into a closed pipe.
  let stdin = ''
  try { stdin = readFileSync(0, 'utf8') } catch { /* fail open */ }
  process.stdout.on('error', () => {})
  process.exitCode = main({ stdin })
}
