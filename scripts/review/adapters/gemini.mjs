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

export const run = async ({ prompt, timeoutMs, fetchImpl = globalThis.fetch, env = process.env, diffBytes, model = DEFAULT_MODEL }) => {
  const key = env.GEMINI_API_KEY
  const redact = (s) => (key ? String(s).split(key).join('[redacted]') : String(s))
  const result = (o) => ({ exitCode: 1, truncated: false, timedOut: false, ...o, stdout: redact(o.stdout ?? ''), stderr: redact(o.stderr ?? '') })
  if (!key) return result({ exitCode: 2, stderr: 'GEMINI_API_KEY is not set; export it (it is never logged)' })
  const size = diffBytes ?? Buffer.byteLength(prompt, 'utf8')
  if (size > MAX_DIFF_BYTES) return result({ exitCode: 2, stderr: `diff is ${size} bytes, over the ${MAX_DIFF_BYTES} cap - review it in parts` })

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
      return result({ timedOut, stderr: `gemini request failed: ${e && e.message}` })
    }
    let text
    try { text = await res.text() } catch (e) {
      return result({ timedOut, stderr: `gemini stream dropped: ${e && e.message}` })
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
