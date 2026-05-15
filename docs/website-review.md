# Roam CRM — Full Website Review

Date: 2026-05-15
Scope: Next.js 14 app at repo root (app router, NextAuth, Netlify Blobs, Brevo, OAuth integrations).

Findings are grouped by area and tagged **Critical / High / Medium / Low**. File:line refs included.

---

## 1. Security

### Critical
- **Non‑timing‑safe bearer comparisons** — `middleware.ts:62`, `app/api/sequences/route.ts:45`, `app/api/social/auto-generate/route.ts:35`, `app/api/debug/contact/route.ts:27`. All shared‑secret checks use `===` / `!==`. Use `crypto.timingSafeEqual` on equal‑length Buffers.
- **OAuth token in URL string** — `app/api/auth/meta/callback/route.ts:45`. `fb_exchange_token=${tokenData.access_token}` is interpolated into a URL; tokens end up in logs/history. Use `URLSearchParams` and POST where the provider allows.

### High
- **No upload validation** — `app/api/images/upload/route.ts`. No max size, no MIME allowlist. Add a size cap and an explicit `image/*` allowlist.
- **PII / verbose error logging** — `app/api/brevo/webhook/route.ts:44,67`, `app/api/sequences/route.ts:74` log full Brevo bodies and contact email + attributes. Redact identifiers; log hashed contact ids only.
- **Hardcoded OAuth redirect URIs** — `app/api/auth/meta/callback/route.ts:27`, `app/api/auth/linkedin/callback/route.ts:27`. Drive from env and validate against an allowlist.

### Medium
- **CSRF** — POST/PUT/DELETE routes (`app/api/social/publish/route.ts`, `app/api/brevo/send/route.ts`, `app/api/store/[key]/route.ts:51`) rely on the NextAuth session cookie only. Add a `Origin`/`Referer` check or a CSRF token for any state‑changing route reachable from a browser.
- **OAuth `state` lifetime not enforced** — `app/api/auth/linkedin/callback/route.ts:20-22`, `app/api/auth/meta/callback/route.ts:20-22`. Cookie has `maxAge: 600`, but request age isn’t verified before accepting.
- **`app/api/store/[key]/route.ts:24‑28`** — `isCollectionKey()` is the only gate on a generic store. Confirm it’s a strict enum/allowlist, not a substring match.

### Low
- **`app/api/brevo/webhook/route.ts:70`** logs `JSON.stringify(attributes)` — could include custom fields you don't want in logs.

---

## 2. Configuration & Build

### High
- **Impossible package versions in `package.json`:**
  - `typescript: ^6.0.3` — TS 6 does not exist; pin to `^5.6.x`.
  - `@types/node: ^25.6.0` — track installed Node major (e.g. `^22.0.0`).
  - `@types/react: ^19.2.14` + `@types/react-dom: ^19.2.3` with `react@18.3.1`. Downgrade types to `^18.3.x`.
- **`netlify.toml:7` — `NODE_VERSION = "18"`** — Node 18 is EOL (Apr 2025). Move to 20 or 22.
- **`tailwind.config.ts` vs `tailwindcss@^4.2.4`** — v4 is CSS‑first; the JS config file is largely vestigial. Either pin to `^3.x` or migrate config into `app/globals.css` (`@theme`).
- **`middleware.ts:74` matcher** — currently excludes only `login`, `api/auth`, static. PUBLIC_API_ROUTES still pass through the middleware and rely on the `authorized` callback. Add them to the matcher exclusion for defence in depth.

### Medium
- **`next.config.js`** — no `headers()` for CSP, X‑Frame‑Options, X‑Content‑Type‑Options, Referrer‑Policy, HSTS, Permissions‑Policy. No `images.domains` allowlist (blocks adopting `next/image`).
- **`tsconfig.json`** — `"strict": false`, `"target": "es2015"`. Move to `strict: true`, `target: "es2020"`, add `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`.
- **Scripts missing in `package.json`** — no `typecheck`, `test`, `lint:fix`, `format`.
- **No CI** — no `.github/workflows/*` to run lint/typecheck/build on PRs.

### Low
- **No ESLint/Prettier config files** — rely solely on `next lint` defaults.
- **`README.md`** is empty. Document env vars, run/deploy, scheduled functions.
- **Env‑var validation** — `process.env.X!` is used throughout (e.g. `app/api/ai/chat/route.ts:20`). Centralise in `lib/env.ts` with a runtime check at startup.

---

## 3. Code Quality / Bugs

### High
- **Pervasive `any`** — e.g. `app/api/ai/chat/route.ts:15,26,45,64`. With `strict: false`, this is the de‑facto type system.
- **Index used as React key** — `app/hub/page.tsx:861,908,924,943`; `app/social/page.tsx:1138,1414`. Causes stale state on reorder/insert. Use stable ids.
- **Silent error swallowing** — `.catch(() => {})` in `app/contacts/page.tsx:354`; `.catch(() => ({}))` in `app/api/social/settings/route.ts:60`. Caller cannot tell success from failure.
- **Unprotected `await req.json()`** — `app/api/social/publish/route.ts:31‑33`. Invalid JSON crashes the route. Wrap in try/catch and 400.
- **Missing useEffect cleanup / deps** — `app/contacts/page.tsx:354` calls `loadContacts` with side effects and no abort.

### Medium
- **Inconsistent error shapes** across API routes (`{ok, error}` vs `{error}` vs thrown). Pick one (e.g. `{ ok: false, error: string }`) and apply uniformly.
- **Race conditions on publish** — `app/social/page.tsx:600‑625` writes to a shared `results` object without sequencing.
- **`process.env.X!` non‑null assertions** — runtime crashes when env missing (`app/api/ai/chat/route.ts:20`).
- **Hardcoded `http://localhost:3000` fallbacks** — `lib/roamio-tools.ts:486,524,548,692`. Staging will silently call dev URL.
- **Unsafe casts** — `app/social/page.tsx:924,951` use `.filter(Boolean) as SocialAccount[]`.
- **Polling** — `app/page.tsx:77‑79` uses 60s `setInterval` for dashboard refresh. Consider visibility‑aware polling or SWR.

### Low
- **~124 `console.*` calls** across `app/` — strip or gate behind a logger in prod.
- **`app/social/page.tsx:823‑825`** date math `dt.getDate() + i*2` with `hour mod 3` — uneven scheduling distribution.
- **Only one `AbortController` in the codebase** (`lib/brevo.ts:20`). Client fetches in `useEffect` leak on unmount.

---

## 4. Frontend / UX / Accessibility / SEO

### High
- **No per‑page metadata** — `app/layout.tsx:6-10` is the only `metadata` export. Every `page.tsx` should export `metadata` for title + description.
- **No `robots.txt` / `sitemap.xml`** under `public/`. Add `app/robots.ts` and `app/sitemap.ts`.
- **Buttons & images missing accessible labels** — e.g. refresh button at `app/page.tsx:121`, logo at `app/login/page.tsx:61`, mobile close at `components/AppShell.tsx:62`.
- **Modal lacks focus trap & ARIA** — `app/contacts/page.tsx:191`. No focus return on close, no `role="dialog"`, no escape‑to‑close.

### Medium
- **All pages are `'use client'`** (14/14). At minimum, `/contacts`, `/sequences`, `/social`, `/brain`, `/hub` should fetch initial data as Server Components.
- **No `next/image`** — all `<img>` (sidebar, login, app shell). Add image optimisation + `images.domains` config.
- **No canonical / OG / Twitter card tags**.
- **Fixed `minWidth: 600`** in funnel viz `app/page.tsx:141` causes horizontal scroll on mobile.
- **Form UX** — login submit (`app/login/page.tsx:141-156`) lacks spinner; contact edit panel lacks save/cancel feedback; `find` form has no validation.
- **No `loading.tsx` / `error.tsx`** at any route — failed fetches degrade silently.
- **Hidden file input via `display:none`** in `app/brain/page.tsx` — use `sr-only` so it stays keyboard‑accessible.

### Low
- Emoji glyphs used as icons (⚡, ✓, →, ×) without `aria-label` / `aria-hidden`.
- `app/social/page.tsx:474` uses `window.location.origin` for asset URLs — use `NEXT_PUBLIC_BASE_URL`.

---

## Suggested Order of Fixes

1. **Today** — Fix package.json TypeScript/Node/React types so the project type‑checks deterministically. Bump `NODE_VERSION` in `netlify.toml`. These are silent landmines.
2. **This week** — Security: timing‑safe bearer checks, upload validation, redact PII in logs, OAuth redirect allowlist, `next.config.js` security headers.
3. **Next** — Tailwind v3‑vs‑v4 alignment. Strict TS + fix `any` hotspots. Centralised env validation. Single error‑shape policy across API routes.
4. **Then** — Per‑page metadata + `robots`/`sitemap`. A11y pass on buttons/modals/forms. Move read‑heavy pages to Server Components. Add `loading.tsx`/`error.tsx`.
5. **Backlog** — ESLint/Prettier configs, CI workflow, tests, README, structured logger replacing `console.*`.
