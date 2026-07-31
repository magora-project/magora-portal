// Node Offline Detection v1 — heartbeat model.
//
// The implementation moved to `shared/heartbeat.js` so the browser can import it too: everything
// under `api/` is proxied to the deployed app during `npm run dev` (see vite.config.js), so a
// client-side import from here comes back as HTML and breaks the app in dev. This module stays as
// the detector's import path — one model, one definition of "offline", both sides.
export {
  HEARTBEAT_CONFIG,
  readK,
  median,
  deriveExpectedIntervalSeconds,
  deriveStatus,
} from '../../shared/heartbeat.js'
