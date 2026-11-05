# Villa Magora firstrun debugging handoff

Date: 2026-11-04  
Scope: bench Raspberry Pi debugging, firmware provisioning, Add Node configuration, Supabase ingestion  
Purpose: handoff for Claude review and continuation

## Summary

Villa Magora was provisioned successfully and BirdNET became active on 2026-11-04 at 19:22 UTC. Authentication to Supabase succeeds, regular ACI heartbeats are present, and detections are being written. However, `nodes.last_seen_at` remained `null`, matching the related stale-`last_seen_at` symptom seen on Blue Bird Ranch.

The firstrun failure mode was compounded by provisioning reliability bugs. Add Node did not include a per-node SSH password, downloaded firmware targets were truncated before curl/wget success was known, network readiness was inferred from ping rather than HTTPS, and environment repair fetched requirements from the stale release pointer where that file does not exist.

Stage 2 fixes were implemented on separate branches and submitted as pull requests.

## Bench node

- Node name: Villa Magora
- Node ID: `7fe2f0d2-932a-404a-9c83-cbdd6a837ee9`
- Ethernet: `192.168.137.208`
- Wi-Fi: `192.168.1.99`
- Firstrun completed: 2026-11-04 19:22 UTC
- `birdnet.service`: active, zero service restarts reported during firstrun verification

## Stage 1 findings

### Pi logs

`journalctl -u birdnet -n 100` showed systemd successfully starting the service.

The BirdNET log contained:

- Successful Supabase sign-in.
- Continuous ACI activity beginning shortly after service startup.
- Detection activity, including Red-breasted Nuthatch and Virginia Rail.
- No authentication failure or HTTP error lines.

The most recent ACI timestamps shown at the inspection point were approximately one minute before the Pi clock's current time, demonstrating that ingestion was still occurring during debugging.

### Supabase production state

Read-only authenticated queries returned HTTP 200 for all three checks:

- `nodes.last_seen_at` was `null` for Villa Magora.
- Recent `aci_logs` existed and continued through `2026-11-04T20:49:46.448546+00:00`.
- Detections existed, including Virginia Rail detections at `2026-11-04T20:21:22.251814+00:00` and Red-breasted Nuthatch at `2026-11-04T19:34:33.418374+00:00`.

The node therefore has the same separation observed on Blue Bird Ranch: ACI heartbeat rows remain current while the `nodes.last_seen_at` snapshot does not.

No production Supabase writes were made during this investigation.

### Expected heartbeat update path

The intended path is:

1. The node posts continuous heartbeats to `aci_logs`.
2. The node-status cron reads the node's recent ACI timestamps.
3. `api/node-status-check.js` derives status and calls `record_node_status` through the Supabase RPC.
4. The RPC refreshes `nodes.last_seen_at` with the latest heartbeat and records status transitions where required.

The `record_node_status` migration updates `nodes.last_seen_at`, so the likely diagnosis is that the cron/RPC path has not run successfully or has not run for this node, rather than failure of the node's direct ACI writes.

## Code-confirmed provisioning findings

### SSH password missing from Add Node

`magora-firstrun.sh` reads `ssh_password` and sets the `pi` password with `chpasswd` when the field exists.

Without that field, firstrun intentionally leaves the account locked. The bench Pi's firstrun log confirmed both historical provisioning runs: an older run lacked `ssh_password`, while the later run logged that the SSH password was set.

The portal's `RegisterNode.jsx` `generateConfig()` function no longer included the field. Git history shows Add Node previously had a setup flow that preconfigured a password, but the current config flow changed to a custom-image/Pi Imager path and stopped generating `ssh_password`.

That removal was not because firstrun stopped supporting per-node SSH credentials. It was a consequence of the setup-flow change and left the current config flow incompatible with firstrun's still-supported SSH field.

### Download failure handling

The old firstrun implementation used `wget` without bounded timeouts and without reliable IPv4 forcing. It also used `wget -O`, which opens/truncates the destination before transfer completion. A failed transfer could leave a zero-byte unit file or incomplete firmware artifact.

This caused the following observed or plausible failure modes:

- Stalled IPv6 routes could block downloads for long periods.
- A failed detect download could leave its target incomplete.
- A failed `birdnet.service` download could leave `/etc/systemd/system/birdnet.service` empty, causing systemd to treat it as unusable/masked.
- Environment repair used `release/firmware/requirements.txt`; the release pointer does not currently include or advance to a commit containing that file, producing 404 only on that repair path.

### Network readiness

Firstrun previously used ICMP ping reachability as its network-up test. That is insufficient because an interface and default route can exist while HTTPS cannot be reached.

## Stage 2 changes

### Firmware PR

Repository: `magora-project/magora-acoustic-biodiversity`  
PR: https://github.com/magora-project/magora-acoustic-biodiversity/pull/7  
Branch: `fix/firstrun-safe-downloads`  
Commit: `4da5e1e`

Changes:

- Replace the ping test with IPv4 HTTPS reachability against raw GitHub.
- Replace firstrun `wget` calls with bounded `curl -4 -fsSL --connect-timeout 15 --max-time 120 --retry 3` calls.
- Download to temporary files beside the destination.
- Check curl exit status, then atomically move the completed file into place.
- Preserve existing targets after failures.
- Log clear errors and write a failed final verdict to the bootfs status file for connectivity, detect, service, and requirements failures.

### Portal PR

Repository: `magora-project/magora-portal`  
PR: https://github.com/magora-project/magora-portal/pull/65  
Branch: `fix/add-node-ssh-password`  
Commit: `2ee9b84`

Changes:

- Generate a cryptographically random 12-character SSH password in the browser.
- Add `ssh_password` to the generated `magora-config.json`.

## Validation performed

### Firmware

- `bash -n firmware/magora-firstrun.sh` passed.
- `git diff --check` passed.
- The firmware repository currently has no configured test suite.

### Portal

The portal checks passed:

- `npm test`
- `npm run lint:ratchet`
- `npm run build`

The portal build passed with only existing dependency-age and bundle-size warnings.

## Review and follow-up areas

Claude should review especially:

1. Whether the final HTTPS connectivity check uses the correct repository path and is not dependent on release/main drift.
2. Whether all temporary download paths are in writable locations and cleaned up on every exit path.
3. Whether failed requirements downloads should return immediately or continue in the existing environment-repair flow.
4. Whether final status lines cover the service-not-running verdict consistently.
5. Whether browser-side SSH password generation should use a modular PRNG strategy that avoids modulo bias; current requirements did not specify cryptographic strength, but `crypto.getRandomValues` is the intended improvement over `Math.random`.
6. Whether the generated SSH password should be displayed or separately copied to the operator before downloading the config, and whether it remains recoverable after config download.
7. The node-status cron: confirm why `last_seen_at` is null while ACI ingestion is healthy, including cron configuration, authorization, RPC permissions, deployed function code, and one-node test invocation.
8. The distinction between `last_seen_at` snapshot semantics and actual node liveness derived from recent `aci_logs`, so no fix conflates cron snapshots with heartbeat health.

## Safety constraints honored

- No production Supabase writes.
- No `supabase db push` or migration repair.
- No Pi service changes or file deletion during Stage 1.
- No Pi reflashing.
- Both fixes were committed only on separate feature branches.
- No PR was merged or production deployment initiated by this process.
