// A small SQL lexer: splits text into code, comments, string literals and quoted identifiers, so a
// check can look at one kind without being fooled by another (a `--` inside a literal or an
// identifier, an apostrophe inside a comment, `begin;` inside a string).
//
// Segment kinds:
//   code     everything else
//   comment  `--` to the end of the line, or /* ... */ (which nests)
//   string   '...' ('' escapes a quote; after a standalone E, \ escapes the next character)
//   dollar   $$...$$ or $tag$...$tag$; `body` is the text between the tags
//   ident    "..." ("" escapes a quote)
// An unterminated literal, identifier or comment runs to the end of the text.
const TAG = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y

function skipBlockComment(sql, i) {
  let depth = 0
  while (i < sql.length) {
    if (sql.startsWith('/*', i)) { depth++; i += 2 } else if (sql.startsWith('*/', i)) { depth--; i += 2; if (!depth) return i } else i++
  }
  return i
}

// End (exclusive) of a quoted run starting at i, where a doubled quote is an escaped one.
function skipQuoted(sql, i, q, backslash) {
  let j = i + 1
  while (j < sql.length) {
    if (backslash && sql[j] === '\\') { j += 2; continue }
    if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue } return j + 1 }
    j++
  }
  return sql.length
}

export function sqlSegments(sql) {
  const out = []
  let code = 0 // start of the pending code run
  const flush = (i) => { if (i > code) out.push({ kind: 'code', text: sql.slice(code, i) }) }
  let i = 0
  while (i < sql.length) {
    let end = -1, seg = null
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i)
      end = nl < 0 ? sql.length : nl
      seg = { kind: 'comment' }
    } else if (sql.startsWith('/*', i)) {
      end = skipBlockComment(sql, i)
      seg = { kind: 'comment' }
    } else if (sql[i] === "'") {
      const escapes = /[Ee]/.test(sql[i - 1] ?? '') && !/[A-Za-z0-9_$]/.test(sql[i - 2] ?? '')
      end = skipQuoted(sql, i, "'", escapes)
      seg = { kind: 'string' }
    } else if (sql[i] === '"') {
      end = skipQuoted(sql, i, '"', false)
      seg = { kind: 'ident' }
    } else if (sql[i] === '$' && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
      TAG.lastIndex = i
      const m = TAG.exec(sql)
      const close = m ? sql.indexOf(m[0], i + m[0].length) : -1
      if (m) {
        end = close < 0 ? sql.length : close + m[0].length
        seg = { kind: 'dollar', body: sql.slice(i + m[0].length, close < 0 ? sql.length : close) }
      }
    }
    if (seg) {
      flush(i)
      out.push({ ...seg, text: sql.slice(i, end) })
      i = end
      code = i
    } else i++
  }
  flush(sql.length)
  return out
}

// The text with every comment, literal and quoted identifier replaced by a single space or `_`, so
// what is left is only the statements' keywords, names and punctuation.
export const codeOnly = (sql) => sqlSegments(sql).map((s) => (s.kind === 'code' ? s.text : s.kind === 'comment' ? ' ' : ' _ ')).join('')
