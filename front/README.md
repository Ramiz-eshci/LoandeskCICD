# LoanDesk — Angular client

Latest Angular (v20, standalone + signals) front-end whose structure mirrors the
LoanDesk Node/Express API in `../api`. Plain HTML + minimal CSS only — no
Bootstrap, Material, DevExtreme, or any UI framework.

## Run

```bash
npm install
npm start          # ng serve -> http://localhost:4200
```

Point the API base URL in `src/environments/environment.development.ts`
(default `http://localhost:3400/api`). Make sure the API's `CORS_ORIGINS`
includes `http://localhost:4200`.

## Structure

```
src/app/
  core/                     framework-level, app-wide singletons
    constants/              API endpoint map (mirror of api/app.js mounts)
    models/                 ApiResponse envelope, auth models
    crypto/                 transport encryption (RSA + AES-GCM)
      crypto.util.ts          Web Crypto primitives (wire-compatible w/ api)
      crypto-session.store.ts AES key kept in memory only
      crypto.service.ts       handshake + seal/open
      crypto.interceptor.ts   seals requests / opens responses / re-handshakes
    auth/                   token store, auth service, guard, bearer interceptor
    http/                   generic CrudService base for CRUD domains
    interceptors/           error interceptor (401 -> login)
  layouts/main/             authenticated shell (sidebar + header + outlet)
  features/                 one folder per API domain (lazy-loaded)
    auth/login              working login (JWT + refresh cookie)
    example/                working: ping / echo / whoami / secure
    category/ client/ manufacturer/ model/ list/ status/
    user/ dashbord/ reports/ audit/     CRUD skeletons wired to the API
  app.config.ts             DI + interceptor chain + boot initializer
  app.routes.ts             top-level lazy routes
```

## Transport encryption (matches the API, INED-AI wire format)

When the API runs with `ENCRYPTION_ENABLED=true`:

1. On first request the client `GET /crypto/public-key` (RSA-2048 SPKI).
2. It generates a random **AES-256** key, RSA-OAEP(SHA-256)-wraps it, and
   `POST /crypto/session` to get a `sessionId`.
3. Every later request carries `X-Session-Id`; JSON bodies and success
   responses use **AES-256-GCM** (12-byte IV, 16-byte tag) inside the envelope
   `{ encrypted, data, meta:{ iv, tag } }`.
4. On a typed session error (`CRYPTO_SESSION_EXPIRED`, etc.) the interceptor
   re-handshakes and retries once.

When `ENCRYPTION_ENABLED=false` the client detects it from `/crypto/public-key`
and sends plain JSON. **No change needed on the Angular side to switch modes.**

### No secrets on the client
- The **AES session key** exists only as a **non-extractable** `CryptoKey` in
  memory. It is never persisted, serialised, or logged.
- Only the opaque `sessionId` UUID is kept in `sessionStorage`.
- The **access token** is kept in memory only (not localStorage); session
  continuity comes from the API's httpOnly refresh cookie via `/auth/refresh`.
- `environment.ts` holds only the public API base URL — no keys.
