# Magora Field App — design (Phase 1, and the cloud build environment)

- **Date:** 2026-11-21
- **Status:** draft. This writes up the design David approved in the 2026-11-21 session, for review.
- **Lane:** Specced. It adds a capability, touches auth and PII (location, audio, email), and creates a repo.
- **Home:** this spec is reviewed in magora-portal, because the app repo does not exist yet. Once the repo
  `magora-field-app` is created (§5, task 0), the spec is copied there and this copy points to it.
- **Sources:**
  - `~/Magora Mockups/Magora Field App Summary.pdf` and `Magora Field App PRD.pdf` (Sep 2026).
  - The v4 token contract `design/DESIGN.md` and mockups at https://claude.ai/artifact/3DETVQXnHNokvDXitVDrqj.
- **Sibling:** `2026-11-21-portal-v4-foundation-design.md`. The portal and the app share tokens through
  DESIGN.md, not shared code.

This document specifies; it implements nothing.

## 1. Why

The Field App puts Magora's listening loop on a phone: record a place, learn who is singing, and follow
places. Per the Summary, it adds four things the PWA can't do reliably: recording with the screen locked,
push notifications, native GPS and share sheets, and store presence. It is built in Expo (React Native
and TypeScript), which ships to both stores and builds iOS in EAS's cloud without a Mac.

David also wants the build to run as far as possible in Claude Code cloud sessions, in parallel with the
portal redesign, with the right database access and process. This spec covers Phase 1 and that
environment.

**Success criteria for Phase 1:**

1. Signed in with an email one-time code, a person can:
   - record 15 s to 5 min;
   - see the BirdNET result;
   - choose to post it;
   - find it on the portal's public map.
   The row is the same shape as one made in the portal.
2. Without an account, a person can browse Map, Place (Notice depth) and Today.
3. Builds install through TestFlight and Play internal testing.
4. Every Phase 1 task merged through a PR whose CI ran the contract tests against the local stack (§4.3).
5. No secret is held in the app repo or the cloud environment (§4.4).

## 2. Decisions (David, 2026-11-21)

- **D-1 New public repo `magora-field-app`** in the magora-project org, with no licence yet (Noah's
  call), like the rest of Magora. The fork-PR rules carry over from the portal's AGENTS.md. Never run a
  fork's code with secrets, and read the whole diff before checking it out.
- **D-2 The cloud uses a throwaway local Supabase**, built from the portal's migrations at a pinned commit,
  with synthetic data. No real credentials enter the cloud.
- **D-3 Branches free, `main` locked.** Cloud sessions may push their own `claude/*` branches and open
  draft PRs without asking. A GitHub ruleset protects `main` and has an empty bypass list. Only David or
  Noah merges. Cross-vendor review comes from the PR bots.
- **D-4 Assumptions confirmed:**
  - the app is named "Magora";
  - the first audience is existing stewards and naturalists, so there is no under-13 flow;
  - the running-cost budget is open.

## 3. The API contract (`docs/api-contract.md` in the app repo)

The app adds **no backend** in Phase 1. It uses only what the portal already uses. Each contract entry
names the portal file and commit it was read from (the pinned commit, §4.2).

| Step | Portal source | Contract |
|---|---|---|
| Sign in | `src/components/AuthModal.jsx` | `supabase.auth.signInWithOtp({ email })`, then `verifyOtp`. OAuth is out of scope. |
| Upload audio | `src/lib/storageUpload.js` | `POST {SUPABASE_URL}/functions/v1/storage-upload` with the user's JWT. |
| Create the Listen | `src/lib/listenQueue.js` | Insert into `mobile_detections` with `status: 'pending'`. It starts `published = false` (migration `20260701_listen_consent_published`). |
| Result | the Fly.io worker (outside this repo) | The worker sets `status = 'complete'` and the species. The app polls its own row. |
| Post (consent) | `20260701_listen_consent_published` | The user sets `published = true` on their own row. Only then does it appear in `public_mobile_detections`. Discard deletes the draft. |
| Insight | `api/insight.js` (mobile branch) | `POST {PORTAL_ORIGIN}/api/insight`. |
| Map, Place, Today | the views and RPCs that MapPage, NodePage and `journalFollows.js` read | Read-only. |

`PORTAL_ORIGIN` is a build-time setting, because the portal calls `/api` by relative path. Expo web (used
in the cloud, §4.3) is a browser. If the portal's `/api` rejects cross-origin requests, the cloud fakes
answer for it, and the real check happens on a device build.

Phase 2 needs backend additions: a device-token table and notification preferences for push. Those are
portal migrations, each its own `subtle-correctness` PR in magora-portal, never written from the app repo.

## 4. The cloud build environment

### 4.1 What the docs say (code.claude.com, fetched 2026-11-21)

- Each session runs in a fresh Ubuntu 24.04 VM with Node, Docker and Postgres preinstalled.
- A setup script runs as root before launch and is cached if it finishes in about 5 minutes.
- Network access is Limited by default.
- The session loads the repo's `CLAUDE.md`, `.claude/settings.json` hooks, rules, skills and agents. It
  loads none of the user's `~/.claude` setup.
- It pushes branches without stopping for approval.
- The GitHub proxy does not limit which branches a push updates. GitHub rulesets do that.
- Environment variables are readable by anyone using the environment.

The docs do not say whether `AGENTS.md` loads directly. `CLAUDE.md` imports it (`@AGENTS.md`). Task 0
proves which.

### 4.2 Environment and setup

- **Environment:** `magora-field-app` at claude.ai/code. It is personal, not shared. Network access is
  Limited plus `expo.dev` and `*.expo.io`. It has no environment variables.
- **`scripts/cloud-setup.sh`** (committed; the environment's setup script calls it):
  - installs the Supabase CLI at a pinned version;
  - runs `npm ci`;
  - fetches `supabase/migrations/` and `supabase/functions/storage-upload/` from magora-portal at the
    commit in `portal-pin.txt`.
  It fails loudly on any error.
- **The schema baseline.**
  - Portal migrations alone cannot build a fresh database. The earliest one (`20260626`) alters an
    existing `nodes` table, and later ones assume production's pre-history schema and PostGIS.
  - Spec 2 Task 12 adds that pre-history as `20260625_baseline_prehistory.sql`. It is not on `main` yet
    (2026-11-21).
  - Once it lands, `portal-pin.txt` must name a commit that contains it, and the stack applies the portal
    migrations in order, baseline first. `cloud-setup.sh` refuses a pin without the baseline.
  - Until then, the stack applies `supabase/contract-schema.sql` instead. This is a hand-written schema
    holding only the tables, views, functions, policies and extensions that §3 uses, written from the
    portal migrations at the pin, and it is marked as interim. The first pin bump after the baseline lands
    deletes it.
  - Contract tests run against whichever schema is in use.
- **`portal-pin.txt`** holds one full portal commit SHA. Moving it is a PR, so a schema change reaches the
  app deliberately.
- **SessionStart hook** (`.claude/settings.json`):
  - starts Docker if it is not running, then runs `supabase start`;
  - applies the schema (the pinned migrations, or the interim contract schema), then `supabase/seed.sql`,
    which holds synthetic places, nodes, Listens and one test user with a fixed one-time code;
  - serves the pinned `storage-upload` Edge Function locally with `supabase functions serve`, so the
    upload step of §3 runs real portal code against local Storage;
  - starts `scripts/fakes/server.mjs`, which serves canned BirdNET completions and `/api/insight`
    replies matching §3.
  A failure prints the step that failed and leaves the session usable for non-database work.

### 4.3 What runs in the cloud, and what doesn't

- **In the cloud:**
  - TypeScript type checks and lint.
  - Jest unit tests.
  - Contract tests that drive §3 against the local Supabase and the fakes.
  - An Expo web smoke test (each tab renders, and the Listen flow completes against the fakes).
- **Not in the cloud:** device runs and EAS builds. EAS needs an Expo token, which stays on David's or
  Noah's machine. They trigger builds there and test on phones. Real-data checks wait for staging
  (Spec 2), never production.

### 4.4 Harness in the repo

Cloud sessions see only what the repo carries. Task 0 adds the following:

- **`AGENTS.md`**, adapted from magora-portal, with these cloud rules:
  - Push only `claude/*` branches, and open PRs as drafts.
  - Never push to, merge into, or change settings on `main`.
  - Never add a secret to the repo, a hook, the environment or a commit message. Never point the app at a
    real Supabase URL or the production portal.
  - Every task names a test that runs against the local stack.
  - Backend changes are proposed as a portal issue, never made here.
- **`CLAUDE.md`**, containing `@AGENTS.md`.
- **`.claude/rules/process.md`**, adapted from the portal's: lanes, stages, depth labels and the PR-bot
  matrix. The `.review/` evidence gate is not copied in Phase 1. Bot reviews are triaged in the PR, as on
  the portal before Spec 3.
- **`.claude/skills/`**: brainstorming and writing-plans, copied from magora-portal at the pin; and
  subagent-driven-development and test-driven-development, which magora-portal does not carry, copied
  unchanged from `obra/superpowers` at a pinned commit (MIT), with their supporting files.
- **CI** (`.github/workflows/ci.yml`): type check, lint, Jest, and the contract tests (Docker-based
  Supabase on GitHub's runner).
- **GitHub settings** (David, once):
  - a ruleset on `main` that requires a PR and passing CI, blocks force-pushes and deletion, and has an
    empty bypass list;
  - the Claude GitHub App installed on the repo;
  - CodeRabbit, the Codex GitHub App and Gemini enabled.

### 4.5 Task 0: proving the environment (before any feature work)

Run from one cloud session, with the results recorded in `docs/cloud-env-proof.md`:

1. The setup script finishes, and a second session starts from the cache.
2. `supabase start` succeeds, the schema and seed load, and an upload through the locally served
   `storage-upload` function lands in local Storage.
3. The session can quote a rule that appears only in `AGENTS.md`, which proves it loaded (or the import
   via `CLAUDE.md` did).
4. `git push origin HEAD:main` is rejected by the ruleset.
5. A `claude/*` branch pushes, and a draft PR opens with CI green.

## 5. Phase plan

| Phase | Where | Outcome |
|---|---|---|
| 0 · Repo and environment | David's Mac, then one cloud session | Repo, harness, CI, ruleset; §4.5 passes |
| 1a · Shell and data | cloud | Expo Router tabs (Today, Map, Listen, Places, Journal), v4 tokens and fonts, typed Supabase client, contract tests |
| 1b · Listen loop | cloud | Record (screen-lock-safe audio session), upload, poll, result, consent, post |
| 1c · Browse | cloud | Map with sheet, Place (Notice), Today feed that ends, Journal (my Listens) |
| 1d · Device | David or Noah | EAS builds, TestFlight and Play internal; the success-criteria checks on phones, against staging once it exists |
| 2 · Field-ready | later specs | Push (portal migration first), offline queue, Understand and Steward depths, species pages, share cards, accessibility pass, store launch |

The implementation plan written after this spec is reviewed breaks 1a to 1c into tasks. Each task names
its test, so cloud sessions can run it unattended.

## 6. Out of scope

- Any portal backend change (Phase 2, in magora-portal).
- On-device identification, widgets and iNaturalist write-back (Summary Phase 3).
- Store listings and accounts. Store identity is Noah's call (the name "Magora" is settled).
- A licence file (D-1).

## 7. Risks

- **Fonts.** Prodiga in a public repo is a published font file. Same rule as the portal spec §3: check
  that the licence allows it, or supply the file at build time.
- **Schema drift.** The pin can lag the portal. Contract tests fail when the pinned schema and the app
  disagree. Bumping the pin is a routine PR.
- **The interim contract schema drifts from production** until the Spec 2 baseline lands (§4.2). It
  covers only the contract's objects, and is replaced at the first pin bump after the baseline.
- **Fakes drift from the real worker.** The fakes are written from the contract, not from the worker's
  code. The first device check against staging (1d) is where that is caught.
