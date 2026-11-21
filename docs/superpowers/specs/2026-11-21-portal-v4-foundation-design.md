# Portal v4 brand foundation — design

- **Date:** 2026-11-21
- **Status:** draft. This writes up the design David approved in the 2026-11-21 session, for review.
- **Lane:** Specced. Depth: `subtle-correctness`, because it changes `package.json` and `index.html` (Prodiga)
  and touches most of the UI.
- **Design source:** the v4 token contract `design/DESIGN.md` (0 VALID, 2026-11-21) in
  `~/shuksan-leads/voice-research/magora-portal/`. The hi-fi mockups are at
  https://claude.ai/artifact/3DETVQXnHNokvDXitVDrqj. The source is outside the repo; §4.3 copies the tokens in.
- **Successors:** one short spec per redesigned page (§7). A separate spec covers the Field App
  (`2026-11-21-field-app-design.md`).

This document specifies; it implements nothing.

## 1. Why

David and Noah want to rebuild the portal to the v4 mockups. These bring in Noah's mandala lockup, the
org site's palette, Prodiga and Epilogue, and new layouts for Home/Map, Place, Species, Journal and
Sign-in. They want to use the new portal, tune it, and launch it when ready, without the live site
changing for anyone else in the meantime.

AGENTS.md rules out a long-lived branch ("Trunk… No long-lived branches"). A branch would also drift
from Noah's ongoing work. So v4 is built on `main`, behind an opt-in switch (decision D-1).

**Success criteria (this spec is done when all hold):**

1. With no opt-in, the current site renders unchanged. The screenshot comparison in §6 passes for every
   route in §4.5.
2. Visiting any URL with `?brand=v4` switches that browser to v4 until `?brand=current` is used. The
   choice survives reloads and the installed PWA.
3. Under v4, every route renders with the v4 tokens, fonts and logo. Routes that have a v4 page render
   it; routes that don't render the current page in v4 tokens.
4. A visible chip tells an opted-in viewer they are on the v4 preview, and switches back.
5. No literal six-digit hex colour remains in a `.js`, `.jsx` or `.css` file under `src/` outside
   `src/styles/tokens.css`. A test enforces this (§6). Image assets such as SVGs are not checked.

## 2. Decisions (David, 2026-11-21)

- **D-1 Opt-in on main.** The alternatives were a long-lived branch with its own Vercel URL, and waiting
  for staging. Both were rejected.
- **D-2 Full mockup redesign.** The switch selects whole page versions, not just a skin.
- **D-3 Launch in two steps.** One PR flips the default to v4. A later PR deletes the old pages, the
  old tokens, the switch, and the old icons and manifest.
- **D-4 The manifest, icons, `theme-color` and service worker change only at launch.** A cookie cannot
  vary a manifest per person, because the install fetches it once. The new app icon (A: mandala on cream)
  is previewed in the mockups until then.
- **D-5 Noah's agreement.** Noah agrees to §4.2 (tokenising his 26 files) before that PR is opened.

## 3. Constraints

- **Production data.** Until Spec 2 Task 23 lands, previews and `vite dev` reach production Supabase
  (AGENTS.md). v4 pages are real code on real data. A v4 page that writes (posting a Listen, following a
  place) writes to production even when only David and Noah can see it. Each page spec that writes names
  its write paths and how they are tested (§7).
- **Fonts.** Prodiga is self-hosted, and David confirmed the licence on 2026-11-21. The repo is public,
  so committing the font file publishes it. Before §4.4 lands, the licence must be checked to allow that.
  If it does not, the file is kept out of the repo and supplied at build time from a non-public source.
  That route is then a deviation recorded in the plan. Epilogue is a Google Font.
- **No backend changes.** This spec adds no migration, `api/` route or Edge Function.

## 4. Design

### 4.1 The switch: `src/lib/brand.js`

- `readBrand({ search, cookie }) -> 'current' | 'v4'`. A `brand` query parameter of `v4` or `current`
  wins over the cookie. Any other value is ignored. With neither, the result is `'current'`.
- `applyBrand(brand)` writes the cookie `magora_brand=<brand>` (path `/`, one year, `SameSite=Lax`) and
  sets `document.documentElement.dataset.brand`. It also removes the `brand` parameter from the URL with
  `history.replaceState`, so a shared link does not opt in its recipient.
- `main.jsx` calls both once, before the first render. The brand does not change during a session
  without a reload.
- A `BrandContext` exposes the value to components. It is read-only.

### 4.2 Tokens, with no visual change (PR 1)

- Add `src/styles/tokens.css`, holding one custom property per distinct colour role now in use. Each
  property's value is the current literal.
- Replace every literal in `src/` (316 occurrences across 26 files on 2026-11-21) with `var(--…)`. In
  inline styles and JS colour maps, read the value through a `token('name')` helper, so canvas and Leaflet
  code still receives a concrete colour.
- Font families get the same treatment: `--font-display`, `--font-label`, `--font-body`.
- This PR changes no pixel. §6 defines the check.

### 4.3 v4 tokens (PR 2)

- A `:root[data-brand="v4"]` block in `tokens.css` sets each property to its v4 value. The values are
  mapped from DESIGN.md v4 roles, and the mapping is recorded as a table in the file's header comment.
- Light only. The current portal has no dark mode (no `prefers-color-scheme` rule in `src/` outside a
  stock Vite SVG). DESIGN.md's v4 `dark` values are derived and pending a dark pass, so v4 dark mode is
  out of scope here (§5).

### 4.4 Fonts and logo (PR 2)

- Prodiga is loaded by an `@font-face` scoped by use: it is referenced only from v4 rules, so a
  current-brand visitor never downloads it. Epilogue is loaded the same way.
- The current Google Fonts `<link>` in `index.html` is unchanged.
- The mandala is a React SVG component, ported from `design/brand/mandala.py`. Noah's vector master,
  once located, replaces the redraw. The lockup sets MAGORA in Prodiga and PROJECT in Epilogue, as in the
  mockups' Brand section.

### 4.5 Page selection and the v4 shell (PR 3)

- In `App.jsx`, each route's element becomes `<BrandPage current={X} v4={XV4} />`. With `v4` undefined, or
  brand `current`, it renders `current`.
- v4 pages live in `src/pages/v4/` and v4-only components in `src/components/v4/`. They may import
  anything in `src/lib/`. No current page imports from `v4/`.
- `Navbar` gets a v4 version: chrome `#2E3226`, the lockup, and the Listen badge as the primary action.
  It opens the existing `ListenModal`.
- **Routes in scope** (all nine): `/`, `/node/:id`, `/node/:id/report/:date`, `/species/:name`,
  `/journal/:handle`, `/add-node`, `/register`, `/about`, `/donate`.

### 4.6 The preview chip (PR 3)

A small fixed chip, "v4 preview · switch back", renders only when the brand is `v4`. Its link is
`?brand=current`.

## 5. Out of scope

- The v4 page bodies themselves (§7).
- The Steward dashboard. It has no current page, so it is a new feature with its own spec.
- The manifest, icons, `theme-color` and service-worker changes (D-4, launch PR).
- Any per-user server-side flag. The switch is per browser.
- Dark mode, in either brand.

## 6. Testing

- **`brand.js` unit tests** (`src/lib/brand.test.mjs`): parameter over cookie; an invalid parameter is
  ignored; the default is `current`; `applyBrand` writes the cookie and strips the parameter.
- **No-literal guard** (`scripts/ci/no-hex-literals.test.mjs`): fails if any `#[0-9a-fA-F]{6}` occurs in a
  `.js`, `.jsx` or `.css` file under `src/` outside `tokens.css`. Image assets are not scanned. Sabotage-tested by adding a literal and seeing it fail.
- **Screenshot comparison for PR 1:**
  - Tool: a Playwright script, `scripts/visual/compare.mjs`, run locally against `vite preview` of the
    base and of the head.
  - Data: fixture network responses, never production.
  - Coverage: each §4.5 route, at 375 and 1280 widths, in light mode.
  - Pass: every pixel matches. The result and its run command are recorded in the conformance record.
- **Existing checks:** `npm test`, `npm run lint:ratchet` and `npm run build` pass on each PR.

## 7. Page specs that follow

Each page spec is short, and must state:
- the current page it replaces and the mockup screen it follows;
- its data reads, and each **write path**, with how it is tested without writing production data until
  staging lands (a fixture, or a dry-run guard);
- its accessibility check.

The order is Home/Map, Place, Species, Journal, Sign-in (AuthModal). The pages the mockups don't cover
(About, Add Node, Register, Donate, Report) get v4 tokens only, unless a later spec says otherwise.

## 8. Launch

- **Launch PR:** the default becomes `v4`. The manifest, icons (app icon A, favicons from the two-ring
  mandala) and `theme-color` change, and the service worker version bumps.
- **Cleanup PR:** deletes the `current` pages, the `current` tokens, `brand.js`, the chip and the old
  icons.
- Both are separate PRs, each with its own review.
