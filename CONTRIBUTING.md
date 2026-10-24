# Contributing to magora-portal

Licensing and the DCO/CLA question are **pending** (`docs/superpowers/specs/2026-10-15-repo-harness-design.md` §8.1). Until they are settled, we are not
inviting outside contributions.

## Workflow

1. Fork the repo and branch from `main`.
2. Make your change; run the checks below.
3. Open a PR to `main` and fill in the template, including whether you changed control files.
4. A maintainer applies the depth label (forks cannot add labels) and, for a first-time
   contributor, approves the workflow run after reading the change.
5. If your branch falls behind `main`, update it (merge or rebase `main`); that re-runs CI.

A maintainer merges once the required checks pass and review threads are resolved.
Vercel will not build a preview for a fork PR, and maintainers will not authorize one: previews
currently run against production. Your PR is reviewed from CI and the diff.

## Running the checks locally

macOS and Windows (PowerShell or cmd) use the same commands; every check is a Node script.

    npm ci
    npm test
    npm run lint:ratchet
    npm run build
    npm run check:migrations
    npm run check:deno        # needs Deno 2.9.5

## If label-gate shows "cancelled"

The latest label-gate run on your head must finish. If it was cancelled, ask a maintainer to re-run the job from the
PR's Checks tab, or to remove and re-add the depth label.

## Agents

See `AGENTS.md`. It applies to your agent too.
