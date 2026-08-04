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
// WHY `main` BY DEFAULT, NOT A HARDCODED SHA: pinning to a specific commit would mean editing a
// price in BUILD.md does NOT reach the page until someone also bumps a SHA here — which is a second
// edit, the exact drift this is meant to prevent. So the default tracks `main` and a deploy picks up
// whatever is current. Set BUILD_DOC_REF to a SHA or tag when you need a reproducible historical
// build. (This differs from DETECT_SHA in the firmware, which is pinned on purpose: shipping a
// stale paragraph is cosmetic, shipping stale firmware to someone's hardware is not.)
//
// FAILURE BEHAVIOUR: if the fetch fails, the previously committed artifact is left in place and the
// build continues with a warning. A network blip should not break a deploy, and the committed copy
// is never more than one deploy stale.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { marked } from 'marked'

const REF = process.env.BUILD_DOC_REF || 'main'
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
