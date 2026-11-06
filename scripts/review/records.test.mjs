// Self-test for scripts/review/records.mjs. Writes into mkdtemp scratch dirs and deletes them afterwards.
// Run: node scripts/review/records.test.mjs
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const { chainHeads, dispositionOk, inherit, isBlockingByDefault, readRecords, slotFile, validateRecord, writeRecord } = await import('./records.mjs')

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}
const throws = (fn) => { try { fn(); return null } catch (e) { return String(e && e.message) } }

const id = 'abcdef0123456789abcdef0123456789abcdef01'
const good = {
  schema: 1, type: 'prepush', slot: 'correctness',
  input: { kind: 'pr', identity: id, mergeBase: 'a'.repeat(40), head: 'b'.repeat(40) },
  reviewer: { vendor: 'openai', model: 'gpt-x' }, authorVendor: 'anthropic',
  outcome: 'completed', verdict: 'fail', findings: [], supersedes: null, createdAt: '2026-11-05T10:00:00.000Z',
}
const mk = (over) => ({ ...good, ...over })

const cwd = mkdtempSync(join(tmpdir(), 'records-test-'))
try {
  // --- slotFile ---
  ok('slotFile replaces : with -', slotFile('substitute:coderabbit') === 'substitute-coderabbit')
  ok('slotFile leaves a plain slot alone', slotFile('spec') === 'spec')

  // --- write / read ---
  const sub = mk({ type: 'substitute', slot: 'substitute:coderabbit' })
  const p = writeRecord({ cwd, record: sub })
  ok('substitute:coderabbit writes substitute-coderabbit--<id12>--1.json', basename(p) === `substitute-coderabbit--${id.slice(0, 12)}--1.json`)
  ok('the record lands under .review/records', p === join(cwd, '.review', 'records', basename(p)))
  ok('records are written with LF and a trailing newline', readFileSync(p, 'utf8').endsWith('}\n') && !readFileSync(p, 'utf8').includes('\r'))
  const p2 = writeRecord({ cwd, record: sub })
  ok('a second record for the same slot and identity gets --2', basename(p2).endsWith('--2.json'))
  const p3 = writeRecord({ cwd, record: sub })
  ok('a third gets --3 (skips every taken number)', basename(p3).endsWith('--3.json'))
  const pc = writeRecord({ cwd, record: mk({ slot: 'correctness' }) })
  const stemC = basename(pc, '.json')
  const renamedStem = 'totally-unrelated-name'
  renameSync(pc, join(cwd, '.review', 'records', `${renamedStem}.json`))
  const all = readRecords({ cwd })
  ok('readRecords returns every record with its stem', all.length === 3 + 1 && all.every((r) => typeof r.stem === 'string'))
  ok('slot is read from the body, not the filename', all.find((r) => r.stem === renamedStem).slot === 'correctness')
  ok('the renamed stem no longer matches the old one', all.some((r) => r.stem === stemC) === false)
  ok('a valid record has no invalid marker', all.every((r) => r.invalid === undefined))
  ok('a blob record uses the blob identity for id12', basename(writeRecord({ cwd, record: mk({ type: 'spec', slot: 'spec', input: { kind: 'blob', identity: 'f'.repeat(40), path: 'docs/x.md' } }) })) === `spec--${'f'.repeat(12)}--1.json`)
  ok('writeRecord refuses an invalid record, naming the field', /outcome/.test(throws(() => writeRecord({ cwd, record: mk({ outcome: 'ok' }) })) || ''))
  ok('an empty cwd with no store reads as []', readRecords({ cwd: join(cwd, 'nowhere') }).length === 0)

  // --- invalid files ---
  const rdir = join(cwd, '.review', 'records')
  writeFileSync(join(rdir, 'broken.json'), '{ not json')
  writeFileSync(join(rdir, 'badfield.json'), JSON.stringify({ ...good, outcome: 'ok' }))
  writeFileSync(join(rdir, 'array.json'), '[]')
  writeFileSync(join(rdir, 'notes.txt'), 'ignored')
  mkdirSync(join(rdir, 'dir.json'))
  const again = readRecords({ cwd })
  const broken = again.find((r) => r.stem === 'broken')
  ok('unparseable JSON is returned with invalid and its stem, not thrown', broken && Array.isArray(broken.invalid) && broken.invalid.length > 0)
  ok('a record failing validation is returned with invalid problems', again.find((r) => r.stem === 'badfield').invalid.some((x) => /outcome/.test(x)))
  ok('a JSON array is returned as invalid', Array.isArray(again.find((r) => r.stem === 'array').invalid))
  ok('non-.json files and directories are ignored', again.every((r) => r.stem !== 'notes' && r.stem !== 'dir'))

  // --- chainHeads ---
  const a = { stem: 'a', supersedes: null }, b = { stem: 'b', supersedes: 'a' }, c = { stem: 'c', supersedes: 'b' }
  ok('chainHeads drops a superseded record', chainHeads([a, b]).map((r) => r.stem).join() === b.stem)
  ok('chainHeads of a chain of three gives only the last', chainHeads([c, a, b]).map((r) => r.stem).join() === 'c')
  ok('a record superseding a missing stem is still a head', chainHeads([{ stem: 'z', supersedes: 'gone' }]).map((r) => r.stem).join() === 'z')
  ok('two independent chains give two heads', chainHeads([a, b, { stem: 'x', supersedes: null }]).map((r) => r.stem).sort().join() === 'b,x')

  // --- isBlockingByDefault ---
  ok('P0, P1, P2 block', ['P0', 'P1', 'P2'].every((severity) => isBlockingByDefault({ severity }) === true))
  ok('P3 is a nit', isBlockingByDefault({ severity: 'P3' }) === false)
  ok('severity "high" is blocking by default (unparseable)', isBlockingByDefault({ severity: 'high' }))
  ok('a missing severity is blocking by default', isBlockingByDefault({}) === true)

  // --- dispositionOk ---
  const f = (severity, disposition) => ({ id: 'F1', severity, disposition })
  ok('a P3 with no disposition is fine', dispositionOk(f('P3')))
  ok('an undisposed P1 is not ok', dispositionOk(f('P1')) === false)
  ok('fixed with by is ok', dispositionOk(f('P1', { kind: 'fixed', by: 'correctness--abc--2' })))
  ok('fixed without by is not ok', dispositionOk(f('P1', { kind: 'fixed' })) === false)
  ok('fixed with a blank by is not ok', dispositionOk(f('P1', { kind: 'fixed', by: '  ' })) === false)
  ok('pre-existing with reason and issue is ok', dispositionOk(f('P1', { kind: 'pre-existing', reason: 'x', issue: '#12' })))
  ok('pre-existing without an issue is not an acceptable disposition', dispositionOk({ severity: 'P1', disposition: { kind: 'pre-existing', reason: 'x' } }) === false)
  ok('pre-existing without a reason is not ok', dispositionOk(f('P1', { kind: 'pre-existing', issue: '#12' })) === false)
  ok('reclassified-nit with a reason is ok', dispositionOk(f('P1', { kind: 'reclassified-nit', reason: 'style only' })))
  ok('reclassified-nit without a reason is not ok', dispositionOk(f('P1', { kind: 'reclassified-nit' })) === false)
  ok('an unknown disposition kind is not ok', dispositionOk(f('P1', { kind: 'wontfix', reason: 'x' })) === false)
  const jd = { id: 'D1', severity: 'P1', disposition: { kind: 'justified-deviation' } }
  const devs = [{ id: 'D1', justification: 'plan used X; Y is simpler and tested' }]
  ok('a justified conformance deviation listed in Deviations is acceptable', dispositionOk(jd, { deviations: devs, recordType: 'conformance' }))
  ok('justified-deviation absent from Deviations is not acceptable', dispositionOk(jd, { deviations: [], recordType: 'conformance' }) === false)
  ok('justified-deviation with no options is not acceptable', dispositionOk(jd) === false)
  ok('justified-deviation in a non-conformance record is not acceptable', dispositionOk(jd, { deviations: devs, recordType: 'prepush' }) === false)
  ok('justified-deviation with no recordType is not acceptable', dispositionOk(jd, { deviations: devs }) === false)
  ok('justified-deviation with a blank justification is not acceptable', dispositionOk(jd, { deviations: [{ id: 'D1', justification: '   ' }], recordType: 'conformance' }) === false)
  ok('justified-deviation for a different ID is not acceptable', dispositionOk(jd, { deviations: [{ id: 'D2', justification: 'ok' }], recordType: 'conformance' }) === false)

  // --- inherit ---
  const rec = { stem: 'correctness--abc--1', findings: [
    { id: 'F1', severity: 'P1', summary: 'fixed one', disposition: { kind: 'fixed', by: 'correctness--abc--2' } },
    { id: 'F2', severity: 'P3', summary: 'nit' },
    { id: 'F3', severity: 'P2', summary: 'pre', disposition: { kind: 'pre-existing', reason: 'r', issue: '#1' } },
    { id: 'F4', severity: 'P1', summary: 'bad fix', disposition: { kind: 'fixed' } },
  ] }
  ok('inherit drops fixed, pre-existing and P3, keeps an invalidly disposed finding', inherit(rec).map((x) => x.id).join() === `${rec.stem}#F4`)
  ok('an inherited finding carries no stale disposition', inherit(rec)[0].disposition === undefined)
  const rec1 = { stem: 'r1', findings: [{ id: 'F1', severity: 'P1', summary: 's' }, { id: 'F9', severity: 'P1', summary: 'x', disposition: { kind: 'fixed', by: 'q' } }] }
  ok('inherit carries an undisposed P1 and drops a fixed one', inherit(rec1).map((x) => x.id).join() === `${rec1.stem}#F1`)
  const subRec = { stem: 'substitute-codex--abc--1', findings: [{ id: 'thread:PRRT_abc', severity: 'P1', summary: 's' }] }
  ok('inherit keeps a gate ID unprefixed', inherit(subRec).map((x) => x.id).join() === 'thread:PRRT_abc')
  ok('inherit keeps cr: and gemini: IDs unprefixed', inherit({ stem: 's', findings: [{ id: 'cr:1', severity: 'P1', summary: 's' }, { id: 'gemini:2', severity: 'P0', summary: 's' }] }).map((x) => x.id).join() === 'cr:1,gemini:2')
  const subFixed = { stem: 'substitute-codex--abc--2', findings: [
    { id: 'thread:PRRT_fixed', severity: 'P1', summary: 's', disposition: { kind: 'fixed', by: 'substitute-codex--abc--2' } },
    { id: 'F1', severity: 'P1', summary: 's', disposition: { kind: 'fixed', by: 'x' } },
    { id: 'thread:PRRT_open', severity: 'P1', summary: 's' },
  ] }
  ok('inherit copies a fixed gate-ID finding with its disposition, and still drops a fixed ordinary one', (() => { const out = inherit(subFixed); const g = out.find((x) => x.id === 'thread:PRRT_fixed'); return g && g.disposition.kind === 'fixed' && g.disposition.by === subFixed.stem && !out.some((x) => x.id.endsWith('#F1')) })())
  ok('inherit also keeps an undisposed gate-ID finding, without a disposition', (() => { const g = inherit(subFixed).find((x) => x.id === 'thread:PRRT_open'); return g !== undefined && g.disposition === undefined })())
  const gates = inherit({ stem: 'substitute-gemini--abc--1', findings: [
    { id: 'gemini:pre', severity: 'P1', summary: 's', disposition: { kind: 'pre-existing', reason: 'r', issue: '#9' } },
    { id: 'cr:nit', severity: 'P2', summary: 's', disposition: { kind: 'reclassified-nit', reason: 'style' } },
    { id: 'thread:p3', severity: 'P3', summary: 's' },
    { id: 'thread:bad', severity: 'P1', summary: 's', disposition: { kind: 'fixed' } },
  ] })
  ok('inherit carries a pre-existing gate finding with its disposition', gates.find((x) => x.id === 'gemini:pre')?.disposition?.issue === '#9')
  ok('inherit carries a reclassified-nit gate finding with its disposition', gates.find((x) => x.id === 'cr:nit')?.disposition?.kind === 'reclassified-nit')
  ok('inherit carries a P3 gate finding', gates.some((x) => x.id === 'thread:p3'))
  ok('inherit carries an invalidly disposed gate finding without the disposition', (() => { const g = gates.find((x) => x.id === 'thread:bad'); return g !== undefined && g.disposition === undefined })())
  ok('inherit drops a P3 ordinary finding but carries every gate finding', gates.length === 4 && inherit({ stem: 'o', findings: [{ id: 'F1', severity: 'P3', summary: 's' }] }).length === 0)
  ok('inherit does not mutate its input', subFixed.findings.length === 3 && subFixed.findings[0].id === 'thread:PRRT_fixed')
  ok('inherit of a record with no findings is []', inherit({ stem: 'e', findings: [] }).length === 0)

  // --- validateRecord ---
  ok('validateRecord rejects an unknown outcome, naming the field, and accepts the base fixture', validateRecord(good).length === 0 && validateRecord({ ...good, outcome: 'ok' }).some((x) => /outcome/.test(x)))
  const bad = (over, re) => validateRecord(mk(over)).some((x) => re.test(x))
  ok('rejects schema 2', bad({ schema: 2 }, /schema/))
  ok('rejects an unknown type', bad({ type: 'x' }, /type/))
  ok('rejects an unknown slot', bad({ slot: 'x' }, /slot/))
  ok('rejects an unknown input.kind', bad({ input: { ...good.input, kind: 'x' } }, /input\.kind/))
  ok('rejects an empty input.identity', bad({ input: { ...good.input, identity: '' } }, /input\.identity/))
  ok('rejects a missing input', bad({ input: undefined }, /input/))
  ok('rejects an unknown reviewer.vendor', bad({ reviewer: { vendor: 'x', model: 'm' } }, /reviewer\.vendor/))
  ok('rejects an empty reviewer.model', bad({ reviewer: { vendor: 'openai', model: '' } }, /reviewer\.model/))
  ok('accepts authorVendor none', validateRecord(mk({ authorVendor: 'none' })).length === 0)
  ok('rejects an unknown authorVendor', bad({ authorVendor: 'x' }, /authorVendor/))
  ok('accepts a null verdict', validateRecord(mk({ verdict: null })).length === 0)
  ok('rejects an unknown verdict', bad({ verdict: 'maybe' }, /verdict/))
  ok('rejects a non-array findings', bad({ findings: {} }, /findings/))
  ok('rejects a finding with no id', bad({ findings: [{ severity: 'P1', summary: 's' }] }, /findings\[0\]\.id/))
  ok('rejects a finding with no summary', bad({ findings: [{ id: 'F1', severity: 'P1' }] }, /findings\[0\]\.summary/))
  ok('accepts an unknown string severity (it must stay representable)', validateRecord(mk({ findings: [{ id: 'F1', severity: 'high', summary: 's' }] })).length === 0)
  ok('rejects a non-string severity', bad({ findings: [{ id: 'F1', severity: 1, summary: 's' }] }, /findings\[0\]\.severity/))
  ok('rejects a non-integer finding line', bad({ findings: [{ id: 'F1', severity: 'P1', summary: 's', line: 'x' }] }, /findings\[0\]\.line/))
  ok('rejects an unknown disposition kind', bad({ findings: [{ id: 'F1', severity: 'P1', summary: 's', disposition: { kind: 'x' } }] }, /disposition\.kind/))
  ok('accepts a fully populated finding', validateRecord(mk({ findings: [{ id: 'F1', severity: 'P1', summary: 's', file: 'a/b.js', line: 3, disposition: { kind: 'fixed', by: 'z' } }] })).length === 0)
  ok('rejects a non-string, non-null supersedes', bad({ supersedes: 3 }, /supersedes/))
  ok('rejects a missing supersedes', bad({ supersedes: undefined }, /supersedes/))
  ok('accepts a string supersedes', validateRecord(mk({ supersedes: 'a--b--1' })).length === 0)
  ok('rejects a createdAt that is not ISO', bad({ createdAt: 'yesterday' }, /createdAt/))
  ok('rejects a missing createdAt', bad({ createdAt: undefined }, /createdAt/))
  const conf = { tasks: ['T1'], deviations: ['D1'], commands: [{ cmd: 'npm test', exit: 0 }] }
  ok('accepts a conformance block', validateRecord(mk({ type: 'conformance', slot: 'conformance', conformance: conf })).length === 0)
  ok('rejects a malformed conformance block', bad({ conformance: { tasks: 'x', deviations: [], commands: [{ cmd: 1, exit: 'a' }] } }, /conformance/))
  ok('rejects a non-object record', validateRecord(null).length > 0 && validateRecord([]).length > 0 && validateRecord('x').length > 0)
} finally {
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
