# claude-b unlink inventory (Task 8, D-12)

Status: **approved and applied.** David approved the proposal 2026-11-03 (Task 8 Step 2; rulings
at the end). David ran Step 3 the same day: `claude-b-freeze.sh` read back PASS.
Listed 2026-11-03 with `find ~/.claude-b -maxdepth 1 -type l`: 12 links, as V7 expects.

Kept layer (spec §5.7): secrets handling, machine safety and local guards, push approval, shell and
platform rules. Removed: personal skills that share a name with a repo skill, and process rules now
in `.claude/rules/process.md`.

## Links

The `Original target` column is each link's target before the unlink. Since Task 8 Step 3, the 11
links other than `plans` point into `~/.claude-b-config` instead.

| Link | Original target | Action | Notes |
|---|---|---|---|
| `CLAUDE.md` | `~/code/claude-config/CLAUDE.md` | copy-trimmed | See "CLAUDE.md trim" below. |
| `settings.json` | `~/code/claude-config/settings.json` | copy-trimmed | Copied before any edit (today it **is** claude-config's file). See "Hooks". |
| `hooks` | `~/code/claude-config/hooks` | copy-trimmed | See "Hooks". |
| `skills` | `~/code/claude-config/skills` | copy-trimmed | Drop `brainstorming`, `writing-plans`, `codex-review`, `push-readiness` (repo names; `conformance` has no personal copy). |
| `scripts` | `~/code/claude-config/scripts` | copy-whole | The kept hooks call these (push gate, `mark-reviewed.sh`, `hjq`). |
| `agents` | `~/code/claude-config/agents` | copy-whole | Executor and compactor agents; no repo overlap. |
| `commands` | `~/code/claude-config/commands` | copy-whole | `startup`, `winddown`, `close-task`, `daily-reflection`. |
| `output-styles` | `~/code/claude-config/output-styles` | copy-whole | |
| `plugins` | `~/code/claude-config/plugins` | copy-whole | superpowers stays installed; the repo's `skill-shadow.mjs` routes its same-name skills to the repo copies. |
| `.mcp.json` | `~/code/claude-config/.mcp.json` | copy-whole | |
| `reflections` | `~/code/claude-config/reflections` | copy-whole | Personal data, not process. |
| `plans` | `~/code/claude-memory/plans/claude-b` | **keep linked** | Storage, not process: how approved plans survive a crashed session (Q3). The only link that still points outside `~/.claude-b-config` after Step 3. |

## Hooks (settings.json wiring)

| Hook | Action | Where the rule now lives |
|---|---|---|
| `push_review_gate.sh`, `merge_approval_gate.sh` | keep | push approval |
| `secrets_policy_reminder.sh` | keep | secrets |
| `destructive_bash_check.sh`, `settings_local_json_safety.sh`, `tmp_scratch_path_check.sh`, `heavy_job_gate.sh`, `disk_pressure_gate.sh`, `enospc_capture.sh`, `swarm_isolation_gate.sh` (3 matchers), `unicode_separator_guard.sh`, `parked_checkout_notice.sh` | keep | machine safety and local guards |
| `governed_write_baseline.sh`, `governed_write_attribute.sh`, `governed_write_notice.sh` | keep | local guard (auto-mode governed paths) |
| `context_nudge.sh` | keep | session ergonomics, not process |
| `spec_plan_threshold.sh` | drop | `.claude/hooks/lane-threshold.mjs`; `process.md` § Lanes |
| `spec_review_reminder.sh`, `plan_edit_review_reminder.sh` | drop | `process.md` § Stages, § Review slots and dispatch |
| `skill_override_audit.sh`, `canonical_source_propagation_reminder.sh` | drop | claude-config maintenance; `process.md` § Promotion |

## CLAUDE.md trim

| Section | Action | Where it now lives |
|---|---|---|
| Secrets | keep | — |
| Shell, files and output | keep | — |
| Session state, push and worktrees | keep | — |
| TL;DR item 4 (push approval) | keep | — |
| Review, merge and gating status | drop | `process.md` § Review slots and dispatch, § What blocks |
| Skill editing, MERGING≠DEPLOY, plan-first skill rewrites | drop | `process.md` § Promotion |
| Maintaining this file | drop | claude-config only |
| Model routing, Defaults, Escalate to Opus, Subagent routing, Context quality | keep (Q1) | — |
| Verify-against-source (18 surfaces) | keep (Q1) | — |
| Playbook and Moment entries: Secrets, GitHub-auth, Local-guards, Before-push | keep, inlined (Q2) | — |
| Every other Playbook, Moment and Index pointer | drop (Q2) | — |

## Rulings (David, 2026-11-03)

- **Q0 + Q2: rewrite and inline.** Every kept file stops reading live claude-config, as below.
- **Q1: keep both.** Model routing and verify-against-source stay in claude-b. Spec §5.7's kept-layer
  list is amended in PR A to name them: personal working discipline, not repo process.
- **Q3: `plans` stays a link.** Spec §5.7 is amended in PR A to except it as storage. Step 4's
  read-back expects it as the one link outside the clone.
- **Q4: keep the Shuksan-only skills.** Only the four repo-named skills are dropped.

## How the freeze is built: a frozen clone (David, 2026-11-03)

Sizing showed that copying the links could not freeze claude-b. Beyond hooks and scripts, the
kept files also read claude-config's `.venv`, `CLAUDE-PROCEDURES.md`, `CLAUDE_HANDOFF_DOC.md`,
`docs/` and `.claude/`: 65 script files, 16 hooks and 26 skill files in all. David chose a frozen
clone instead:

- **Clone:** `~/.claude-b-config` is a clone of claude-config `5dda99a8` (local `main`; origin
  could not be fetched), on the local branch `claude-b-frozen`. Its remote is
  `local-claude-config`.
  - `8357f2e2` rewrites `code/claude-config` to `.claude-b-config` in every tracked text file
    outside `docs/` and `reflections/`. The match is word-bounded, so sibling names such as
    `claude-config-compact` are kept: 133 files.
  - `1e280679` makes the trims above: 4 skills, 5 hook wirings (23 → 18 hook entries), and
    `CLAUDE.md`. Its pointers resolve into the clone's own `rules/`, which are frozen too, so the
    rule text is not inlined. That supersedes Q0's "inline" part.
- **Untracked state:** `plugins/` and `.venv/` were copied in with their absolute paths repointed.
  The venv's Python now resolves to the clone.
- **Checks run 2026-11-03:**
  - Every one of the 18 wired hooks runs from the clone with a harmless payload (exit 0, no
    missing-file errors).
  - Frozen and live `destructive_bash_check.sh` and `push_review_gate.sh` respond identically to a
    deny payload. Neither returned a JSON decision for that payload shape, so this did not prove
    the deny path. Task 9 did not run either hook with a deny payload either. Later on 2026-11-03,
    a claude-b session rooted in this worktree saw `push_review_gate.sh` deny live: it blocked
    Bash calls whose text mentioned a push alongside a variable assignment (class c).
    `destructive_bash_check.sh`'s deny path is still unverified.
- **Known dangling pointer:** `skills/plan-reviewer/SKILL.md` names the dropped
  `skills/writing-plans/SKILL.md`.
- **Step 3:** David runs `bash ~/Desktop/claude-b-freeze.sh`. It writes
  `~/Desktop/claude-b-unfreeze.sh` (the rollback) first, repoints the 11 links into the clone,
  leaves `plans` alone, and reads back:
  - the links;
  - no runtime file names `code/claude-config`;
  - claude-config's working tree is unchanged;
  - every hook path exists.
- **Amended in PR A:** spec §5.7 (rev 6) and plan Task 8 Steps 3–4 now say this. The links stay
  symlinks, now into the frozen clone, and promotion is an all-or-nothing reviewed merge into `claude-b-frozen` that must not undo the
  freeze (spec §5.7; the check is plan Task 19 Step 5).
- **Trim commits** (the freeze check in plan Task 19 Step 5 reads this list; a later trim is
  added here with the reviewed change that makes it): `1e280679`.
- **Known mismatch (found 2026-11-04, not yet reconciled):** the clone's `CLAUDE.md` still has two
  Moment entries beyond the kept four (Session-start, Subagent-dispatch) and its `## Index`,
  which the table above lists as dropped. Either the table or the clone is wrong; David decides,
  before plan Task 19 Step 5 writes the freeze check.

## Questions as asked

- **Q0 (blocking): a copy freezes almost nothing as wired today.** `settings.json` invokes every hook
  as `$HOME/code/claude-config/hooks/<name>`, not through `~/.claude-b/hooks`, and the kept hooks call
  `~/code/claude-config/scripts/…`. `CLAUDE.md`'s rules are one-line pointers into
  `~/code/claude-config/rules/`. Copying the 12 links leaves claude-b running live claude-config.
  Proposal: in the frozen copies, rewrite `$HOME/code/claude-config/{hooks,scripts}` to
  `$HOME/.claude-b/{hooks,scripts}` (in `settings.json`, the kept hooks, and the copied scripts), and
  inline the kept rules' full text from `rules/core.md` into the frozen `CLAUDE.md`. Then check with
  `grep -r code/claude-config ~/.claude-b`, which should print nothing in a kept file.
- **Q1:** model routing and verify-against-source are not in the kept layer, and the repo does not
  carry them. Keep them in claude-b (and widen §5.7's list), or drop them?
- **Q2:** the Playbook, Moment and Index sections are pointers. Under Q0, inline the kept-layer
  entries (Secrets, GitHub-auth, Local-guards, Before-push) and drop the rest?
- **Q3:** `plans` points at `claude-memory`, not claude-config. Copy it as §5.7 says (losing the sync),
  or leave this one link in place?
- **Q4:** the Shuksan-only skills (`pitch-design`, `voice-pipeline`, `shuksan-studios`,
  `fleet-dispatch`, `audit-quick`, `review-fleet`) are irrelevant to a magora-only account. Keep them
  (the minimal change, which this proposal assumes), or drop them?
