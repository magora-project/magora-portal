#!/usr/bin/env node
// Local review CLI. Also: npm run review -- <run|dispose|conformance|check|init-local> ...
//   run, dispose: see scripts/review/runner.mjs for the flags.
//   conformance --plan <path> --tasks <ids> --author <vendor> [...]: the plan's postconditions and the conformance
//     review, written as one conformance record (scripts/review/conformance.mjs, spec §5.4).
//   check --local: judges the records in .review/records/ against this checkout, as CI's review-evidence
//     does, with the lane, depth and fields from .review/local.json (scripts/ci/review-evidence.mjs). Exit 0 or 1.
//   init-local --lane <lane> --depth <label> [--spec <path>] [--plan "<path> <tasks>"] [--deviation "<id>: why"]...
//     writes .review/local.json (machine-local, git-ignored).
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runCli } from './runner.mjs'
import { conformanceCli } from './conformance.mjs'
import { initLocal, localCheck } from '../ci/review-evidence.mjs'

const USAGE = `usage:
  review.mjs check --local
  review.mjs init-local --lane <lane> --depth <label> [--spec <path>] [--plan "<path> <tasks>"] [--deviation "<D<n> or <stem>#D<n>>: justification"]...`

export async function reviewCli(argv, opts = {}) {
  const io = opts.io ?? { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }
  const cwd = opts.cwd ?? process.cwd()
  const [cmd, ...rest] = argv
  if (cmd === 'conformance') return conformanceCli(rest, { ...opts, io, cwd })
  if (cmd !== 'check' && cmd !== 'init-local') return runCli(argv, { ...opts, io, cwd })
  try {
    if (cmd === 'check') {
      const { values } = parseArgs({ args: rest, options: { local: { type: 'boolean' } }, strict: true, allowPositionals: false })
      if (!values.local) throw new Error('check needs --local (CI runs scripts/ci/review-evidence.mjs)')
      const r = await localCheck({ cwd })
      io.out(`${r.lines.join('\n')}\n${r.ok ? 'review-evidence (local): ok' : 'review-evidence (local): FAIL'}\n`)
      return r.ok ? 0 : 1
    }
    const { values: o } = parseArgs({
      args: rest, strict: true, allowPositionals: false,
      options: { lane: { type: 'string' }, depth: { type: 'string' }, spec: { type: 'string' }, plan: { type: 'string' }, deviation: { type: 'string', multiple: true } },
    })
    const file = await initLocal({ cwd, lane: o.lane, depth: o.depth, spec: o.spec, plan: o.plan, deviations: o.deviation ?? [] })
    io.out(`wrote ${file}\n`)
    return 0
  } catch (e) {
    io.err(`${e && e.message}\n${USAGE}\n`)
    return 1
  }
}

const isMain = () => {
  if (process.argv[1] === undefined) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}
if (isMain()) process.exitCode = await reviewCli(process.argv.slice(2))
