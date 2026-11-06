// Gemini reviewer adapter: a Node port of scripts/review/gemini_review.py's request (same streaming endpoint,
// same body, the key in the x-goog-api-key header). As in the Python, only a stream whose final finishReason is
// STOP can complete: MAX_TOKENS is truncated; no finish reason, a dropped stream, a non-2xx response or any
// other reason is a failure, whatever text arrived. One attempt: the Python's RULES_STEPS ladder retries a
// shrinking rules payload, and this prompt has none.
//
// GEMINI_API_KEY comes from env and is never placed in the URL; every message this adapter returns passes
// through redact(), so a transport or server error that quotes the key cannot carry it out.
export const vendor = 'google'
export const DEFAULT_MODEL = 'gemini-3.1-pro-preview'
export const MAX_DIFF_BYTES = 400_000

// The default transport. Not globalThis.fetch: undici's fetch fails with UND_ERR_HEADERS_TIMEOUT when no
// response headers arrive within 300 s, and Gemini's streaming endpoint sends none until it has read the
// prompt; PR B's 267 KB diff failed at exactly 300 s twice (2026-11-06). Node exposes no knob for that
// without the undici package, and this repo adds no dependencies. node:http(s) has no such timeout, so only
// the caller's timeoutMs (via signal) bounds the request. It returns the small part of Response that run()
// uses: ok, status and text().
export const nodeFetch = async (url, { method = 'GET', headers = {}, body, signal } = {}) => {
  const u = new URL(url)
  const { request } = await import(u.protocol === 'http:' ? 'node:http' : 'node:https')
  const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const req = request(u, { method, headers })
    const onAbort = () => req.destroy(abortError())
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(e) })
    req.on('response', (res) => {
      const done = new Promise((ok, fail) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => { signal?.removeEventListener('abort', onAbort); res.complete ? ok(Buffer.concat(chunks).toString('utf8')) : fail(new Error('the response ended before it was complete')) })
        res.on('aborted', () => fail(new Error('the response was aborted mid-stream')))
        res.on('error', fail)
        req.on('error', fail)
      })
      done.catch(() => {}) // observed by text(); never an unhandled rejection
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: () => done })
    })
    req.end(body)
  })
}
export const defaultFetch = nodeFetch

export const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`

export const parseSse = (text) => {
  const chunks = []
  let finish = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (!payload || payload === '[DONE]') continue
    let event
    try { event = JSON.parse(payload) } catch { continue }
    for (const cand of (event && event.candidates) || []) {
      finish = (cand && cand.finishReason) || finish
      for (const part of (cand && cand.content && cand.content.parts) || []) if (typeof part.text === 'string') chunks.push(part.text)
    }
  }
  return { text: chunks.join(''), finish }
}

// Node's fetch reports every transport failure as "fetch failed" (or "terminated") and puts the reason in
// e.cause, e.g. UND_ERR_HEADERS_TIMEOUT. Name it, or a timeout and a refused connection read the same.
// The caller's result() redacts the whole message, cause included.
const describe = (e) => {
  const base = (e && e.message) || String(e)
  const c = e && e.cause
  if (!c) return base
  return `${base} (cause: ${[c.code, c.message].filter(Boolean).join(' ') || String(c)})`
}

export const run = async ({ prompt, timeoutMs, fetchImpl = defaultFetch, env = process.env, diffBytes, model = DEFAULT_MODEL }) => {
  const key = env.GEMINI_API_KEY
  const redact = (s) => (key ? String(s).split(key).join('[redacted]') : String(s))
  const result = (o) => ({ exitCode: 1, truncated: false, timedOut: false, ...o, stdout: redact(o.stdout ?? ''), stderr: redact(o.stderr ?? '') })
  if (!key) return result({ exitCode: 2, stderr: 'GEMINI_API_KEY is not set; export it (it is never logged)' })
  const size = diffBytes ?? Buffer.byteLength(prompt, 'utf8')
  if (size > MAX_DIFF_BYTES) return result({ exitCode: 2, stderr: `review input (diff plus any promise context) is ${size} bytes, over the ${MAX_DIFF_BYTES} cap - review it in parts` })

  const ac = new AbortController()
  let timedOut = false
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ac.abort() }, timeoutMs) : null
  try {
    let res
    try {
      res = await fetchImpl(endpoint(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }),
        signal: ac.signal,
      })
    } catch (e) {
      return result({ timedOut, stderr: `gemini request failed: ${describe(e)}` })
    }
    let text
    try { text = await res.text() } catch (e) {
      return result({ timedOut, stderr: `gemini stream dropped: ${describe(e)}` })
    }
    if (!res.ok) return result({ timedOut, stderr: `gemini HTTP ${res.status}: ${text.slice(0, 300)}` })
    const { text: answer, finish } = parseSse(text)
    if (finish === 'STOP') return result({ exitCode: 0, stdout: answer, timedOut })
    if (finish === 'MAX_TOKENS') return result({ exitCode: 0, stdout: answer, truncated: true, timedOut, stderr: 'gemini stopped at MAX_TOKENS' })
    const why = finish === null ? 'the stream closed before reporting a finish reason' : `finishReason is ${finish}`
    return result({ timedOut, stderr: `gemini answer incomplete: ${why}` })
  } finally {
    clearTimeout(timer)
  }
}
