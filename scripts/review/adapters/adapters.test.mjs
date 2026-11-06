// Self-test for scripts/review/adapters/*.mjs. Never spawns a real reviewer or makes a network call:
// every reviewer run injects spawnImpl / fetchImpl. Only the spawnCollect pipe tests spawn real `node` children.
// Run: node scripts/review/adapters/adapters.test.mjs
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { PassThrough } from 'node:stream'

const codex = await import('./codex.mjs')
const claude = await import('./claude.mjs')
const gemini = await import('./gemini.mjs')
const { classifyOutcome } = await import('../runner.mjs')

const mkOk = (counter, log = console.log) => (n, c) => {
  if (c && typeof c.then === 'function') { counter.fail++; log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { counter.pass++ } else { counter.fail++; log('  FAIL', n) }
}
const counter = { pass: 0, fail: 0 }
const ok = mkOk(counter)
{
  const sub = { pass: 0, fail: 0 }
  const subOk = mkOk(sub, () => {})
  subOk('x', Promise.resolve(false))
  ok('ok() counts a Promise as a failure', sub.fail === 1 && sub.pass === 0)
}

const fakeChild = ({ respond, hang = false }) => {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
  const chunks = []
  child.killCalls = 0
  const close = (code, signal) => setImmediate(() => setImmediate(() => child.emit('close', code, signal)))
  child.kill = () => { child.killCalls++; child.stdout.end(); child.stderr.end(); close(null, 'SIGTERM'); return true }
  child.stdin.on('data', (d) => chunks.push(Buffer.from(d)))
  child.stdin.on('finish', () => {
    const r = respond(Buffer.concat(chunks).toString('utf8'))
    if (hang) return
    child.stdout.end(r.stdout ?? ''); child.stderr.end(r.stderr ?? '')
    close(r.code ?? 0, null)
  })
  return child
}

const innerJson = JSON.stringify({ verdict: 'pass', findings: [], inherited: [] })
const envelopeOk = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: innerJson })
const envelopeError = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' })

// --- vendors ---
ok('adapters name their vendors', codex.vendor === 'openai' && claude.vendor === 'anthropic' && gemini.vendor === 'google')
ok('gemini DEFAULT_MODEL matches the Python', gemini.DEFAULT_MODEL === 'gemini-3.1-pro-preview' && readFileSync(new URL('../gemini_review.py', import.meta.url), 'utf8').includes(`DEFAULT_MODEL = "${gemini.DEFAULT_MODEL}"`))

// --- claude ---
const claudeCalls = []
const claudeRun = (stdout, extra = {}) => claude.run({ prompt: 'PROMPT', timeoutMs: 10_000, ...extra, spawnImpl: (cmd, argv, opts) => { claudeCalls.push({ cmd, argv, opts }); return fakeChild({ respond: (input) => { claudeCalls.at(-1).input = input; return { stdout } } }) } })
ok('claude adapter unwraps .result and maps is_error to exit 1', (await claudeRun(envelopeError)).exitCode === 1 && (await claudeRun(envelopeOk)).stdout === innerJson)
ok('claude: a successful envelope exits 0', (await claudeRun(envelopeOk)).exitCode === 0)
ok('claude: an unparseable envelope is a failure, not a pass', (await claudeRun('not json')).exitCode === 1)
ok('claude: an envelope whose result is not a string is a failure', (await claudeRun(JSON.stringify({ is_error: false, result: 3 }))).exitCode === 1)
ok('claude: a verbose array envelope uses its result entry', (await claudeRun(JSON.stringify([{ type: 'system' }, JSON.parse(envelopeOk)]))).stdout === innerJson)
{
  const last = claudeCalls.at(-1)
  ok('claude: -p --model opus --output-format json, prompt on stdin, shell:false', last.cmd === 'claude' && last.argv.join(' ') === '-p --model opus --output-format json' && last.input === 'PROMPT' && last.opts.shell === false)
  await claudeRun(envelopeOk, { model: 'fable' })
  ok('claude: --model is overridable to fable', claudeCalls.at(-1).argv.join(' ') === '-p --model fable --output-format json')
}

// --- codex ---
const promptMarker = 'PROMPT-MARKER-7f3a'
let spawnArgs
const codexRes = await codex.run({
  prompt: `review this ${promptMarker}`, timeoutMs: 10_000,
  spawnImpl: (cmd, argv, opts) => {
    spawnArgs = { cmd, argv, opts }
    return fakeChild({ respond: (input) => { spawnArgs.input = input; writeFileSync(argv[argv.indexOf('-o') + 1], innerJson); return { stdout: 'progress chatter' } } })
  },
})
ok('codex: spawned with shell:false and the prompt on stdin, not argv', typeof spawnArgs.argv.join(' ') === 'string' && spawnArgs.argv.length > 0 && spawnArgs.input.includes(promptMarker) && spawnArgs.opts.shell === false && !spawnArgs.argv.join(' ').includes(promptMarker))
const oFile = spawnArgs.argv[spawnArgs.argv.indexOf('-o') + 1]
const schemaArg = spawnArgs.argv[spawnArgs.argv.indexOf('--output-schema') + 1]
ok('codex: exec --sandbox read-only --output-schema <abs schema> -o <tmp> -', spawnArgs.cmd === 'codex' && spawnArgs.argv[0] === 'exec' && spawnArgs.argv.join(' ').includes('--sandbox read-only') && spawnArgs.argv.at(-1) === '-' && isAbsolute(schemaArg) && existsSync(schemaArg) && schemaArg.endsWith('verdict.schema.json'))
ok('codex: the -o file is read as stdout and then deleted', codexRes.stdout === innerJson && codexRes.exitCode === 0 && existsSync(oFile) === false)
const noOut = await codex.run({ prompt: 'p', timeoutMs: 10_000, spawnImpl: () => fakeChild({ respond: () => ({ stdout: 'x', code: 0 }) }) })
ok('codex: no -o file -> empty stdout (refused downstream)', noOut.stdout === '' && classifyOutcome(noOut).outcome === 'refused')
const schema = JSON.parse(readFileSync(schemaArg, 'utf8'))
ok('verdict.schema.json requires verdict, findings and inherited', ['verdict', 'findings', 'inherited'].every((k) => schema.required.includes(k)) && schema.properties.verdict.enum.join() === 'pass,fail' && schema.properties.inherited.items.properties.status.enum.join() === 'resolved,open')

// --- child env: GEMINI_API_KEY never reaches codex or claude; claude runs with the lane-threshold hook off ---
{
  const given = { GEMINI_API_KEY: 'KEY-XYZ', PATH: '/some/bin', OTHER: '1' }
  const envOf = async (adapter, env) => {
    let seenEnv
    await adapter.run({ prompt: 'p', timeoutMs: 10_000, env, spawnImpl: (cmd, argv, opts) => { seenEnv = opts.env; return fakeChild({ respond: () => { const i = argv.indexOf('-o'); if (i >= 0) writeFileSync(argv[i + 1], innerJson); return { stdout: envelopeOk } } }) } })
    return seenEnv
  }
  const ce = await envOf(claude, given)
  ok('claude child env: no GEMINI_API_KEY, the rest kept', ce !== undefined && !('GEMINI_API_KEY' in ce) && ce.PATH === '/some/bin' && ce.OTHER === '1')
  ok('claude child env: LANE_THRESHOLD_DISABLE=1 (the variable .claude/hooks/lane-threshold.mjs reads)', ce !== undefined && ce.LANE_THRESHOLD_DISABLE === '1')
  const xe = await envOf(codex, given)
  ok('codex child env: no GEMINI_API_KEY, the rest kept', xe !== undefined && !('GEMINI_API_KEY' in xe) && xe.PATH === '/some/bin')
  ok('the caller\'s env object is not mutated', given.GEMINI_API_KEY === 'KEY-XYZ' && !('LANE_THRESHOLD_DISABLE' in given))
  const prev = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'PROC-KEY'
  let ce2, xe2
  try { ce2 = await envOf(claude, undefined); xe2 = await envOf(codex, undefined) } finally { if (prev === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prev }
  // Windows: process.env ignores case, a copy does not, so PATH may be spelled `Path` there. Compare by the real key.
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH')
  ok('with no env given, the children get process.env minus GEMINI_API_KEY', ce2 !== undefined && xe2 !== undefined && !('GEMINI_API_KEY' in ce2) && !('GEMINI_API_KEY' in xe2) && pathKey !== undefined && ce2[pathKey] === process.env[pathKey])
  // Windows env names ignore case, so a child would read `gemini_api_key` as GEMINI_API_KEY: strip every spelling.
  const mixed = await envOf(codex, { PATH: '/b', gemini_api_key: 'k1', Gemini_Api_Key: 'k2' })
  ok('a GEMINI_API_KEY in any letter case is removed', mixed !== undefined && !Object.keys(mixed).some((k) => k.toUpperCase() === 'GEMINI_API_KEY') && mixed.PATH === '/b')
  const hookSrc = readFileSync(new URL('../../../.claude/hooks/lane-threshold.mjs', import.meta.url), 'utf8')
  ok('the hook really honours LANE_THRESHOLD_DISABLE === \'1\'', hookSrc.includes("env.LANE_THRESHOLD_DISABLE === '1'"))
}

// --- timeout kills the child ---
{
  let child
  const r = await codex.run({ prompt: 'p', timeoutMs: 30, spawnImpl: () => { child = fakeChild({ respond: () => ({}), hang: true }); return child } })
  ok('a timeout kills the child and reports timedOut', r.timedOut === true && child.killCalls >= 1 && classifyOutcome(r).outcome === 'timeout')
}
// --- a missing binary names the install ---
{
  const r = await claude.run({ prompt: 'p', timeoutMs: 1000, spawnImpl: () => { const ch = new EventEmitter(); ch.stdout = new PassThrough(); ch.stderr = new PassThrough(); ch.stdin = new PassThrough(); setImmediate(() => ch.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))); return ch } })
  ok('a spawn error is a failure naming the install', r.exitCode !== 0 && /npm i -g @anthropic-ai\/claude-code/.test(r.stderr) && classifyOutcome(r).outcome === 'failed')
}

// --- Windows shim resolution (pure; injected where/readFile) ---
{
  const shim = 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'
  const text = '@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n'
  const r = codex.resolveCommand('codex', { install: 'npm i -g @openai/codex', platform: 'win32', execPath: 'C:\\node\\node.exe', whereImpl: () => `${shim}\r\n`, readFileImpl: () => text })
  ok('windows: a .cmd shim resolves to node + its target script', r.cmd === 'C:\\node\\node.exe' && r.args.length === 1 && r.args[0] === 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js')
  const old = codex.resolveCommand('codex', { install: 'x', platform: 'win32', execPath: 'n.exe', whereImpl: () => shim, readFileImpl: () => '"%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*' })
  ok('windows: an older %~dp0 shim resolves too', old.args[0].endsWith('\\node_modules\\@openai\\codex\\bin\\codex.js'))
  const exe = codex.resolveCommand('codex', { install: 'x', platform: 'win32', whereImpl: () => 'C:\\bin\\codex.exe\r\n' })
  ok('windows: a native .exe is spawned directly', exe.cmd === 'C:\\bin\\codex.exe' && exe.args.length === 0)
  let msg = ''
  try { codex.resolveCommand('codex', { install: 'npm i -g @openai/codex', platform: 'win32', whereImpl: () => shim, readFileImpl: () => 'garbage' }) } catch (e) { msg = e.message }
  ok('windows: an unresolvable shim fails naming the install', /npm i -g @openai\/codex/.test(msg))
  msg = ''
  try { codex.resolveCommand('codex', { install: 'npm i -g @openai/codex', platform: 'win32', whereImpl: () => '' }) } catch (e) { msg = e.message }
  ok('windows: nothing on PATH fails naming the install', /npm i -g @openai\/codex/.test(msg))
  ok('non-windows: the bare name', codex.resolveCommand('codex', { platform: 'darwin' }).cmd === 'codex')
}

// --- gemini ---
const sse = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
const ev = (text, finishReason) => ({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] })
const fetchCalls = []
const fetchWith = (body, status = 200) => async (url, init) => { fetchCalls.push({ url, init }); return typeof body === 'function' ? body() : new Response(body, { status }) }
const KEY = 'KEY123'
const gRun = (fetchImpl, extra = {}) => gemini.run({ prompt: 'PROMPT', timeoutMs: 10_000, env: { GEMINI_API_KEY: KEY }, fetchImpl, ...extra })
const geminiOutcome = async (body, status) => classifyOutcome(await gRun(fetchWith(body, status))).outcome

const streamStop = sse(ev(innerJson.slice(0, 10)), ev(innerJson.slice(10), 'STOP'))
const streamNoFinish = sse(ev(innerJson))
const streamSafety = sse(ev(innerJson, 'SAFETY'))
const streamMaxTokens = sse(ev(innerJson, 'MAX_TOKENS'))

ok('gemini: a STOP stream completes with the joined text', (await geminiOutcome(streamStop)) === 'completed' && (await gRun(fetchWith(streamStop))).stdout === innerJson)
ok('gemini: valid verdict JSON in a stream with no finish reason -> failed', (await geminiOutcome(streamNoFinish)) === 'failed')
ok('gemini: finishReason SAFETY -> failed', (await geminiOutcome(streamSafety)) === 'failed')
ok('gemini: MAX_TOKENS -> truncated', (await geminiOutcome(streamMaxTokens)) === 'truncated')
ok('gemini: a non-2xx response -> failed', (await geminiOutcome(streamStop, 500)) === 'failed')
ok('gemini: a dropped stream -> failed', (await geminiOutcome(() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse(ev(innerJson)))); c.error(new Error('socket hang up')) } })))) === 'failed')

fetchCalls.length = 0
await gRun(fetchWith(streamStop))
{
  const call = fetchCalls[0]
  const body = JSON.parse(call.init.body)
  ok('gemini: the Python endpoint, key in the x-goog-api-key header and never in the URL', call.url === `https://generativelanguage.googleapis.com/v1beta/models/${gemini.DEFAULT_MODEL}:streamGenerateContent?alt=sse` && call.init.headers['x-goog-api-key'] === KEY && !call.url.includes(KEY))
  ok('gemini: the Python request body', call.init.method === 'POST' && body.contents[0].parts[0].text === 'PROMPT' && body.generationConfig.temperature === 0)
}

fetchCalls.length = 0
const over = await gRun(fetchWith(streamStop), { diffBytes: 400_001 })
ok('gemini: a 400,001-byte diff makes no request', fetchCalls.length === 0)
ok('gemini: an over-cap diff is a failure naming the cap', over.exitCode !== 0 && /400000/.test(over.stderr) && classifyOutcome(over).outcome === 'failed')
await gRun(fetchWith(streamStop), { diffBytes: 400_000 })
ok('gemini: a diff of exactly 400,000 bytes is sent', fetchCalls.length === 1)
fetchCalls.length = 0
await gRun(fetchWith(streamStop), { prompt: 'é'.repeat(200_001) })
ok('gemini: without diffBytes the prompt is measured in UTF-8 bytes', fetchCalls.length === 0)

const noKey = await gemini.run({ prompt: 'p', timeoutMs: 1000, env: {}, fetchImpl: fetchWith(streamStop) })
ok('gemini: a missing key fails before any request', noKey.exitCode !== 0 && /GEMINI_API_KEY/.test(noKey.stderr))

// the key never appears, even when the transport or the server quotes it
{
  const outs = []
  outs.push(await gRun(async () => { throw new Error(`connect ECONNREFUSED https://x/?key=${KEY}`) }))
  outs.push(await gRun(fetchWith(`{"error":"bad key ${KEY}"}`, 400)))
  outs.push(await gRun(fetchWith(sse(ev(`echo ${KEY}`, 'SAFETY')))))
  outs.push(await gRun(fetchWith(() => new Response(new ReadableStream({ start(c) { c.error(new Error(`reset by ${KEY}`)) } })))))
  const all = outs.map((o) => `${o.stdout}\n${o.stderr}`).join('\n')
  ok('gemini: the error output under test is non-empty and quotes the causes', typeof all === 'string' && all.length > 0 && /ECONNREFUSED/.test(all) && /400/.test(all) && /reset by/.test(all))
  ok('gemini: the API key never appears in stdout or stderr', !all.includes('KEY123'))
}
// undici's generic "fetch failed" hides the reason in e.cause: report its code and message (redacted)
{
  const cause = Object.assign(new Error(`Headers Timeout Error for ${KEY}`), { code: 'UND_ERR_HEADERS_TIMEOUT' })
  const r = await gRun(async () => { throw new TypeError('fetch failed', { cause }) })
  ok('gemini: a transport failure reports the cause code and message', r.exitCode === 1 && /fetch failed/.test(r.stderr) && /UND_ERR_HEADERS_TIMEOUT/.test(r.stderr) && /Headers Timeout Error/.test(r.stderr))
  ok('gemini: the cause message is redacted too', typeof r.stderr === 'string' && r.stderr.length > 0 && r.stderr.includes(KEY) === false)
  const dropped = await gRun(fetchWith(() => new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })) } }))))
  ok('gemini: a dropped stream reports the cause code', /stream dropped/.test(dropped.stderr) && /UND_ERR_SOCKET/.test(dropped.stderr))
}
// a timeout aborts the request
{
  const r = await gemini.run({ prompt: 'p', timeoutMs: 30, env: { GEMINI_API_KEY: KEY }, fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) })
  ok('gemini: a timeout aborts and reports timedOut', r.timedOut === true && classifyOutcome(r).outcome === 'timeout')
}
ok('gemini: parseSse folds text and the last finish reason', (() => { const p = gemini.parseSse(streamStop); return p.text === innerJson && p.finish === 'STOP' })())

// The default transport is node:http(s), not globalThis.fetch: undici's fetch gives up after 300 s with no
// response headers (UND_ERR_HEADERS_TIMEOUT), and Gemini sends none until it has read a large diff. Measured
// 2026-11-06 on PR B's 267 KB diff: two runs failed at exactly 300 s. Only the caller's timeoutMs bounds it.
{
  const { createServer } = await import('node:http')
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen.push({ method: req.method, key: req.headers['x-goog-api-key'], body })
      if (req.url.startsWith('/slow')) setTimeout(() => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(streamStop) }, 300)
      else if (req.url.startsWith('/err')) { res.writeHead(500); res.end('boom') }
      else if (req.url.startsWith('/cut')) { res.writeHead(200); res.write('data: {"candidates":['); setTimeout(() => res.socket.destroy(), 20) }
      else if (req.url.startsWith('/hang')) { /* never answers */ }
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    ok('gemini: the default transport is nodeFetch, not globalThis.fetch', gemini.defaultFetch === gemini.nodeFetch && gemini.nodeFetch !== globalThis.fetch)
    const r = await gemini.nodeFetch(`${base}/slow`, { method: 'POST', headers: { 'x-goog-api-key': 'K', 'Content-Type': 'application/json' }, body: '{"a":1}' })
    const t = await r.text()
    ok('gemini nodeFetch: headers that arrive late still yield status, ok and the full body', r.status === 200 && r.ok === true && t === streamStop)
    ok('gemini nodeFetch: sends the method, the key header and the body', seen.length === 1 && seen[0].method === 'POST' && seen[0].key === 'K' && seen[0].body === '{"a":1}')
    const e = await gemini.nodeFetch(`${base}/err`, { method: 'POST', headers: {}, body: '' })
    ok('gemini nodeFetch: a 500 is ok:false with its body', e.ok === false && e.status === 500 && (await e.text()) === 'boom')
    const cut = await gemini.nodeFetch(`${base}/cut`, { method: 'POST', headers: {}, body: '' })
    ok('gemini nodeFetch: a body cut off mid-stream rejects text()', await cut.text().then(() => false, () => true))
    const ac = new AbortController()
    const hung = gemini.nodeFetch(`${base}/hang`, { method: 'POST', headers: {}, body: '', signal: ac.signal })
    setTimeout(() => ac.abort(), 30)
    ok('gemini nodeFetch: an abort rejects with an AbortError', await hung.then(() => false, (err) => err && err.name === 'AbortError'))
    const through = await gemini.run({ prompt: 'p', timeoutMs: 40, env: { GEMINI_API_KEY: KEY }, fetchImpl: (url, init) => gemini.nodeFetch(`${base}/hang`, init) })
    ok('gemini: run over nodeFetch times out through the caller timeout', through.timedOut === true && classifyOutcome(through).outcome === 'timeout')
  } finally {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  }
}

// --- a descendant holding the child's pipes cannot hold the result (Codex, mark-reviewed, PR #77) ---
// Real subprocesses: the child starts a grandchild that inherits stdout/stderr and lives GRAND_MS, so 'close'
// waits for the grandchild. The result must come once the child has exited (plus the drain), not at 'close'.
{
  const GRAND_MS = 6000
  const grand = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${GRAND_MS})'], { stdio: ['ignore', 'inherit', 'inherit'] })`
  const timed = async (args, timeoutMs) => { const t0 = Date.now(); const r = await codex.spawnCollect({ cmd: process.execPath, args, input: '', timeoutMs, install: 'x' }); return { r, ms: Date.now() - t0 } }
  const a = await timed(['-e', `${grand}; process.stdout.write('PARTIAL'); setInterval(() => {}, 1000)`], 300)
  ok(`a timed-out child whose grandchild holds the pipes resolves without waiting for the grandchild (${a.ms} ms)`, a.r.timedOut === true && a.ms < codex.DRAIN_MS && a.r.stdout.includes('PARTIAL') && classifyOutcome(a.r).outcome === 'timeout')
  const b = await timed(['-e', `${grand}; process.stdout.write('DONE'); process.exit(0)`], 60_000)
  ok(`a child that exits while its grandchild holds the pipes resolves after the drain (${b.ms} ms)`, b.r.timedOut === false && b.r.exitCode === 0 && b.ms < GRAND_MS - 2000 && b.r.stdout.includes('DONE'))
  // The caller's process must be free to exit too: the drained pipes are closed, not left referenced until the
  // grandchild lets go. The runner script below never calls process.exit.
  const codexUrl = new URL('./codex.mjs', import.meta.url).href
  const caller = `const { spawnCollect } = await import(${JSON.stringify(codexUrl)}); await spawnCollect({ cmd: process.execPath, args: ['-e', ${JSON.stringify(`${grand}; process.exit(0)`)}], input: '', timeoutMs: 60000, install: 'x' })`
  const t0 = Date.now()
  await new Promise((res) => { const c = spawn(process.execPath, ['--input-type=module', '-e', caller], { stdio: 'ignore' }); c.on('exit', res) })
  const callerMs = Date.now() - t0
  ok(`the calling process exits without waiting for the grandchild (${callerMs} ms)`, callerMs < GRAND_MS - 2000)
}

console.log(`${counter.pass} passed, ${counter.fail} failed`)
process.exit(counter.fail ? 1 : 0)
