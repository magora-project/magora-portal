// Self-test for scripts/review/pr-body.mjs. Pure; no network.
// Run: node scripts/review/pr-body.test.mjs
import { readFileSync } from 'node:fs'
import { expandTasks, parseBody } from './pr-body.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c === true) { pass++ } else { fail++; console.log('  FAIL', n) } }
const A = { author: 'a' }
const probs = (b, o = A) => parseBody(b, o).problems.join(' | ')
const throws = (fn) => { try { fn(); return false } catch { return true } }

ok('CRLF body parses', parseBody('Lane: specced\r\nSpec: docs/s.md\r\nPlan: docs/p.md T1-T2\r\nDeviations: none\r\n', A).problems.length === 0)
ok('bold and bullet forms parse', parseBody('- **Lane:** direct\n- **Deviations:** none', A).lane === 'direct')
ok('unknown lane lists the allowed values', /specced, direct, docs-only, dependency/.test(probs('Lane: big')))
ok('specced without Plan -> problem', parseBody('Lane: specced\nSpec: docs/s.md\nDeviations: none', A).problems.some((p) => /Plan/.test(p)))
ok('range expands', expandTasks('T1-T3,T6').join() === 'T1,T2,T3,T6')
ok('a reversed range is a problem, not an empty list', /range/.test(probs('Lane: specced\nSpec: s\nPlan: p T3-T1\nDeviations: none')))
ok('deviation lines parse', parseBody('Lane: specced\nSpec: s\nPlan: p T1\nDeviations:\n- D1: plan used X; Y is simpler and tested', A).deviations[0].id === 'D1')
ok('a deviation without a justification is a problem', parseBody('Lane: specced\nSpec: s\nPlan: p T1\nDeviations:\n- D1:', A).problems.some((p) => /D1/.test(p)))
ok('dependabot body with no fields -> dependency lane', parseBody('Bumps idb …', { author: 'dependabot[bot]' }).lane === 'dependency')
ok('HTML comments from the template are ignored', parseBody('<!-- Lane: specced -->\nLane: direct\nDeviations: none', A).lane === 'direct')

// Beyond the plan's list
ok('dependabot with no fields raises no problem', parseBody('Bumps idb', { author: 'dependabot[bot]' }).problems.length === 0)
ok('non-dependabot with no Lane -> problem naming Lane', /Lane/.test(probs('hello')))
ok('multi-line comment is stripped', parseBody('<!--\nLane: specced\n-->\nLane: direct\nDeviations: none', A).problems.length === 0)
ok('duplicate Lane -> problem naming the field', /Lane/.test(probs('Lane: direct\nLane: specced\nDeviations: none')) && /more than once/.test(probs('Lane: direct\nLane: specced\nDeviations: none')))
ok('duplicate Plan -> problem', /Plan.*more than once/.test(probs('Lane: direct\nPlan: none\nPlan: p T1\nDeviations: none')))
ok('field names are case-sensitive', /Lane/.test(probs('lane: direct\nDeviations: none')))
ok('expandTasks dedupes preserving order', expandTasks('T2, T1-T3 T2').join() === 'T2,T1,T3')
// 2^53: i++ no longer changes it, so a range ending there would loop forever (Codex, PR #77)
ok('expandTasks rejects task numbers past the safe-integer range', throws(() => expandTasks('T9007199254740992-T9007199254740992')) && throws(() => expandTasks('T9007199254740993')))
ok('expandTasks space separated', expandTasks('T1 T4').join() === 'T1,T4')
ok('expandTasks malformed throws', throws(() => expandTasks('T1,x')) && throws(() => expandTasks('')) && throws(() => expandTasks('T1-')) && throws(() => expandTasks('T3-T1')))
ok('malformed task token is a problem naming the token', /T1x/.test(probs('Lane: specced\nSpec: s\nPlan: p T1x\nDeviations: none')))
ok('Plan path and tasks split', (() => {
  const r = parseBody('Lane: specced\nSpec: `docs/s.md`\nPlan: `docs/p.md` T1-T2, T5\nDeviations: none', A)
  return r.spec === 'docs/s.md' && r.plan.path === 'docs/p.md' && r.plan.tasks.join() === 'T1,T2,T5'
})())
ok('specced with Plan path but no tasks -> problem', /task/.test(probs('Lane: specced\nSpec: s\nPlan: p\nDeviations: none')))
ok('specced without Spec -> problem', parseBody('Lane: specced\nPlan: p T1\nDeviations: none', A).problems.some((p) => /Spec/.test(p)))
ok('specced with Spec: none -> problem', parseBody('Lane: specced\nSpec: none\nPlan: p T1\nDeviations: none', A).problems.some((p) => /Spec/.test(p)))
ok('docs-only with Spec/Plan none parses clean', (() => {
  const r = parseBody('Lane: docs-only\nSpec: none\nPlan: None\nDeviations: none', A)
  return r.problems.length === 0 && r.spec === null && r.plan === null
})())
ok('missing Deviations -> problem', /Deviations/.test(probs('Lane: direct')))
ok('Deviations: NONE -> empty list', (() => { const r = parseBody('Lane: direct\nDeviations: NONE', A); return r.problems.length === 0 && r.deviations.length === 0 })())
ok('empty Deviations with no bullets -> problem', /Deviations/.test(probs('Lane: direct\nDeviations:\n\n## Depth')))
ok('multiple deviation bullets, stops at blank line', (() => {
  const r = parseBody('Lane: direct\nDeviations:\n- D1: a\n* D2: b\n\n- D3: not mine\n', A)
  return r.deviations.map((d) => d.id).join() === 'D1,D2' && r.deviations[1].justification === 'b'
})())
ok('deviation block stops at the next field', parseBody('Lane: direct\nDeviations:\n- D1: a\nSpec: none', A).deviations.length === 1)
ok('inline deviation accepted', parseBody('Lane: direct\nDeviations: D1: because', A).deviations[0].justification === 'because')
ok('duplicate deviation ID -> problem', /D1/.test(probs('Lane: direct\nDeviations:\n- D1: a\n- D1: b')) && /duplicate/.test(probs('Lane: direct\nDeviations:\n- D1: a\n- D1: b')))
ok('non-D<n> bullet under Deviations -> problem', /bullet/.test(probs('Lane: direct\nDeviations:\n- fixed it later')))
ok('trailing spaces trimmed', parseBody('Lane: direct   \nDeviations: none  \r\n', A).lane === 'direct')

// The real template, filled in the way PR bodies in this repo fill it.
const tpl = readFileSync(new URL('../../.github/pull_request_template.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fill = (t, f, v) => t.split('\n').map((l) => (l === `${f}:` ? `${f}: ${v}` : l)).join('\n')
const filled = fill(fill(fill(fill(tpl, 'Lane', 'docs-only'), 'Spec', 'none'), 'Plan', 'docs/superpowers/plans/x.md T19'), 'Deviations', 'none')
ok('filled template parses with no problems', (() => {
  const r = parseBody(filled, A)
  return r.problems.length === 0 && r.lane === 'docs-only' && r.plan.tasks.join() === 'T19'
})())
ok('unfilled template has problems (fields empty)', parseBody(tpl, A).problems.length > 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
