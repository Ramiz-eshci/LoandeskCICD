# LoanDesk CI/CD – setup guide

Workflow: `.github/workflows/deploy.yml`

```
push development / production
   └─ 1. API      npm ci → backup → stop pool → copy code → write api\.env → start pool → /api/health
        └─ 2. Angular   set apiBaseUrl → ng build --base-href /app/ → backup → empty \app → copy
             └─ 3. React     write VITE_* → build → backup → clean root (keep web.config, api, app, MailAPI…) → copy → health check
pull_request → development / production
   └─ PR build check only (GitHub-hosted runner, server never touched)
```

If a job fails, the next one does not run. If the API health check fails, the API is rolled back automatically.

---

## 1. GitHub Environments

Repo → **Settings → Environments** → create two environments, named exactly like the branches:

| Environment | Branch | Runner label | Server |
|---|---|---|---|
| `development` | `development` | `loandesk-development` | your local IIS now → UAT server later |
| `production`  | `production`  | `loandesk-production`  | live server |

Moving development from local IIS to UAT = install the runner on the UAT server with label `loandesk-development`, remove it from your PC, update the variables below. Workflow stays the same.

Optional: on `production` add **Required reviewers** so every prod deploy needs a click to approve.

---

## 2. Variables (Environment → Variables) – not secret

### Deployment
| Name | Required | Example (local) | Notes |
|---|---|---|---|
| `IIS_SITE_ROOT` | ✅ | `C:\inetpub\loandesk` | Folder where root web.config, `api`, `app` live |
| `IIS_APP_POOL` | ✅ | `LoanDesk` | App pool of the site (iisnode runs the API inside it) |
| `SITE_URL` | ✅ | `https://localhost` | Used for health checks (`/`, `/app/`, `/api/health`) |
| `BACKUP_ROOT` | | `C:\deploy-backups\loandesk-development` | Default shown. Must be outside the site root |
| `BACKUP_KEEP` | | `10` | How many backup zips to keep per part |
| `ROOT_KEEP` | | `MailAPI,.well-known,aspnet_client` | Extra root items never deleted (web.config, api, app are always kept) |
| `HEALTH_SKIP_CERT` | | `true` on local only | Skip TLS check for self-signed local cert |
| `RUN_MIGRATIONS` | | `false` | `true` = run `node cli.js migrate` before API restart |

### React landing page
| Name | Example |
|---|---|
| `VITE_APP_LOGIN_URL` | `https://loandesk.example.com/app/login` |
| `VITE_SALES_EMAIL` | `sales@example.com` (optional) |

### API `.env` (non-secret)
Empty/missing = not written, app default applies.

| Name | Suggested value |
|---|---|
| `NODE_ENV` ✅ | `production` (also on UAT – enables boot guards) |
| `HOST` | *(leave empty – iisnode uses a named pipe)* |
| `DB_PORT` | `1433` |
| `DB_ENCRYPT` | `true` |
| `DB_TRUST_SERVER_CERT` | `true` |
| `DB_POOL_MAX` / `DB_POOL_MIN` / `DB_POOL_IDLE_MS` | `10` / `0` / `30000` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` |
| `REFRESH_COOKIE_NAME` / `REFRESH_COOKIE_PATH` / `CSRF_COOKIE_NAME` | `ld_refresh` / `/api/auth` / `ld_csrf` |
| `PASSWORD_RESET_TTL_MINUTES` | `60` |
| `ENCRYPTION_ENABLED` | `true` / `false` |
| `CRYPTO_SESSION_TTL_SECONDS` | `1800` |
| `CORS_ORIGINS` ✅ | `https://loandesk.example.com` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `60000` / `300` / `10` |
| `JSON_BODY_LIMIT` / `UPLOAD_BODY_LIMIT` | `2mb` / `100mb` |
| `MAX_UPLOAD_SIZE` | `20971520` |
| `ALLOWED_EXTENSIONS` | same as current .env |
| `EMAIL_HOST` / `EMAIL_PORT` | smtp host / `465` |
| `FRONT_URL` | `https://loandesk.example.com/app/` |
| `OTP_DEFAULT_ENABLED` | `false` on prod |
| `OTP_LENGTH` / `OTP_TTL_SECONDS` / `OTP_MAX_ATTEMPTS` | `6` / `300` / `5` |
| `IS_LOGIN_OTP_SENT_MOBILE` / `IS_LOGIN_OTP_SENT_EMAIL` | `false` / `true` |
| `OUTLOOK_MAILBOX` | mailbox address |
| `EMAIL_FILTER_FROM` / `EMAIL_FILTER_SUBJECT` | as current .env |
| `GRAPH_WEBHOOK_URL` / `GRAPH_LIFECYCLE_URL` | public https URLs of this env |
| `GRAPH_SUBSCRIPTION_MINUTES` / `GRAPH_AUTO_RENEW` | `1440` / `true` |
| `ANTHROPIC_MODEL` | as current .env |

---

## 3. Secrets (Environment → Secrets)

| Name | Required | Used by |
|---|---|---|
| `ANGULAR_API_BASE_URL` | ✅ | Angular `environment.ts` → `apiBaseUrl`. Use **`/api`** (see note) |
| `VITE_API_BASE_URL` | ✅ | React landing page, e.g. `/api` or `https://loandesk.example.com/api` |
| `DB_HOST` | ✅ | api\.env |
| `DB_USER` | ✅ | api\.env |
| `DB_PASS` | ✅ | api\.env |
| `DB_NAME` | ✅ | api\.env |
| `JWT_SECRET` | ✅ | api\.env |
| `JWT_REFRESH_SECRET` | ✅ | api\.env |
| `SECRET_KEY` | ✅ | api\.env |
| `CRYPTO_SESSION_MASTER_KEY` | ✅ if `ENCRYPTION_ENABLED=true` | api\.env (32 bytes base64 / 64 hex) |
| `EMAIL_USER` | | api\.env |
| `EMAIL_PASS` | | api\.env |
| `OTP_DEFAULT_CODE` | | api\.env (leave empty on prod) |
| `MS_TENANT_ID` | | api\.env |
| `MS_CLIENT_ID` | | api\.env |
| `MS_CLIENT_SECRET` | | api\.env |
| `GRAPH_CLIENT_STATE` | | api\.env |
| `ANTHROPIC_API_KEY` | | api\.env |

> **Angular note:** the `/app` Content-Security-Policy in web.config has `connect-src 'self'`, so the Angular API URL must be same-origin. `/api` is the right value; a different host would be blocked by the browser.

Bulk upload with GitHub CLI (from a local .env-style file, never commit it):
```powershell
gh secret set -f secrets.development.env --env development
gh variable set -f vars.development.env --env development
```

---

## 4. Server (self-hosted runner) prerequisites

1. Install a GitHub Actions runner on the Windows server (Repo → Settings → Actions → Runners → New self-hosted runner → Windows).
   During `config.cmd` add label **`loandesk-development`** (or `loandesk-production`).
2. Run the runner service as an account that is **local Administrator** (needed for `WebAdministration` stop/start app pool and writing to the site folder). The default `NETWORK SERVICE` account cannot do this.
3. IIS features already used by the site: URL Rewrite, iisnode, Node.js installed.
4. Git for Windows installed (for `actions/checkout`).
5. Existing `api\.env` on the server will be **replaced** by the generated one on the first run – copy its values into GitHub first. The previous `.env` is kept in `BACKUP_ROOT\api\env_<stamp>.env`.

## 5. Repo housekeeping

- Create branches `development` and `production` (repo only has `main` now).
- Remove `/website/package-lock.json` from the root `.gitignore` and commit `website/package-lock.json` (reproducible builds; the workflow falls back to `npm install` until then).
- Branch protection on `production`: require PR + passing "PR build check".

## 6. Manual restore

Backups: `BACKUP_ROOT\api\api_<stamp>.zip`, `BACKUP_ROOT\app\app_<stamp>.zip`, `BACKUP_ROOT\website\website_<stamp>.zip`.
Unzip into the matching folder (`api`, `app`, or site root) and recycle the app pool.
