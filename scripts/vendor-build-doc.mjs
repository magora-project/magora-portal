// Vendors BUILD.md from magora-acoustic-biodiversity into this repo at build time.
//
// THE RULE THIS ENFORCES: the build guide has exactly one author-time home — BUILD.md in the
// firmware repo, next to the firmware it describes. The portal renders that file; it never keeps
// its own copy. A hand-maintained second copy of the parts list is the failure mode this exists to
// prevent (edit a price in one place, the other silently rots).
//
// WHY BUILD TIME, NOT RUNTIME: fetching on page load would make the Add Node page depend on
// GitHub being reachable and fast for every visitor, and would version the content independently
// of the deploy. Vendoring bakes it in, so a deploy is reproducible and the page has no runtime
// network dependency.
//
// WHY `release`, NOT `main` AND NOT A FROZEN SHA (decided 2026-08-04):
//   * Bare `main` couples every unverified commit to a stranger's first-boot experience, and makes
//     "the guide said X" unreproducible once main moves.
//   * A hardcoded SHA is the opposite failure — it rots silently, and a price edit never reaches
//     the page, which is the drift this whole mechanism exists to prevent.
// `release` is a pointer that ONLY ADVANCES AFTER THE WALKTHROUGH IS RE-VERIFIED AGAINST IT, so the
// page is both reproducible and fresh: editing BUILD.md still takes exactly one edit, and it reaches
// builders when someone has confirmed the guide still works. Advancing it is a deliberate act —
// see docs/tasks/release-pointer-runbook.md.
// BUILD_DOC_REF overrides for a reproducible historical build.
//
// FAILURE BEHAVIOUR: if the fetch fails, the previously committed artifact is left in place and the
// build continues with a warning. A network blip should not break a deploy, and the committed copy
// is never more than one deploy stale.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { marked } from 'marked'

const REF = process.env.BUILD_DOC_REF || 'release'
const SOURCE = `https://raw.githubusercontent.com/magora-project/magora-acoustic-biodiversity/${REF}/BUILD.md`

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'src', 'generated', 'build-doc.js')

// Rewrite repo-relative links so they resolve on GitHub rather than 404ing on the portal.
function absolutize(markdown) {
  const base = `https://github.com/magora-project/magora-acoustic-biodiversity/blob/${REF}/`
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, (_, href) => `](${base}${href})`)
}

async function main() {
  let markdown
  try {
    const res = await fetch(SOURCE)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    markdown = await res.text()
    if (!markdown.trim()) throw new Error('empty response')
  } catch (err) {
    if (fs.existsSync(OUT)) {
      console.warn(`[vendor-build-doc] fetch failed (${err.message}) — keeping the committed copy.`)
      return
    }
    console.error(`[vendor-build-doc] fetch failed (${err.message}) and no committed copy exists.`)
    process.exit(1)
  }

  // Wrap tables so a wide shopping list scrolls inside its own box instead of forcing the whole
  // page to scroll sideways on a phone.
  const html = marked
    .parse(absolutize(markdown), { gfm: true, breaks: false })
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>')

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(
    OUT,
    `// GENERATED FILE — do not edit.\n` +
      `// Source: BUILD.md in magora-acoustic-biodiversity @ ${REF}\n` +
      `// Regenerate with: npm run vendor:build-doc\n` +
      `// Edit the guide there, not here.\n\n` +
      `export const buildDocRef = ${JSON.stringify(REF)}\n` +
      `export const buildDocSource = ${JSON.stringify(
        `https://github.com/magora-project/magora-acoustic-biodiversity/blob/${REF}/BUILD.md`,
      )}\n` +
      `export const buildDocHtml = ${JSON.stringify(html)}\n`,
    'utf8',
  )

  console.log(`[vendor-build-doc] vendored BUILD.md @ ${REF} (${markdown.length} chars)`)
}

main()
