# Handoff to Chat — Add Node v1 + security remediation

**From:** Claude Code. **Date:** 2026-08-04.
**Covers:** Phase 0 credential-gate investigation → `PROVISION_SECRET` remediation → Add Node build
(TaskDef Items 0–5). Self-contained: Chat cannot read the repos, so everything needed is below.

**Repo state.** `magora-portal` `main` = **`99ec501`** (deployed — Vercel auto-deploys from `main`).
`magora-acoustic-biodiversity` `main` = **`5a6cd4f`**. Both clean, nothing in flight.
**Migration ledger head: `20260727`. Next free: `20260728`.**

---

## 1. Corrections to things previously believed true

**These matter more than the build work — prior documents assert each of them incorrectly.**

**1a. The Pis do NOT write via `service_role`.** They authenticate as per-node GoTrue users
(`node-<uuid>@magora.internal`), created by `provision-node`, with `nodes.id = <that auth user's
id>`. Ingest is constrained by RLS policies checking `(SELECT auth.uid()) = node_id`, INSERT-only,
no UPDATE or DELETE. `service_role` exists on a Pi nowhere; it appears only in the Fly.io worker.
**`✅ Where We Are` still asserts the `service_role` claim and needs correcting.**

**1b. `detections.node_id` / `aci_logs.node_id` did NOT lack a foreign key — they had the WRONG
one.** My Phase 0 report said "no FK to `nodes`". Both had carried
`FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE **CASCADE**` all along. Deleting one `nodes`
row would have silently erased that node's entire record — 194,508 detections + 164,369 ACI rows.
`20260725` called node DELETE "the worst case" and listed the cascading dependants, but **its list
omitted `detections` and `aci_logs`, the two tables that ARE the record.** Fixed in `20260727`.
Both my report and `20260725` missed this from opposite directions.

**1c. The Management API `/database/query` endpoint is READ-ONLY.** It executes DDL, returns
success, and persists nothing. It silently reported OK for `20260727` twice while the catalog was
unchanged. Any past claim of "applied via the Management API" is suspect. `supabase db query
--linked` is the writable path. Both this and the `VITE_` rule are now in the charter.

**1d. The overlay mismatch is resolved, and no hardware session is needed.**
`build/customize-image.sh` writes `dtoverlay=adau7002-simple`; `detect.py` opens `hw:adau7002,0`.
They agree. `hardware/WIRING.md` was the stale document (it said `googlevoicehat-soundcard`, which
nothing has ever used). Fixed. This was previously scoped as needing a real-device check.

---

## 2. Security work completed

**`PROVISION_SECRET` was publicly exposed for ~50 days.** The wizard passed it as
`import.meta.env.VITE_PROVISION_SECRET`; the `VITE_` prefix *means* "inline into the client
bundle", so the 64-char secret shipped in plaintext in `/assets/index-*.js`. `provision-node` runs
with gateway JWT verification off, so that secret was the only gate on unlimited `auth.users` +
`nodes` creation. **Second hole in the same place:** `owner_id` was caller-supplied and unverified,
so a secret-holder could mint nodes owned by *another person's* account.

**Resolved.** `api/register-node.js` now verifies the caller's session against GoTrue, derives
`owner_id` from the token (ignoring any body value), rate-limits to 5 nodes/account/7 days, and
holds the secret server-side. Secret rotated 2026-08-02 — old value returns 401, new returns 400.
Verified 7/7 against live production including a forged-`owner_id` test. 12 orphan node auth users
cleaned (development residue, not exploitation — none created after 2026-07-08). Runbook:
`docs/tasks/provision-secret-rotation-runbook.md`.

**Second SSH exposure found and fixed during the Add Node work.** `customize-image.sh` baked
`pi / magora123` into the public image with SSH enabled — a published credential on every node
built from it, including strangers' home networks. Now the account is created with a randomised
password whose plaintext is discarded, and firstrun sets a real one from a per-node `ssh_password`.

---

## 3. What shipped

**`magora-portal`** — `d746212` provisioning wrapper · `c8e1db7` rotation record · `bac926a`
`20260727` · `49f50e2` Add Node page · `99ec501` CTA repointing.

**`magora-acoustic-biodiversity`** — `5a6cd4f` `BUILD.md` + per-node SSH + Sheets mirror off +
`MIN_CONF` 0.25 + README/WIRING reconciles.

- **`20260727`** — CASCADE→RESTRICT + `NOT NULL` on both ingest tables. RESTRICT encodes
  place-over-people: a place that has spoken can no longer be deleted at all. Caller audit first —
  nothing in the codebase deletes `nodes` rows. Verified: NULL→23502, orphan→23503,
  delete-with-rows→23503 RESTRICT, valid insert still succeeds.
- **`BUILD.md`** — canonical build guide, promoted no-solder build (Pi 4 2GB + Movo M1 USB,
  ~$128–165), written for someone who has never opened a terminal. Includes the dataset-continuity
  note (Item 5). Reference INMP441 build kept as supported-not-promoted.
- **`/add-node`** — live. Renders `BUILD.md` vendored at build time. Anti-drift verified the strong
  way: "Movo", "$128" etc. appear nowhere in hand-written `src/`, only in the generated artifact.

---

## 4. Collision — my firmware work was superseded

I ran the Item 0 inventory against a stale local clone without fetching. `main` had already gained
five commits implementing USB auto-detection (`e05b4b9`…`0e028ec`). **Their implementation is
better than mine** — `/proc/asound/card<N>/usbid` is a definitive USB test where mine
pattern-matched `arecord -l` text; `plughw:` lets ALSA convert instead of hardcoding a format; it
retries for late-enumerating mics; and it needs no config field at all, making the `mic` field I'd
designed unnecessary. I discarded mine entirely and kept only the two changes `main` lacked
(`MIN_CONF` 0.25, `SCRIPT_URL` gating). Superseded work preserved on
`backup/superseded-usb-work`. **Chat should assume the firmware repo may move independently and
have Code fetch before scoping.**

---

## 5. Deviation needing sign-off

**The build-doc vendor tracks `main`, not a pinned SHA.** The TaskDef said "pinned SHA". Pinning
would mean a price edit in `BUILD.md` doesn't reach the page until someone *also* bumps a SHA in the
portal — a second edit, which is the drift the anti-drift rule exists to prevent, and it fails the
TaskDef's own verification #2. `BUILD_DOC_REF` overrides for reproducible historical builds. This is
deliberately unlike the firmware's `DETECT_SHA`, which stays pinned: a stale paragraph is cosmetic,
stale firmware on someone's hardware is not. **One-line change if the Architect disagrees.**

---

## 6. Open — blocked on Noah (physical/manual)

1. **UI click-through of the wizard.** Never run since the auth path changed during the security
   fix. Gates everything below. Sign in → register a throwaway place → confirm
   `magora-config.json` downloads with real `node_id`/`email`/`password` → node page renders.
2. **`ssh_password` field in the wizard** — held deliberately so it didn't move under (1). Small,
   additive. Until it lands, nodes boot with SSH locked (safe, but no remote debugging, and
   `BUILD.md` references a password not yet obtainable).
3. **Image rebuild + re-release.** `magora-firstrun.sh` and `customize-image.sh` are **baked into
   the image**, so none of the SSH hardening reaches builders until `build-image.yml` runs again.
   Sequence after (2). Release tag `latest` is mutable — a rebuild replaces it in place.
4. **Build one node on the USB path.** The only verification that can't be faked. The USB detection
   code has never run against real hardware by anyone in this thread.

---

## 7. Open decisions for the Architect

- **D1's second guard was never issued as work.** I recommended "a place appears on the map once it
  has spoken" (a node row surfaces publicly only after its first detection) as what makes self-serve
  registration safe without an approval queue. D1 locked self-serve; this guard didn't make it into
  a TaskDef. Worth deciding before external builders arrive.
- **`capture_chain` / `mic_model` on `nodes`** (`20260728`, additive). Item 5 flagged it as future.
  Recommend deciding *after* the INMP441-vs-M1 side-by-side at Casa Colibri, which will say whether
  the delta is worth modelling. Note `magora-config.json` carries no hardware field today, so a node
  cannot self-report its capture chain.
- **Credential-at-rest hardening (D3 roadmap).** Deferred correctly — blast radius verified small
  (insert-only, own node only, no update/delete). But there is still **no way to rotate a single
  node's credentials** short of hand-editing Supabase. I'd recommend an owner-only "re-issue this
  node's credentials" action on NodePage as the cheapest thing that turns a permanent accepted risk
  into a managed one.

---

## 8. Vault reconcile needed

- **`✅ Where We Are`** — the `service_role` heartbeat claim (§1a) is wrong; correct to the per-node
  GoTrue model.
- **Add the `20260727` cascade finding** (§1b) — it revises the `20260725` incident record, which
  understated the blast radius by omitting the two tables that matter most.
- **Ledger to `20260727`**, next free `20260728`.
- **Two new charter rules** (already in `docs/architecture/architect-charter.md`): never
  `VITE_`-prefix a secret; the Management API query endpoint is read-only, verify DDL against the
  catalog.
- **Node roster unchanged** — 3 rows, 2 live (Casa Colibri, Magic Lantern), birdnode11
  decommissioned with data retained. Now protected by RESTRICT.
