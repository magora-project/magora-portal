# Runbook — advancing the `release` pointer

**Applies to:** `magora-acoustic-biodiversity`, branch `release`.
**Created:** 2026-08-04.

## What it is

Everything an external builder's node touches at first boot comes from `release`, never `main`:

| What | Fetched from | Where it's set |
|---|---|---|
| `detect.py` | an exact SHA | `DETECT_SHA` in `magora-firstrun.sh` |
| `birdnet.service` | `release` | `magora-firstrun.sh` |
| `BUILD.md` (rendered on `/add-node`) | `release` | `BUILD_DOC_REF` default in `scripts/vendor-build-doc.mjs` |

## Why not `main`, and why not a frozen SHA

Bare `main` couples every unverified commit to a stranger's first-boot experience, and makes a
failure unreproducible — by the time they report it, `main` has moved. A frozen SHA is the opposite
failure: it rots silently, and an edit to `BUILD.md` never reaches the page, which is the drift the
whole vendoring mechanism exists to prevent. (The `DETECT_SHA` pin was already four commits stale
when this was written.)

`release` is the middle: **it only advances after the walkthrough has been re-verified against it.**
Reproducible *and* fresh. Editing `BUILD.md` still takes exactly one edit; it reaches builders when
someone has confirmed the guide still works.

## ⚠️ Current status

`release` = `5a6cd4f`, created 2026-08-04. **It has NOT yet been verified against real hardware** —
no node has been built on the promoted USB path by anyone. The pointer is currently a stability
guarantee (it won't move under a builder mid-build), not a correctness one. The first genuine
advance should follow the first successful end-to-end build.

## Advancing it

Do not fast-forward `release` casually — the point is that moving it is a deliberate act.

1. **Re-verify the walkthrough against the candidate commit.** Not a code review — actually follow
   `BUILD.md` end to end: flash, boot, and confirm a first detection appears. At minimum, if the
   change is documentation-only, re-read the affected steps against the current firmware.
2. **Advance the pointer:**
   ```bash
   git checkout release && git merge --ff-only main && git push origin release
   ```
   Use `--ff-only`: `release` must always be an ancestor-consistent pointer into `main`, never a
   divergent branch with its own commits.
3. **If `detect.py` changed**, bump `DETECT_SHA` in `magora-firstrun.sh` to the verified SHA, and
   remember `magora-firstrun.sh` is **baked into the image** — rebuild and re-release the image, or
   the change reaches nobody.
4. **Redeploy the portal** so `/add-node` re-vendors `BUILD.md` from the new pointer. Vercel
   auto-deploys from `main`; an empty commit is enough if the portal itself didn't change.
5. **Confirm** the live page shows the change: `curl -s https://magora-portal.vercel.app/assets/*.js
   | grep "<something you edited>"`.

## Rolling back

`release` is a branch pointer, so a bad advance is reversible without touching `main`:

```bash
git checkout release && git reset --hard <last-good-sha> && git push --force-with-lease origin release
```

Then redeploy the portal to re-vendor. Any node that boots after the reset gets the good version;
nodes already provisioned are unaffected, because they fetched at their own first boot and don't
re-fetch.
