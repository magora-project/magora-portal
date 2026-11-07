# Staging lease — design (Spec 2, PR D)

- **Date:** 2026-11-06
- **Status:** draft. The design David approved in the 2026-11-06 session, written up for review.
- **Resolves:** #47 item 2, the OPEN block in plan Task 26 (`docs/superpowers/plans/2026-10-28-staging-and-secrets.md`),
  which asks for the lease to be designed "in its own artifact before Task 20, as the first work of PR D".
- **Builds on:** Spec 2 §5.5 (`2026-10-28-staging-and-secrets-design.md`): one test session on staging at a time.

This document specifies; it implements nothing. Task 20 builds it, in PR D.

## 1. Why

Spec 2 §5.5 allows one migration test session on staging at a time, so one migration never passes
because another is still applied. Plan Task 26 holds that session as a lease in the repository Actions
variable `STAGING_HELD_BY`. As written there, the lease is not exclusive (Codex, 2026-10-29):

1. `claim` reads, sets and reads back, so two maintainers can both win.
2. GitHub deletes a variable by name only, with no delete-if-equal, so a late or repeated `release`
   can delete a newer lease.
3. Nothing defines recovery from a stranded lease (a crashed session, a lost value) or from a variable
   whose value is empty, which blocks every claim while workflows read it as unheld.
4. Two sessions on one machine under one GitHub login must not share a proof.

## 2. Threat model

The lease guards against maintainers' mistakes and races, not against an adversary. Anyone who can
run `claim` can read the variable and could delete it by hand. The value carries no secret.

## 3. Design

### 3.1 The value

A held lease is the variable `STAGING_HELD_BY` with the value `<login>:<id>`:

- `<login>` is the holder's GitHub login, matching `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`.
- `<id>` is 32 lowercase hex characters from `crypto.randomBytes(16)`, new for each claim.

A value that does not match `^<login>:[0-9a-f]{32}$` (empty included) is **malformed**.

The `<id>` is what binds a session to its lease. `claim` prints the whole value once; the session keeps
it in its notes. No file on disk holds it, so two sessions on one machine and one login share nothing.
No command fills the value in by reading the variable.

### 3.2 `scripts/staging/lease.mjs`

Every GitHub call goes through an injected `gh(method, path, body?) -> {status, json}`, so the tests
use a fake. The CLI passes a real one built on `gh api`. The repository is the one `gh` resolves for the
checkout; the variable endpoints are `repos/{owner}/{repo}/actions/variables[/STAGING_HELD_BY]`.

**`claim(login)`**

1. Refuse a login that does not match §3.1.
2. Make the value, then **create** the variable: `POST …/actions/variables` with
   `{name: "STAGING_HELD_BY", value}`.
3. `201`: print the value and say "keep this value; release needs it". Exit 0.
4. `409`: the lease exists. `GET` it and print its value (or "malformed: `<value>`") and `created_at`.
   Exit 1.
5. No response, or any other status (a timeout can hide a create that succeeded): `GET` the variable.
   - It holds this claim's value: the claim won. Do step 3.
   - It holds another value: do step 4.
   - It does not exist (404): print "claim did not complete; run claim again" and exit 1.
   - The `GET` fails too: print the value this claim tried, say the outcome is unknown, and exit 1. A
     later `status` shows whether it holds; the session may adopt it only if it does.

`claim` never falls back to `PATCH`, `PUT` or `gh variable set`, all of which overwrite.

**`release(value)`**

1. Refuse a malformed `value`.
2. `GET` the variable. `404`: print "not held" and exit 1. A value different from `value`: print
   "held by `<current>`; not yours" and exit 1.
3. Equal: `DELETE …/actions/variables/STAGING_HELD_BY`. `204`: exit 0. Anything else: exit 1.

So a repeated release finds no lease or someone else's, and refuses. A late release after another
claim finds the other value and refuses.

**`status()`** prints the value (marking a malformed one), `created_at`, and its age, or "not held".

**`break({expect, holderConfirmed})`** removes a stranded or malformed lease.

1. `GET` the variable. `404`: print "not held" and exit 0.
2. Its value differs from `expect`: refuse, printing the current value. `expect` may be the empty
   string, to break an empty variable.
3. Its `created_at` is under 12 hours old and `holderConfirmed` is false: refuse. The flag
   `--holder-confirmed` states that the holder agreed in the maintainers' channel; the runbook says to
   post that agreement first.
4. Otherwise `DELETE` it. `204`: exit 0.

The lease is never updated in place, so `created_at` is the claim time.

**`admit({event, held, holder}) -> boolean`**, used by the workflow's `admit` job:

| `held` | `schedule` | `workflow_dispatch` |
|---|---|---|
| `''` | true | true |
| a well-formed value | false | true only if `holder === held` |
| a non-empty malformed value | false | false |

`held` is `vars.STAGING_HELD_BY`, which is `''` both when the variable is absent and when its value is
empty. Admitting a refresh in both cases is safe: an empty variable blocks every claim, so no session
can be in progress. The workflow's `holder` input is the whole value, so only the session that holds it
can dispatch a refresh while it is held.

### 3.3 Residual risk (accepted)

`release` and `break` read and then delete; GitHub offers nothing atomic. If, between session A's read
and delete, someone breaks A's lease and B claims, A deletes B's lease. This needs a `break` of a live
lease at the moment its holder releases it, which `break`'s 12-hour rule and the channel agreement make
unlikely. A deleted lease is visible: B's `release` then refuses with "not held", and B re-claims.

## 4. Before Task 20: a one-time probe (operator)

Plan Task 26 records that GitHub's REST reference documents only `201` for creating a variable. Before
Task 20 is implemented, a maintainer with write access to repository variables runs, once, against
names no workflow reads:

1. `POST` `LEASE_PROBE_<random>` with value `x`. Expect `201`.
2. `POST` the same name again. Record the status and body; the design requires `409`.
3. `GET` it. Record that `created_at` is present.
4. `POST` `LEASE_PROBE_<random>_EMPTY` with value `''`. Record `201` or the refusal. If GitHub refuses
   an empty value, a variable can still be emptied in the web UI, so the malformed rules stay.
5. `DELETE` both. Expect `204`.

The results go in the PR D description. If step 2 does not return `409` (for example, the create
overwrites), stop: the design does not hold and comes back here.

## 5. Tests (`scripts/staging/lease.test.mjs`)

All against the fake `gh`, which keeps one variable store and can delay or drop responses.

- The six `admit` cells in §3.2's table, plus a dispatch with an empty `holder` while held.
- Interleaved claims: two claims race; exactly one gets `201`, and the other exits 1 and prints the
  winner's value.
- A claim whose `POST` response is lost: each branch of step 5 (won, lost, absent, unknown).
- `release` with the matching value deletes; a repeated release refuses; a release after another
  session's claim refuses and leaves that lease in place; a malformed value is refused before any call.
- `break`: a value mismatch refuses; a lease under 12 hours old refuses without `--holder-confirmed`
  and is deleted with it; an old lease is deleted; `expect ''` breaks an empty variable.
- No code path issues `PATCH` or `PUT`: the fake fails the test on either.

Each test must fail when the rule it covers is removed from `lease.mjs` (sabotage, as the plan requires
of guards).

## 6. Out of scope

- Automatic expiry. A stranded lease waits for `break`.
- Locking staging against anything but this repository's refresh workflow and the runbook's session.
- Secrecy of the value (§2).
