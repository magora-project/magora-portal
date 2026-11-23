// Fixture answers for Google Fonts. handle({ url }) -> { status, headers, body } or null when the URL is not
// in the fixtures (the capture then fails the run).
//
// Why fixtures and not the live service: fonts.googleapis.com does not answer one stylesheet URL the same
// way every time. Measured 2026-11-21: about one request in twelve for the Big Shoulders stylesheet that
// src/index.css @imports came back pointing at `fonts.gstatic.com/l/font?kit=...` files instead of the
// usual `/s/bigshouldersdisplay/v24/*.woff2` ones. Those are different font binaries, and the headings they
// set rasterise differently, so two captures of one build differed. The responses below are the usual
// variant, saved once for the headless Chromium this harness pins (Google varies the CSS by user agent).
//
// css2-*.css are the two stylesheets the app links (index.html) and imports (src/index.css), byte for byte;
// the .woff2 files are every file those stylesheets name. The fonts are under the SIL Open Font License
// (OFL-*.txt). If the app starts asking for another font URL, the capture fails and names it; save the
// new response here.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts')

const STYLESHEETS = {
  '/css2?family=Big+Shoulders+Display:wght@700;900&family=Jost:wght@500;600;700&family=DM+Sans:wght@400;600;700&display=swap': 'css2-site.css',
  '/css2?family=Big+Shoulders+Display:wght@700;900&display=swap': 'css2-big-shoulders.css',
}

const CORS = { 'access-control-allow-origin': '*' }

export function handle({ url }) {
  const u = new URL(url)
  const key = u.pathname + u.search
  if (u.hostname === 'fonts.googleapis.com' && STYLESHEETS[key]) {
    return {
      status: 200, headers: { ...CORS, 'content-type': 'text/css; charset=utf-8' },
      body: fs.readFileSync(path.join(DIR, STYLESHEETS[key])),
    }
  }
  // /s/<family>/<version>/<file>.woff2 is saved as <family>_<version>_<file>.woff2.
  const m = u.hostname === 'fonts.gstatic.com' && !u.search && u.pathname.match(/^\/s\/([a-z0-9]+)\/(v\d+)\/([\w-]+\.woff2)$/)
  if (m) {
    const file = path.join(DIR, `${m[1]}_${m[2]}_${m[3]}`)
    if (fs.existsSync(file)) {
      return { status: 200, headers: { ...CORS, 'content-type': 'font/woff2' }, body: fs.readFileSync(file) }
    }
  }
  return null
}
