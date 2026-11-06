// Self-test for scripts/review/adapters/*.mjs. Never spawns a real reviewer or makes a network call:
// every run injects spawnImpl / fetchImpl.
// Run: node scripts/review/adapters/adapters.test.mjs
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
// a timeout aborts the request
{
  const r = await gemini.run({ prompt: 'p', timeoutMs: 30, env: { GEMINI_API_KEY: KEY }, fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) })
  ok('gemini: a timeout aborts and reports timedOut', r.timedOut === true && classifyOutcome(r).outcome === 'timeout')
}
ok('gemini: parseSse folds text and the last finish reason', (() => { const p = gemini.parseSse(streamStop); return p.text === innerJson && p.finish === 'STOP' })())

console.log(`${counter.pass} passed, ${counter.fail} failed`)
process.exit(counter.fail ? 1 : 0)
