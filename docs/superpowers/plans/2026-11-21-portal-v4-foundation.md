# Portal v4 brand foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, with a fresh reviewer on each task by depth (`.claude/rules/process.md`, stage 6). Use superpowers:executing-plans only if the user explicitly asks for in-session execution; keep the per-task reviewer and name the departure in the PR description. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every colour and font of the current portal behind tokens with zero pixel change, add the v4 token set, fonts and mandala, and add the opt-in `?brand=v4` switch that picks whole page versions, without changing the site for anyone who has not opted in.

**Architecture:**
- `src/styles/tokens.css` holds one custom property per colour role. `:root` holds the current values, and `:root[data-brand="v4"]` holds the v4 values.
- `src/lib/brand.js` reads the switch, sets `data-brand` once before the first render, and writes the cookie only on an explicit choice.
- `<BrandPage current v4>` picks a page per route. With no v4 page yet, every route renders its current page in whichever tokens are active.

**Tech Stack:** React 19, Vite 8, `vite-plugin-pwa`, react-leaflet, `node:test`, and Playwright 1.64 (already a devDependency, so no PR here changes `package.json`).

**Spec:** `docs/superpowers/specs/2026-11-21-portal-v4-foundation-design.md` (on PR #116 until it merges; this plan's branch is stacked on it).

**PRs:** three, each squash-merged on its own. Each is labelled `subtle-correctness`, because the spec's header sets that depth for the whole change.

| PR | Tasks | Control files touched |
|---|---|---|
| 1. Tokens, zero pixel change (spec §4.2) | 1–6 | `scripts/ci/no-hex-literals.test.mjs`, `eslint.config.js` |
| 2. v4 tokens, fonts, mandala (§4.3, §4.4) | 7–10 | none |
| 3. The switch and the v4 shell (§4.1, §4.5, §4.6) | 11–14 | none |
| Later, when found | 15 | none |

## Global Constraints

- With no opt-in, the current site renders unchanged. The screenshot comparison passes for every route in §4.5 (spec §1, criterion 1). PRs 2 and 3 re-run it for the current brand.
- Routes: `/`, `/node/:id`, `/node/:id/report/:date`, `/species/:name`, `/journal/:handle`, `/add-node`, `/register`, `/about`, `/donate` (spec §4.5).
- Screenshots: 375 and 1280 widths, light mode, fixture network responses, never production. Pass: every pixel matches (spec §6).
- No `#[0-9a-fA-F]{6}` in a `.js`, `.jsx` or `.css` file under `src/` outside `src/styles/tokens.css`. Image assets are not scanned (spec §1, criterion 5; §6).
- Cookie: `magora_brand=<brand>`, path `/`, one year, `SameSite=Lax`. It is written only on an explicit choice, and the default is never persisted (spec §4.1).
- The brand is set once, before the first render. It does not change during a session without a reload (spec §4.1).
- No current page imports from `src/pages/v4/` or `src/components/v4/` (spec §4.5).
- The manifest, icons, `theme-color` and service worker are unchanged until launch. The one exception is `**/fonts/v4/**` in the precache `globIgnores` (spec D-4, §4.4).
- The screenshot base is always the PR's merge base with `origin/main`, never an older capture. Noah keeps merging UI work, so each PR's first task re-runs Task 1 Steps 5–6 to recapture `.visual/base`, and so does any rebase.
- No migration, `api/` route or Edge Function (spec §3).
- v4 is light only. No `prefers-color-scheme` rule is added (spec §4.3, §5).
- Previews and `vite dev` reach production Supabase. Nothing in this plan writes data, and the screenshot runs build with a fixture Supabase URL (AGENTS.md; spec §3).

## Review Focus

1. **A screenshot run reaches the network.** A request the fixtures do not cover must fail the run and name the URL. It must never be fetched live, and above all never from production Supabase or the production `/api`. Pinned in Task 1 (`classifyRequest`, and the capture fails on any `blocked` request).
2. **A flaky page passes or fails the comparison by chance.** Clocks, `Math.random`, animations, fonts still loading and map tiles all vary between runs. Before any head is judged, the base must compare equal to a second capture of itself. Pinned in Task 1, Step 6.
3. **A colour reaches something that cannot resolve `var()`.** Leaflet `pathOptions` become SVG attributes, and a `var(--…)` there renders as no colour at all. These go through `token()`, which is called at render time, never at module scope, because the brand and the stylesheet must already be in place. `token()` throws on an unknown name instead of returning `''`. Pinned in Task 2 (tests) and Task 5 (the map markers are in the screenshots).
4. **A state the routes do not show still changes.** The modals and prompts (AuthModal, ListenModal, ShareSheet, DonatePrompt, ProfileEditorModal, HandlePrompt) hold literals, but no route shows them on load. The capture covers them as named states. Pinned in Task 1 (`STATES`).
5. **An opted-in browser loses or leaks its choice.** These cases: a shared `?brand=v4` link must not opt in its recipient once the first visitor's URL has been cleaned; an invalid value (`?brand=V4`, `?brand=`) changes nothing; a current-brand visitor never downloads `/fonts/v4/`. Pinned in Task 11 (tests) and Task 1 (the capture fails on a `/fonts/v4/` request under the current brand).

---

## PR 1 — Tokens, with no visual change

Noah approved this PR's scope on 2026-11-21 (D-5). On 2026-11-21 there are 299 six-digit literals in 24 files under `src/`, measured at `5768975` with `git grep -Eo '#[0-9a-fA-F]{6}'` over `src/*.js`, `src/*.jsx` and `src/*.css`. The spec says 316 across 26. The guard in Task 6, not either count, is the acceptance test.

### Task 1: Screenshot comparison harness

**Files:**
- create: `scripts/visual/compare.mjs`
- create: `scripts/visual/compare.test.mjs`
- create: `scripts/visual/fixtures/supabase.mjs`
- create: `scripts/visual/fixtures/api.mjs`
- create: `scripts/visual/fixtures/tile.png` (a 256×256 tile in `#e8e2d5`, any PNG encoder)
- modify: `.gitignore` (add `.visual/`)
- modify: `eslint.config.js` (add `.visual` to `globalIgnores`)
- command: `node scripts/visual/compare.test.mjs`

**Interfaces:**
- Produces, in `compare.mjs`:
  - `FIXTURE_SUPABASE_URL = 'https://fixture.supabase.invalid'`
  - `ROUTES`: an array of `{ id, path }`. One entry per spec §4.5 route, with fixture params: `/node/fixture-node-1`, `/node/fixture-node-1/report/2026-11-20`, `/journal/fixture`, and a species present in the detections fixture.
  - `STATES`: an array of `{ id, path, signedIn, act(page) }`. The ids are `auth-modal` (click the navbar Sign in on `/`), `listen-modal` (click Listen on `/`), `share-sheet` (open share on the first DetectionCard on `/node/fixture-node-1`), `donate-prompt` (`page.clock.runFor(60000)` on `/about`), `account-menu` and `profile-editor` (signed in, open the account menu, then Edit profile), and `handle-prompt` (signed in, as a listener with no handle; trigger `promptHandleClaim` through the UI path that calls it).
  - `classifyRequest(url, serverOrigin) -> 'app' | 'api' | 'supabase' | 'font' | 'tile' | 'external-fixture' | 'blocked'`
  - CLI: `node scripts/visual/compare.mjs build (--rev <ref> | --here) --out <dir>`, then `capture --dist <dir> --out <dir> --brand current|v4`, then `diff <dirA> <dirB>`. Each exits 0 on success and 1 on failure. `--here` builds the current checkout, uncommitted changes included, with `npm run build -- --outDir <out>/dist --emptyOutDir` and the same fixture env.
  - **The current-brand check**, which later tasks name as `current-brand check <name>`: `build --here --out .visual/<name>`, then `capture --dist .visual/<name>/dist --out .visual/<name>/shots --brand current`, then `diff .visual/base/shots-a .visual/<name>/shots`. Expected: one `ok` line per capture file, and exit 0.

- [ ] **Step 1: Write the failing test** `scripts/visual/compare.test.mjs`:
  ```js
  test('production and unknown hosts are blocked', () => {
    assert.equal(classifyRequest('https://abcd.supabase.co/rest/v1/nodes', ORIGIN), 'blocked')
    assert.equal(classifyRequest('https://magora-portal.vercel.app/api/insight', ORIGIN), 'blocked')
    assert.equal(classifyRequest('https://example.com/x.js', ORIGIN), 'blocked')
  })
  test('fixture routes are classified', () => {
    assert.equal(classifyRequest(`${FIXTURE_SUPABASE_URL}/rest/v1/nodes?select=*`, ORIGIN), 'supabase')
    assert.equal(classifyRequest(`${ORIGIN}/api/insight`, ORIGIN), 'api')
    assert.equal(classifyRequest(`${ORIGIN}/assets/index.js`, ORIGIN), 'app')
    assert.equal(classifyRequest('https://fonts.gstatic.com/s/dmsans/v1/a.woff2', ORIGIN), 'font')
    assert.equal(classifyRequest('https://a.basemaps.cartocdn.com/light_all/3/1/2.png', ORIGIN), 'tile')
    assert.equal(classifyRequest('https://en.wikipedia.org/api/rest_v1/page/summary/X', ORIGIN), 'external-fixture')
  })
  test('ROUTES covers the nine spec routes at both widths', () => {
    assert.equal(ROUTES.length, 9)
    assert.deepEqual(WIDTHS, [375, 1280])
  })
  ```
  `ORIGIN = 'http://127.0.0.1:4173'`. Each tile host the app uses comes from the `TileLayer` URLs in `MapPage.jsx`, `SpeciesPage.jsx` and `JournalPage.jsx`. The external-fixture hosts are `en.wikipedia.org`, `api.gbif.org` and `api.inaturalist.org`.
- [ ] **Step 2: Run it** (`node scripts/visual/compare.test.mjs`). Expected: FAIL, module not found.
- [ ] **Step 3: Implement `compare.mjs`.**
  - `build`: `git worktree add --detach` at `<ref>`, in a fresh `fs.mkdtempSync(os.tmpdir() + '/magora-visual-')`. Then `npm ci`, then `npm run build` with `VITE_SUPABASE_URL=FIXTURE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY=fixture` in the child's env. Copy `dist` to `<out>/dist` and remove the worktree with `git worktree remove --force` on that path only.
  - `capture`: serve `<dist>` from a Node static server with an SPA fallback to `index.html`, on port 0. Use chromium with `reducedMotion: 'reduce'`, `deviceScaleFactor: 1`, `colorScheme: 'light'`, heights 812 at 375 wide and 800 at 1280 wide. Install the clock with `page.clock.install({ time: new Date('2026-11-20T12:00:00Z') })`. Replace `Math.random` with a seeded PRNG through `addInitScript`. Route every request through `classifyRequest`: fulfil `supabase` from `fixtures/supabase.mjs`, `api` and `external-fixture` from `fixtures/api.mjs`, and `tile` with `tile.png`. Let `font` and `app` through. Abort `blocked` and record it. For `--brand v4`, add the cookie `magora_brand=v4` to the context before the first navigation. Signed-in states seed `localStorage['sb-fixture-auth-token']` with a session that expires in 2099, for user `00000000-0000-4000-8000-000000000001`. Wait for `networkidle` and `document.fonts.ready`, then take a full-page screenshot with `animations: 'disabled'` to `<out>/<id>-<width>.png`.
  - The capture **fails** if any request was `blocked`, listing each URL. Under `--brand current` it also fails on any request whose path contains `/fonts/v4/`.
  - `diff`: the two directories must hold the same file names. A pair is equal if the bytes match. Otherwise, decode both PNGs in a chromium page canvas and count the differing pixels. Print one line per file (`ok` or `<n> px differ`). Exit 1 unless every pair is equal.
  - `fixtures/supabase.mjs` exports `handle({ method, url, headers }) -> { status, headers, body }`. Answer PostgREST `/rest/v1/<table>` by table name. An `Accept: application/vnd.pgrst.object+json` request gets one object; `Prefer: count=exact` gets a `content-range` header. Also answer `/auth/v1/user` and `/auth/v1/token`. An unknown table returns `[]`, and is listed in the capture log.
  - The fixtures must render every page in its populated state. That means one active node and one offline node; detections in each confidence band (≥75, 55–74, below 55); one dawn-chorus detection and one sensitive one; a mobile detection with `listener_handle: 'fixture'`; and a listener `fixture` with a handle, plus one without a handle for `handle-prompt`. Read each page's queries to shape them.
- [ ] **Step 4: Run it** (`node scripts/visual/compare.test.mjs`). Expected: PASS.
- [ ] **Step 5: Capture the base twice.** Run `git fetch origin`, then `build --rev "$(git merge-base HEAD origin/main)" --out .visual/base`, then `capture` twice, into `.visual/base/shots-a` and `.visual/base/shots-b` (`--brand current`). Expected: both exit 0, and each holds `(9 routes + 7 states) × 2 widths = 32` PNGs. Open three at random and check that none shows an empty or error state. If one does, fix its fixture.
- [ ] **Step 6: Prove stability.** Run `diff .visual/base/shots-a .visual/base/shots-b`. Expected: 32 `ok`, exit 0. If not, find the varying source (Review Focus 2), fix it in `capture`, and repeat Step 5. A state that cannot be made reachable from fixtures (likely `handle-prompt`) is removed from `STATES`, and its file is named in the PR's Deviations field.
- [ ] **Step 7: Commit** (`feat(visual): screenshot comparison harness on fixture data`).

### Task 2: `tokens.css` and the `token()` helper

**Files:**
- create: `src/styles/tokens.css`
- create: `src/lib/tokens.js`
- create: `src/lib/tokens.test.mjs`
- modify: `src/main.jsx` (`import './styles/tokens.css'` before `./index.css`)
- command: `node src/lib/tokens.test.mjs`

**Interfaces:**
- Produces:
  - `token(name: string) -> string`. It returns the trimmed computed value of `--<name>` on `document.documentElement`, and throws `Error('unknown token --<name>')` when the value is empty.
  - `TOKENS_CSS_PATH = 'src/styles/tokens.css'`.
  - `definedTokens(cssText, selector) -> Set<string>`, the property names declared in that selector's block.
  - Naming: colour roles are `--c-<surface>-<role>`. For example, the shared map and card palette (`C` in `MapPage.jsx` and `DetectionCard.jsx`) becomes `--c-forest-bg`, `--c-forest-card`, `--c-forest-border`, `--c-forest-accent`, `--c-forest-accent-light`, `--c-forest-text`, `--c-forest-text-sub` and `--c-forest-text-muted`. `AMBER` in `listen.js` becomes `--c-amber-*`. ShareSheet's `PAPER`, `INK`, `FOREST` and `ACCENT` become `--c-paper-*`. Fonts are `--font-display: 'Big Shoulders Display', sans-serif`, `--font-label: 'Jost', sans-serif` and `--font-body: 'DM Sans', sans-serif`.
  - Tokens are per **role**, not per value. Two uses of one literal get two tokens when they play different roles, so v4 can map them apart.

- [ ] **Step 1: Write the failing tests** in `src/lib/tokens.test.mjs`:
  - `token reads the computed custom property`: stub `globalThis.document` and `globalThis.getComputedStyle` to return `' #0d2818 '` for `--c-forest-bg`, and assert `token('c-forest-bg') === '#0d2818'`.
  - `token throws on an unknown name`: the stub returns `''`, and `assert.throws(() => token('nope'), /unknown token --nope/)`.
  - `every referenced token is defined in :root`: scan `src/**/*.{js,jsx,css}` for `var\(--([a-z0-9-]+)` and `token\('([a-z0-9-]+)'\)`. Each name must be in `definedTokens(tokens.css, ':root')`. This test stays and guards Tasks 3–5.
  - `token() is never called at module scope`: no line matching `^(export )?const .*token\(` in `src/**/*.{js,jsx}`.
  - Both source scans read only `.js`, `.jsx` and `.css`. Test files (`*.test.mjs`) are outside them, so the stubbed `'nope'` name and the stub values above never count. The same holds for Task 6's guard, whose scope the spec fixes at `.js`, `.jsx` and `.css` (§6). That is why tests may hold literal hex values.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `tokens.js`, and `tokens.css` with a header comment that states the naming rule. Leave the property set empty except the three font tokens. Tasks 3–5 add properties as they replace literals.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(tokens): tokens.css and token() helper`).

### Task 3: Tokenise the stylesheets

**Files:**
- modify: `src/index.css`
- modify: `src/App.css`
- modify: `src/styles/tokens.css`
- command: `node src/lib/tokens.test.mjs`

**Interfaces:**
- Consumes: the naming rule and `definedTokens` from Task 2.

- [ ] **Step 1: Replace** every six-digit literal in both files with `var(--c-…)`, and every `font-family` naming Big Shoulders Display, Jost or DM Sans with the matching `var(--font-…)`. Add each property to `:root` with the literal as its value, byte for byte (keep the case). Leave `font-family: inherit`, `ui-monospace` and `'Playfair Display'` as they are.
- [ ] **Step 2: Run** `node src/lib/tokens.test.mjs`. Expected: PASS. Run `git grep -nE '#[0-9a-fA-F]{6}' -- src/index.css src/App.css`. Expected: no output.
- [ ] **Step 3: Compare.** Run `current-brand check t3`. Expected: 32 `ok`.
- [ ] **Step 4: Commit** (`refactor(tokens): stylesheets read colour and font tokens`).

### Task 4: Tokenise the components

**Files:**
- modify: `src/components/AuthModal.jsx`
- modify: `src/components/DetectionCard.jsx`
- modify: `src/components/DonatePrompt.jsx`
- modify: `src/components/EcologicalCommons.jsx`
- modify: `src/components/EcologicalPipeline.jsx`
- modify: `src/components/HandlePrompt.jsx`
- modify: `src/components/ListenButton.jsx` (font only: `heroStyle` names Big Shoulders Display)
- modify: `src/components/ListenModal.jsx`
- modify: `src/components/MobileDetectionCard.jsx`
- modify: `src/components/Navbar.jsx`
- modify: `src/components/ProfileEditorModal.jsx`
- modify: `src/components/ProvenanceChip.jsx`
- modify: `src/components/ShareSheet.jsx`
- modify: `src/styles/tokens.css`
- command: `node src/lib/tokens.test.mjs`

**Interfaces:**
- Consumes: `token()` from Task 2, and Task 3's properties (reuse a property only when the role is the same).

- [ ] **Step 1: Replace** each literal. In a style object or a CSS string (inline `style`, template strings that build `border` or `linear-gradient` values), use `'var(--c-…)'`. Palette objects such as `C` hold `var()` strings. A value that reaches a non-CSS sink (Leaflet `pathOptions`, canvas, a library option such as `html2canvas`'s `backgroundColor`, or any SVG presentation attribute such as `stroke` or `fill`) uses `token('c-…')` inside the render function. Inline `fontFamily` values naming the three families become `'var(--font-…)'`. ShareSheet's card styles may use `var()`, because `html2canvas` reads computed styles; the `share-sheet` state proves it. Its export call is different: the `backgroundColor: PAPER` option passed to `html2canvas` reads `token('c-paper-bg')` inside the click handler, and `Waveform`'s `color` default (an SVG attribute) reads `token()` in its body. No screenshot covers the export, so verify it by hand: on `vite preview` with the fixture build, export a share image under each brand and check its background matches the card.
- [ ] **Step 1b: Fonts in every file that names a family.** The files that name Big Shoulders Display, Jost or DM Sans are `git grep -lE "Big Shoulders|'Jost'|DM Sans" -- src`. On 2026-11-21 that was 15 files, `ListenButton.jsx` among them. After Tasks 3–5, the same command must list none.
- [ ] **Step 2: Run** `node src/lib/tokens.test.mjs` and `npm run lint:ratchet`. Expected: both PASS. Run `git grep -nE '#[0-9a-fA-F]{6}' -- src/components`. Expected: no output.
- [ ] **Step 3: Compare.** Run `current-brand check t4`. Expected: 32 `ok`.
- [ ] **Step 4: Commit** (`refactor(tokens): components read colour and font tokens`).

### Task 5: Tokenise the pages and `listen.js`

**Files:**
- modify: `src/pages/AboutPage.jsx`
- modify: `src/pages/AddNodePage.jsx`
- modify: `src/pages/DonatePage.jsx`
- modify: `src/pages/JournalPage.jsx`
- modify: `src/pages/MapPage.jsx`
- modify: `src/pages/NodePage.jsx`
- modify: `src/pages/NodeReportPage.jsx`
- modify: `src/pages/RegisterNode.jsx`
- modify: `src/pages/SpeciesPage.jsx`
- modify: `src/lib/listen.js`
- modify: `src/styles/tokens.css`
- command: `node src/lib/tokens.test.mjs`

**Interfaces:**
- Consumes: as Task 4.

- [ ] **Step 1: Replace** each literal, following Task 4's rules. The Leaflet `CircleMarker` `pathOptions` in `MapPage.jsx` (`fillColor` and `color` for active and offline nodes, and `AMBER` for mobile detections) and their equivalents in `SpeciesPage.jsx` and `JournalPage.jsx` call `token()` inside the component body. `AMBER` in `listen.js` keeps its keys (`base`, `light`, `dark`, `ink`), with `var()` values for CSS use. A map marker reads `token('c-amber-base')` and `token('c-amber-dark')`.
- [ ] **Step 2: Run** `node src/lib/tokens.test.mjs` and `npm run lint:ratchet`. Expected: both PASS. Run `git grep -nE '#[0-9a-fA-F]{6}' -- src`. Expected: matches only in `src/styles/tokens.css`.
- [ ] **Step 3: Compare.** Run `current-brand check t5`. Expected: 32 `ok`. The map markers on `/`, `/species/…` and `/journal/fixture` must be visible in both captures (Review Focus 3).
- [ ] **Step 4: Commit** (`refactor(tokens): pages read colour and font tokens`).

### Task 6: No-hex guard

**Files:**
- create: `scripts/ci/no-hex-literals.test.mjs`
- command: `node scripts/ci/no-hex-literals.test.mjs`
- command: `npm test`
- command: `npm run build`

**Interfaces:**
- Produces: `findHexLiterals(root) -> Array<{ file, line, match }>`, scanning `<root>/src/**/*.{js,jsx,css}` except the exact path `src/styles/tokens.css`.

- [ ] **Step 1: Write the tests:**
  - `the repo has no six-digit literal outside tokens.css`: `assert.deepEqual(findHexLiterals(REPO_ROOT), [])`.
  - `a literal in a .jsx is found`: write `src/a.jsx` with `const x = '#abcdef'` into a `mkdtempSync` root, and expect one hit with `line: 1`.
  - `an eight-digit literal is found`: `'#abcdef80'` in `.css` gives one hit.
  - `a tokens.css elsewhere is scanned`: `src/other/tokens.css` with `#abcdef` gives one hit.
  - `images are not scanned`: `src/assets/x.svg` with `#abcdef` gives no hit.
- [ ] **Step 2: Run it.** Expected: PASS, because Tasks 3–5 already removed every literal.
- [ ] **Step 3: Sabotage.** Add `color: '#123456'` to `src/pages/AboutPage.jsx` and run the test. Expected: FAIL, naming `src/pages/AboutPage.jsx` and the line. Restore the file from a `cp` backup taken before the edit, compared with `cmp -s`.
- [ ] **Step 4: Run** `npm test`, `npm run lint:ratchet` and `npm run build`. Expected: all exit 0.
- [ ] **Step 5: Commit** (`test(ci): no hex literals outside tokens.css`).
- [ ] **Step 6: PR 1 comparison, on the committed head.** Run `build --rev HEAD --out .visual/pr1`, then `capture --dist .visual/pr1/dist --out .visual/pr1/shots --brand current`, then `diff .visual/base/shots-a .visual/pr1/shots`. Expected: 32 `ok`, exit 0. Record the three commands, the head SHA and the exit statuses in the conformance record.

---

## PR 2 — v4 tokens, fonts and mandala

### Task 7 (operator): Prodiga publishing licence

- [ ] **Step 1:** David confirms in writing that the Prodiga licence allows publishing `prodiga-regular.ttf` in a public repository, and names where the licence lives. The file embeds no licence string (DESIGN.md).
- [ ] **Step 2:** If it does, record the licence's location in `public/fonts/v4/SOURCES.md` (Task 9). If it does not, Task 9 keeps Prodiga out of the repo and supplies it at build time from a non-public source. That route is a deviation, named in PR 2's Deviations field (spec §3).

### Task 8: The v4 token block

**Files:**
- modify: `src/styles/tokens.css`
- modify: `src/lib/tokens.test.mjs`
- existing: `~/shuksan-leads/voice-research/magora-portal/design/DESIGN.md`
- command: `node src/lib/tokens.test.mjs`

**Interfaces:**
- Consumes: `definedTokens` from Task 2.
- Produces: `:root[data-brand="v4"]`, which sets every `:root` colour property and three font tokens: `--font-display: 'Prodiga', serif`, `--font-label: 'Epilogue', sans-serif` and `--font-body: 'Epilogue', sans-serif`. It also adds `--mk1: #5C8D68`, `--mk2: #3F7350`, `--mk3: #24503A` and `--mk4: #0F2A1A` (from `design/brand/mandala.py`) to both blocks, with the same values, because the mandala renders only under v4.

- [ ] **Step 1: Write the failing tests:**
  - `v4 sets every :root colour token`: `definedTokens(css, ':root')` minus `definedTokens(css, ':root[data-brand="v4"]')` is empty.
  - `v4 colour values come from the v4 palette`: every `--c-*` and `--mk*` value in the v4 block is in `V4_PALETTE`. The `--font-*` declarations are excluded; a separate assertion checks them against the three values in Interfaces. That is the DESIGN.md light values (`#494E3A #2E3226 #F3EFE4 #FFFDF7 #111111 #E0502A #D1D1A7 #3F7350 #24503A #000000 #D9CFB6 #C0392B #838F63 #4E1623`), plus the Rationale's named inks (`#55594A #C9CBA6`), the mandala inks above, and `#FFFFFF`. Compare case-insensitively.
  - `no dark mode`: `tokens.css` has no `prefers-color-scheme`.
- [ ] **Step 2: Run it.** Expected: FAIL, because the v4 block is missing.
- [ ] **Step 3: Implement** the block. The header comment gains a table with one row per current token: the token, its current value, the DESIGN.md role it maps to, and its v4 value. Map by what the element is on the mockups (https://claude.ai/artifact/3DETVQXnHNokvDXitVDrqj). The forest chrome maps to `secondary`, the reading grounds to `background` or `surface`, the accent greens to `brand` or `live`, links to `link`, alerts to `error`, and the "now" dot only to `accent`.
- [ ] **Step 4: Run it.** Expected: PASS. Then run `current-brand check t8`. Expected: 32 `ok`.
- [ ] **Step 5: Commit** (`feat(tokens): v4 token block`).

### Task 9: v4 fonts and the precache exclusion

**Files:**
- create: `public/fonts/v4/prodiga-regular.ttf` (copied unmodified from `design/fonts/prodiga-regular.ttf`, if Task 7 allows)
- create: `public/fonts/v4/epilogue-latin-wght.woff2`
- create: `public/fonts/v4/SOURCES.md`
- create: `src/styles/fonts-v4.css`
- modify: `src/main.jsx` (import `./styles/fonts-v4.css` after `tokens.css`)
- modify: `vite.config.js`
- command: `npm run build`

**Interfaces:**
- Produces: the `@font-face` families `'Prodiga'` (400) and `'Epilogue'` (variable, `font-weight: 300 700`), both with `font-display: swap`.

- [ ] **Step 1: Fetch Epilogue.** Use the latin-subset variable `woff2` from `https://fonts.googleapis.com/css2?family=Epilogue:wght@300..700` (OFL). Record in `SOURCES.md`, for each file: its source URL, its licence and where that licence lives, and its `shasum -a 256`.
- [ ] **Step 2: Write** `fonts-v4.css` with the two `@font-face` rules. A face downloads only when an element uses its family, and only the v4 font tokens name these families, so a current-brand visitor never fetches them.
- [ ] **Step 3: Add** `'**/fonts/v4/**'` to `workbox.globIgnores` in `vite.config.js`. Change nothing else in the file.
- [ ] **Step 4: Verify.** Run `npm run build`, then `grep -c 'fonts/v4' dist/sw.js`. Expected: `0`. Run `current-brand check t9`. Expected: 32 `ok`, with no `/fonts/v4/` failure (Review Focus 5).
- [ ] **Step 5: Commit** (`feat(brand): self-hosted v4 fonts, kept out of the precache`).

### Task 10: Mandala and lockup

**Files:**
- create: `src/components/v4/mandala.js`
- create: `src/components/v4/mandala.test.mjs`
- create: `src/components/v4/Mandala.jsx`
- create: `src/components/v4/Lockup.jsx`
- existing: `~/shuksan-leads/voice-research/magora-portal/design/brand/mandala.py`
- command: `node src/components/v4/mandala.test.mjs`

**Interfaces:**
- Produces:
  - `mandalaShapes() -> Array<{ d: string, stroke: string, strokeWidth: number }>`, plus the centre dot. This is a port of `svg(simple=False)` in `mandala.py`: three rings, then the flower, with strokes `var(--mk1)` to `var(--mk4)` and width `2.3`.
  - `<Mandala size={number} title?={string} />`: a 100×100 viewBox SVG, `role="img"`. With a `title` it gets an `aria-label`; without one, `aria-hidden`.
  - `<Lockup />`: the mandala, then MAGORA in `var(--font-display)` and PROJECT in `var(--font-body)`, as in the mockups' Brand section.

- [ ] **Step 1: Write the failing tests:**
  - `the outer ring starts at the top tip`: `mandalaShapes()[0].d.startsWith('M50.00 3.00')` (at t=0, r=47).
  - `each ring has 720 points`: count of `' L'` in `d` is `719`.
  - `shapes match the Python source`: the first 40 characters of each `d` equal `python3 mandala.py`'s output. Paste those prefixes into the test as constants; they are not hex colours.
  - `no literal colours`: no shape's `stroke` matches `/#[0-9a-f]{6}/i`.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `mandala.js`, porting `ring` and `flower` exactly (the same exponents, 720 steps, `toFixed(2)`). Then write `Mandala.jsx` and `Lockup.jsx`. The file header says: "A redraw of Noah's mark (`design/brand/mandala.py`). Replace it with his vector master (plan Task 15)."
- [ ] **Step 4: Run it.** Expected: PASS. Then run `npm run lint:ratchet`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(brand): mandala and lockup components (redraw)`).

---

## PR 3 — The switch and the v4 shell

### Task 11: `src/lib/brand.js`

**Files:**
- create: `src/lib/brand.js`
- create: `src/lib/brand.test.mjs`
- command: `node src/lib/brand.test.mjs`

**Interfaces:**
- Produces:
  - `BRANDS = ['current', 'v4']`, and `COOKIE = 'magora_brand'`.
  - `explicitBrand(search: string) -> 'current' | 'v4' | null`. The value of the `brand` parameter if it is exactly one of `BRANDS`, otherwise `null`.
  - `readBrand({ search, cookie }) -> 'current' | 'v4'`. `explicitBrand(search)`, else a valid cookie value, else `'current'`.
  - `applyBrand(brand, { explicit })`. Sets `document.documentElement.dataset.brand = brand`. When `explicit` is true, it also writes `magora_brand=<brand>; Path=/; Max-Age=31536000; SameSite=Lax`, adding `; Secure` when `location.protocol === 'https:'`. It then calls `history.replaceState(history.state, '', url)`, where `url` is the current URL without `brand`, keeping its other parameters and its hash.
  - `pickPage(brand, Current, V4) -> Component`. Returns `V4` when the brand is `'v4'` and `V4` is defined; otherwise `Current`.

- [ ] **Step 1: Write the failing tests.** Install fake `document` (`documentElement.dataset`, a settable `cookie`), `location` and `history` on `globalThis` per test.
  - `param beats cookie`: `readBrand({ search: '?brand=current', cookie: 'magora_brand=v4' }) === 'current'`.
  - `cookie applies with no param`: `readBrand({ search: '', cookie: 'a=1; magora_brand=v4' }) === 'v4'`.
  - `invalid values are ignored`: `?brand=V4`, `?brand=`, `?brand=v5`, and the cookie `magora_brand=x` each give `'current'`.
  - `default is current`: `readBrand({ search: '', cookie: '' }) === 'current'`.
  - `explicit choice writes the cookie and strips the param`: `location.href = 'https://x/node/1?brand=v4&tab=a#h'`, then `applyBrand('v4', { explicit: true })` writes a cookie that includes `magora_brand=v4`, `Path=/`, `Max-Age=31536000`, `SameSite=Lax` and `Secure`, and `replaceState` receives `'/node/1?tab=a#h'`.
  - `default writes no cookie and keeps the URL`: `applyBrand('current', { explicit: false })` leaves `document.cookie` untouched and never calls `replaceState`, and `dataset.brand === 'current'`.
  - `pickPage falls back to current`: `pickPage('v4', A, undefined) === A`, `pickPage('current', A, B) === A`, and `pickPage('v4', A, B) === B`.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `brand.js`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(brand): readBrand and applyBrand`).

### Task 12: `BrandContext`, `BrandPage` and the wiring

**Files:**
- create: `src/lib/brandContext.jsx`
- create: `src/components/BrandPage.jsx`
- modify: `src/main.jsx`
- modify: `src/App.jsx`
- command: `npm run build`

**Interfaces:**
- Consumes: `readBrand`, `applyBrand`, `explicitBrand` and `pickPage` from Task 11.
- Produces:
  - `BrandProvider({ brand, children })`, and `useBrand() -> 'current' | 'v4'`. Read-only, with no setter.
  - `BrandPage({ current, v4 })`, which renders `pickPage(useBrand(), current, v4)` with no props.

`src/pages/v4/` (spec §4.5) is not created here. No v4 page exists yet, and git cannot hold an empty directory. The first page spec (Home/Map) creates it.

- [ ] **Step 1: Wire `main.jsx`.** Before `createRoot`: `const brand = readBrand({ search: location.search, cookie: document.cookie })`, then `applyBrand(brand, { explicit: explicitBrand(location.search) !== null })`. Then wrap `<App />` in `<BrandProvider brand={brand}>`.
- [ ] **Step 2: Wire `App.jsx`.** Each of the nine `Route` elements becomes `<BrandPage current={X} />` (no `v4` yet), and `<Navbar />` becomes `<BrandPage current={Navbar} />`. Task 13 adds `v4={NavbarV4}`.
- [ ] **Step 3: Verify.** Run `npm run build` and `npm test`. Expected: both exit 0. Run `current-brand check t12`. Expected: 32 `ok`. Then run `capture --dist .visual/t12/dist --out .visual/t12/shots-v4 --brand v4`. Expected: exit 0, and the pages render in v4 tokens. Open `/` and `/about` at 1280 to check.
- [ ] **Step 4: Commit** (`feat(brand): BrandPage selects page versions by brand`).

### Task 13: v4 navbar and preview chip

**Files:**
- create: `src/components/v4/NavbarV4.jsx`
- create: `src/components/v4/PreviewChip.jsx`
- create: `src/components/v4/v4.css`
- modify: `src/components/Navbar.jsx` (export `AccountMenu` and the nav item list as `NAV_ITEMS`; no other change)
- modify: `src/App.jsx`
- command: `npm run build`

**Interfaces:**
- Consumes: `Lockup` (Task 10), `useBrand` (Task 12), `useAuth` from `src/lib/auth.jsx`, and `ListenButton` from `src/components/ListenButton.jsx`.
- Produces:
  - `NavbarV4()`: a bar in `var(--c-…)` tokens that resolve to secondary `#2E3226` under v4. It holds the `Lockup` linking to `/`, the `NAV_ITEMS` links with the same sign-in gating as `Navbar`, the Donate tab, `AccountMenu` or Sign in, and `ListenButton` as the primary action inside a `.v4-listen-badge` wrapper, styled in `v4.css`. The button still opens the existing `ListenModal`.
  - `PreviewChip()`: renders `null` unless `useBrand() === 'v4'`. Otherwise a fixed chip with the text "v4 preview · switch back", where "switch back" is an `<a href="?brand=current">`, so the switch reloads.

- [ ] **Step 1: Implement** the three files, and the two exports in `Navbar.jsx`. In `App.jsx`, the navbar route becomes `<BrandPage current={Navbar} v4={NavbarV4} />`, and `<PreviewChip />` renders after `<DonatePrompt />`. `v4.css` uses only `var(--…)` (Task 6's guard covers it).
- [ ] **Step 2: Verify.** Run `npm run build`, `npm test` and `npm run lint:ratchet`. Expected: all exit 0. Run `git grep -nE "from '\.\./?(\.\./)?(pages|components)/v4" -- src/pages src/components ':!src/components/v4'`. Expected: no output, because no current file imports v4. Run `current-brand check t13`. Expected: 32 `ok`.
- [ ] **Step 3: Manual check on `vite preview`** (a build with the fixture env, so production is never reached). Open `/?brand=v4`. Expected: the URL becomes `/`, the v4 navbar and chip show, a reload keeps v4, and Listen opens the ListenModal. Click "switch back". Expected: the current navbar, no chip, and the URL `/`.
- [ ] **Step 4: Commit** (`feat(brand): v4 navbar and preview chip`).

### Task 14 (operator): Device check

- [ ] **Step 1:** On a Vercel preview of PR 3 (production data; the check only reads), David or Noah opens `?brand=v4` in Safari on an iPhone, then reloads. Expected: v4 persists. Then they open the installed PWA. Criterion 2 says the choice survives the installed PWA. Whether iOS shares this cookie with a Home Screen app is not verified. If it does not, record that in the PR, and David decides whether to add an in-app opt-in link (a spec amendment) or accept it.

---

## Later

### Task 15 (operator): Swap in Noah's vector master, when found

The vector master was not found on 2026-11-21. The org's three repos (`magora-portal`, `magora-android-node` and `magora-acoustic-biodiversity`) hold none, and themagoraproject.com (Squarespace) serves only the PNG lockups `magora-lockup-horizontal-green.png` and `magora-lockup-stacked-green.png`.

- [ ] **Step 1:** Get the SVG or AI master from Noah.
- [ ] **Step 2:** In a `standard` PR, replace the paths that `mandalaShapes()` returns with the master's paths, recoloured to `var(--mk1)` to `var(--mk4)`. Then update the shape-match test to the new source, and delete the redraw note in the file header.
