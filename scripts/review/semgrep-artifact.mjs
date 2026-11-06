// Semgrep over the code blocks of a spec or plan (spec spec §5.4): `ran: false` is UNRUN and is never a pass.
//
//   node scripts/review/semgrep-artifact.mjs <markdown-file>
//   exit 0: ran, no findings   1: ran, findings   2: UNRUN (reason printed)   64: usage
//
// A block's `line` is the 1-based line of its OPENING fence; a finding on code line N of the block is reported at
// Markdown line `block.line + N` (code line 1 sits on the line after the fence).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = {
  js: 'js', javascript: 'js', mjs: 'mjs', cjs: 'cjs', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx',
  json: 'json', yaml: 'yaml', yml: 'yml', py: 'py', python: 'py', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
  sql: 'sql', html: 'html', css: 'css', go: 'go', rb: 'rb', ruby: 'rb', java: 'java', rs: 'rs', rust: 'rs',
  swift: 'swift', php: 'php', c: 'c', cpp: 'cpp', dockerfile: 'Dockerfile', tf: 'tf', toml: 'toml',
}
export const INSTALL_HINT = 'semgrep is not installed: pipx install semgrep (or brew install semgrep)'

// CommonMark fences: up to 3 spaces of indent, 3+ backticks or tildes, closed by the same char at least as long.
export const extractBlocks = (markdown) => {
  const lines = String(markdown).split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/.exec(lines[i])
    if (!open) continue
    const ch = open[1][0], len = open[1].length
    const close = new RegExp(`^ {0,3}\\${ch}{${len},}\\s*$`)
    const body = []
    let j = i + 1
    while (j < lines.length && !close.test(lines[j])) body.push(lines[j++])
    blocks.push({ lang: open[2].toLowerCase(), code: body.length ? `${body.join('\n')}\n` : '', line: i + 1 })
    i = j
  }
  return blocks
}

const unrun = (reason) => ({ ran: false, findings: [], reason })

export const scanArtifact = ({ path, spawnImpl = spawnSync }) => {
  let text
  try { text = readFileSync(path, 'utf8') } catch (e) { return unrun(`cannot read ${path}: ${e.message}`) }
  const blocks = extractBlocks(text)
  if (blocks.length === 0) return unrun('no code blocks')
  const scannable = blocks.map((b, i) => ({ ...b, file: EXT[b.lang] ? `block-${i + 1}.${EXT[b.lang]}` : null })).filter((b) => b.file)
  if (scannable.length === 0) return unrun('no scannable code blocks')

  const dir = mkdtempSync(join(tmpdir(), 'semgrep-artifact-'))
  try {
    for (const b of scannable) writeFileSync(join(dir, b.file), b.code)
    const r = spawnImpl('semgrep', ['scan', '--config', 'p/default', '--json', '--metrics=off', dir], { encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 })
    if (r.error) return unrun(r.error.code === 'ENOENT' ? INSTALL_HINT : `semgrep failed to start: ${r.error.message}`)
    if (r.status !== 0 && r.status !== 1) return unrun(`semgrep exited ${r.status === null ? `on signal ${r.signal ?? 'unknown'}` : r.status}: ${String(r.stderr ?? '').trim().slice(0, 300)}`)
    let out
    try { out = JSON.parse(String(r.stdout ?? '')) } catch { return unrun('semgrep output was not JSON') }
    if (!out || !Array.isArray(out.results)) return unrun('semgrep output had no results array')
    if (r.status === 1 && out.results.length === 0) return unrun('semgrep exited 1 but reported no findings')
    const byFile = new Map(scannable.map((b) => [b.file, b]))
    const findings = out.results.map((f) => {
      const b = byFile.get(basename(String(f.path ?? '')))
      return {
        checkId: f.check_id, severity: f.extra?.severity, message: f.extra?.message,
        line: b ? b.line + (f.start?.line ?? 0) : null, block: b ? b.line : null,
      }
    })
    return { ran: true, findings }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Exit codes: 0 clean, 1 findings, 2 UNRUN, 64 usage.
export const main = (argv, { spawnImpl, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) => {
  if (argv.length !== 1) { err('usage: node scripts/review/semgrep-artifact.mjs <markdown-file>\n'); return 64 }
  const r = scanArtifact({ path: argv[0], spawnImpl })
  if (!r.ran) { out(`UNRUN: ${r.reason}\n`); return 2 }
  for (const f of r.findings) out(`${argv[0]}:${f.line ?? '?'}: ${f.severity ?? ''} ${f.checkId}: ${f.message ?? ''}\n`)
  out(r.findings.length ? `${r.findings.length} finding(s)\n` : 'ran: no findings\n')
  return r.findings.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
