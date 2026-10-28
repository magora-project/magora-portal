# Secrets inventory

1Password is the source of every secret. This table lists each secret by name, its 1Password reference, and every store it is copied into. It holds names and references only, never a value.

Pre-filled from the repo (`api/`, `supabase/functions/`, `.github/workflows/`). David confirms each row and its Copies in Task 6 Step 6; `TBD (David)` marks a copy location the repo cannot show. `node scripts/secrets/inventory-check.mjs` compares this table with the name listings of every store in Copies. Rows marked Injected are provided by the platform and are not expected in a listing.

Copies: `vercel:production`, `vercel:preview`, `vercel:staging`, `github:<env>`, `fly:<app>`, `supabase-fn:<ref>`.

| Name | Environment (production/staging) | 1Password reference | Copies | Injected? |
|---|---|---|---|---|
| ANTHROPIC_API_KEY | production | op://Magora Project/anthropic/ANTHROPIC_API_KEY | TBD (David) | no |
| CRON_SECRET | production | op://Magora Project/vercel/CRON_SECRET | TBD (David) | no |
| EBIRD_API_KEY | production | op://Magora Project/ebird/EBIRD_API_KEY | TBD (David) | no |
| PROVISION_SECRET | production | op://Magora Project/supabase/PROVISION_SECRET | TBD (David) | no |
| SLACK_WEBHOOK_URL | production | op://Magora Project/slack/SLACK_WEBHOOK_URL | TBD (David) | no |
| SUPABASE_SERVICE_ROLE_KEY | production | op://Magora Project/supabase/SUPABASE_SERVICE_ROLE_KEY | TBD (David) | no |
| VITE_SUPABASE_ANON_KEY | production | op://Magora Project/supabase/VITE_SUPABASE_ANON_KEY | TBD (David) | no |
| VITE_SUPABASE_URL | production | op://Magora Project/supabase/VITE_SUPABASE_URL | TBD (David) | no |
| XENO_CANTO_API_KEY | production | op://Magora Project/xeno-canto/XENO_CANTO_API_KEY | TBD (David) | no |
| GEMINI_API_KEY | production | op://Magora Project/gemini/GEMINI_API_KEY | TBD (David) | no |
| SUPABASE_URL | production | op://Magora Project/supabase/SUPABASE_URL | TBD (David) | yes |
| VITE_SUPABASE_URL | staging | op://Magora Staging/supabase/VITE_SUPABASE_URL | TBD (David) | no |
| VITE_SUPABASE_ANON_KEY | staging | op://Magora Staging/supabase/VITE_SUPABASE_ANON_KEY | TBD (David) | no |
| VERCEL_AUTOMATION_BYPASS_SECRET | staging | op://Magora Staging/vercel/VERCEL_AUTOMATION_BYPASS_SECRET | TBD (David) | no |
