# Node contract inventory

The calls a field node makes to Supabase, plus the portal's registration call. The simulated node
script (plan Task 19) implements this table call-for-call. Auth values are named by kind only.

Pinned sources:

- **Firmware:** `magora-acoustic-biodiversity` at `5a6cd4f133ebd86c74a9b4f953a7b85e241f3640` (`origin/release`), file `firmware/detect.py`. Cited below as `detect.py:N`.
- **Portal:** `magora-portal` at `711b7c48c8e5cde3e8314bfc8af4bf3527d9199b`. Cited below as `provision-node:N` (`supabase/functions/provision-node/index.ts`) and `register-node:N` (`api/register-node.js`).

Auth kinds: `anon` (project anon key as `apikey`, and as bearer where noted), `node-jwt` (the `access_token` returned by sign-in, sent as bearer, with the anon key as `apikey`), `provision-secret` (the `x-provision-secret` header).

## Calls

| # | Method and path | Auth | Table / function | Payload fields | Source |
|---|---|---|---|---|---|
| 1 | `POST /auth/v1/token?grant_type=password` | anon (`apikey`; `Content-Type: application/json`) | Supabase Auth | body: `email`, `password`. Response used: `access_token`. | `detect.py:40-50` |
| 2 | `GET /rest/v1/nodes?id=eq.<node_id>&select=species_whitelist` | anon (`apikey` and `Authorization: Bearer <anon key>`) | `nodes` | none (query only). Response used: first row's `species_whitelist` (array or null); an empty array is treated as unset. | `detect.py:289-300` |
| 3 | `POST /rest/v1/detections` | node-jwt; headers `apikey`, `Authorization: Bearer <jwt>`, `Content-Type: application/json`, `Prefer: return=minimal` | `detections` | `node_id`, `species_name`, `raw_label`, `confidence`, `detected_at` (ISO 8601), `location` (`POINT(<lon> <lat>)`), `is_dawn_chorus`, `minutes_from_sunrise`, `dawn_chorus_window`, `phenological_week`, `season` | `detect.py:52-58`, `detect.py:105-120` |
| 4 | `POST /rest/v1/aci_logs` | node-jwt; same headers as row 3 | `aci_logs` | `node_id`, `recorded_at` (ISO 8601), `aci_score`, `time_category`, `dawn_chorus`, `duration_secs` (the node sends 15) | `detect.py:126-136` |
| 5 | Re-sign-in on 401 | node-jwt, then repeat | Rows 3 and 4 | When a POST to `detections` or `aci_logs` returns 401, the node repeats call 1, stores the new token, and sends the same POST once more. No second retry. | `detect.py:60-65` |
| 6 | `POST /functions/v1/provision-node` | provision-secret (`x-provision-secret` header; `Content-Type: application/json`) | Edge Function `provision-node` | body: `name`, `hardware_type`, `lat`, `lon`, `elevation_m`, `elevation_unit`, `habitat_type`, `species_whitelist`, `owner_id`. Required: `name`, `hardware_type`, `lat`, `lon`, `habitat_type`, `owner_id`. Optional: `elevation_m`, `elevation_unit` (`m` or else `ft`), `species_whitelist` (empty stored as null). Returns `{node_id, email, password}`; `node_id` equals the new auth user's id and the `nodes.id`. | `provision-node:21-24`, `35-53`, `83-98`, `104`; caller `register-node:87-105` |

Notes on row 6: the portal calls it from `api/register-node.js`, not the node. `owner_id` is set by the portal from the verified caller. The 401 re-sign-in loop (row 5) uses the credentials row 6 returned (`email`, `password`).

## Not in the contract

- No Storage calls.
- No RPC (`/rest/v1/rpc/...`) calls.
- No `/api` calls from the node.
- No heartbeat or last-seen write.
- No location write: the node's location is read-only after provisioning (the `location` field in row 3 is per-detection, not a `nodes` update).

## Known gap

`detect.py:32` hard-codes production's Supabase URL, which keeps real Pis out of scope for staging (spec §2). Only the simulated node script exercises this contract against staging.
