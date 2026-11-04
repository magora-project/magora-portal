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

## Prerequisites

Process rules: [.claude/rules/process.md](.claude/rules/process.md).

- Claude Code, with the Superpowers plugin installed (`/plugin install superpowers@claude-plugins-official`): plans
  execute through its `subagent-driven-development` skill. Its `brainstorming` and `writing-plans` are replaced by the
  repo's own copies.
- Codex CLI, signed in
- Semgrep
- Node 24 (see `.nvmrc`)
- Deno 2.9.5
- `gh`, the GitHub CLI
- A Gemini key from the Gemini account David set up (D-15)

## First run

    npm ci
    npm run setup:hooks

Then start Claude Code in the repo and check that `/skills` lists `brainstorming` and `writing-plans` as project skills,
and `superpowers:subagent-driven-development` from the plugin.

## Fork PRs (maintainers)

A fork's content is untrusted code, and supplying its evidence runs it on your machine: conformance runs the plan's
`command` targets, `npm test` runs its tests, and the evidence push runs `.githooks/pre-push`. Almost any changed file
can execute: modules the tests import, lint and build configs, dependencies `package-lock.json` pulls in on `npm ci`,
the `.claude/` settings, hooks and skills an agent session loads, and, with `core.hooksPath=.githooks`, a fork's
`.githooks/post-checkout` on checkout itself. So read the PR's **whole** diff before checking the branch out (on the PR
page, or `git fetch` then `git diff`, which run none of it), and before any install, test, lint, build, agent session or
push from that checkout (spec §5.3, D-11).

## If label-gate shows "cancelled"

The latest label-gate run on your head must finish. If it was cancelled, ask a maintainer to re-run the job from the
PR's Checks tab, or to remove and re-add the depth label.

## Agents

See `AGENTS.md`. It applies to your agent too.
