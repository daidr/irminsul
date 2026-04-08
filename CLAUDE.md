# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Irminsul is a full-stack Minecraft authentication server implementing the Yggdrasil protocol (compatible with authlib-injector). It features a web UI for account management, session-based auth, and skin/cape texture hosting.

## Tech Stack

- **Runtime:** Bun (required)
- **Framework:** Nuxt 4 (Vue 3 SSR with Nitro server engine)
- **Frontend:** Tailwind CSS v4 + DaisyUI v5
- **Backend:** Nitro server routes + server utils
- **Database:** MongoDB (user data, tokens) + Redis (sessions)
- **Validation:** Zod
- **Testing:** Vitest + @nuxt/test-utils
- **Language:** TypeScript (strict mode, ES2022 target)

## Commands

```bash
bun run dev        # Start dev server with HMR
bun run build      # Production build
bun run preview    # Preview production build
bun run prod       # Build then run production server
bun run lint       # Lint with oxlint (type-aware)
bun run lint:fix   # Lint and auto-fix
bun run fmt        # Format with oxfmt
bun run fmt:check  # Check formatting
bun run test       # Run all tests with Vitest
bun run test -- tests/utils/ban.repository.test.ts  # Run a single test file
```

### CLI Tool (`cli/`)

Standalone Bun CLI for setup and migration (separate package in `cli/`):

```bash
bun cli/src/init.ts      # Run CLI (dev)
cd cli && bun run build  # Build CLI
```

Two modes: **fresh install** (configures MongoDB/Redis, generates `.env`) and **GHAuth migration** (imports users, skins, config from legacy GHAuth).

## Architecture

### Nuxt Directory Structure

- `app/` — Client-side code (Nuxt 4 app directory)
  - `pages/` — File-based routing (each `*.vue` maps to a URL)
  - `components/` — Auto-imported Vue components
  - `composables/` — Auto-imported composables (e.g., `useUser()`, `useSettings()`)
  - `layouts/` — Layout components (`default.vue`)
  - `stores/` — Pinia stores
  - `plugins/` — Client plugins
  - `assets/css/` — Tailwind CSS and theme definitions
- `server/` — Nitro server-side code
  - `api/` — API routes (file-based: `server/api/auth/login.post.ts` → `POST /api/auth/login`)
  - `routes/` — Non-API routes (e.g., Yggdrasil protocol endpoints)
  - `plugins/` — Nitro server plugins (DB init, logging, key generation)
  - `middleware/` — Server middleware (session resolution)
  - `utils/` — Auto-imported server utilities (DB repos, auth helpers, crypto)
- `tests/` — Vitest test files (`tests/server/`, `tests/utils/`)
- `cli/` — Standalone Bun CLI for setup/migration (separate package)

### Server Routes & API

Nitro file-based API routes. Convention:

- `server/api/**/*.get.ts` — GET endpoints
- `server/api/**/*.post.ts` — POST endpoints
- `server/routes/yggdrasil/` — Yggdrasil protocol endpoints

All server utils in `server/utils/` are auto-imported in server context.

### Data Fetching

- **Page data:** Use `useAsyncData` + `$fetch('/api/...')` in pages/components
- **User interactions:** Use `$fetch` directly for mutations (form submits, button clicks)

### Settings Table (`server/utils/settings.repository.ts`)

MongoDB collection `settings` stores system configuration (SMTP, auth policies, etc.).

**Schema:** `{ key: string, value: any, source: string }`

- `key` — must follow `"category.name"` format (e.g. `"smtp.host"`, `"auth.requireEmailVerification"`)
- `value` — any MongoDB-supported type
- `source` — origin of the setting; all built-in settings use `"irminsul.builtin"`
- Unique index on `key`

**Built-in settings** (initialized on startup, won't overwrite existing values):

| Key                             | Default | Description                                              |
| ------------------------------- | ------- | -------------------------------------------------------- |
| `smtp.host`                     | `""`    | SMTP server host                                         |
| `smtp.port`                     | `465`   | SMTP port                                                |
| `smtp.secure`                   | `true`  | Use TLS                                                  |
| `smtp.user`                     | `""`    | SMTP username                                            |
| `smtp.pass`                     | `""`    | SMTP password                                            |
| `smtp.from`                     | `""`    | Sender address (e.g. `"Irminsul <noreply@example.com>"`) |
| `auth.requireEmailVerification` | `false` | Whether email verification is required                   |
| `general.announcement`          | `""`    | Homepage announcement text (empty = title only)          |

**API:** `getSetting(key)`, `setSetting(key, value, source)`, `getSettingsByCategory(category)`, `getSettingsMap(keys)`, `deleteSetting(key)`

### Authentication Flow

1. Login form submits email + password + Altcha proof-of-work via `$fetch('/api/auth/login', { method: 'POST' })`
2. Server looks up user in MongoDB, verifies password (Argon2id or legacy, auto-upgrades)
3. Yggdrasil token pair created (accessToken + clientToken), stored in user document
4. Redis session created, `irmin_session` cookie set
5. Server middleware resolves session → `event.context.user`
6. Client fetches user via `useUser()` composable which calls `/api/auth/me`

### Ban Policy

Bans only restrict Yggdrasil protocol interactions (game login, token validation, etc.). Banned users can still use all web features (login, change password, view profile, etc.). Do not check ban status for web operations.

### Styling

Tailwind CSS v4 with DaisyUI v5. Two custom themes (`irminsul-light`, `irminsul-dark`) defined in `app/assets/css/tailwind.css` using OKLCH colors. Component styles use scoped SCSS. Overall visual style is sharp/no-rounded-corners — all DaisyUI radius variables (`--radius-selector`, `--radius-field`, `--radius-box`) are set to `0` in both themes.

### Icons

Use Nuxt Icon module with Iconify. Usage: `<Icon name="hugeicons:icon-name" />` (auto-resolved by @nuxt/icon).

### Modals

Use the HTML `<dialog>` element with DaisyUI's `modal` class. Must wrap with `ClientOnly` + `Teleport to="body"` to avoid SSR hydration issues and ensure dialog renders under `<body>`.

```vue
<script setup lang="ts">
import { useTemplateRef } from "vue";

const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");

function open() {
  dialogRef.value?.showModal();
}

defineExpose({ open });
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>
          <h3 class="text-lg font-bold">Title</h3>
          <p class="py-4">Content</p>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>
</template>
```

**Key points:**

- `ClientOnly` ensures dialog only renders on client, `Teleport to="body"` hoists it to `<body>`
- Open via `dialogRef.showModal()`, close via `method="dialog"` form
- `modal-bottom sm:modal-middle` for responsive positioning
- Parent calls `open()` via template ref

### Testing Patterns

Tests run via `bun run test` (Vitest with Bun as runtime). Key mocking patterns:

- **Nitro auto-imports:** Not available in tests. Stub all server utils and Nitro helpers (`defineEventHandler`, `readBody`, `getHeader`, `setCookie`, etc.) with `vi.stubGlobal()`. See `tests/server/auth.test.ts` for the full pattern.
- **Bun global:** `Bun` is a non-configurable global in Bun runtime — **never use `vi.stubGlobal("Bun", ...)`**. To mock `Bun.password`, use `vi.spyOn(Bun.password, "hash" as any)` / `vi.spyOn(Bun.password, "verify" as any)`. See `tests/utils/oauth-provider.service.test.ts`. For tests that must also run in Node, guard with `if (typeof globalThis.Bun === "undefined")` before stubbing (see `tests/utils/password.test.ts`).
- **Zod v4:** Mock with `vi.mock("zod", ...)` spreading `{ ...mod, z: mod }` because Zod v4's named `z` export is unavailable in the test environment.
- **evlog:** Mock `useLogger` since it requires Nitro plugin initialization: `vi.mock("evlog", async () => ({ ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) }))`.

### Server Startup & Middleware

Single plugin `server/plugins/server-startup.ts` orchestrates initialization in phases: evlog/runtime/dirs/DB → parallel index/settings/keys init → secrets → plugins.

Server middleware uses numeric prefixes for ordering: `01.session.ts` → `02.security-headers.ts` → `03.evlog-context.ts`. The security headers middleware sets the `X-Authlib-Injector-API-Location` header required by authlib-injector clients.

## Conventions

- **Commit style:** Conventional commits, enforced by commitlint (`feat:`, `fix:`, etc.)
- **Pre-commit hooks:** lint-staged runs oxlint on staged files (via bun-git-hooks)
- **Type imports:** Use top-level `import type` (enforced by oxlint `import/consistent-type-specifier-style`)
- **Node imports:** Use `node:` protocol prefix (enforced by oxlint `unicorn/prefer-node-protocol`)
- **Custom elements:** `altcha-widget` is registered as a Vue custom element in `nuxt.config.ts`
- **Auto-imports:** Components, composables, and server utils are auto-imported by Nuxt — no manual import needed

## Environment

Config via `IRMIN_*` environment variables or `.env` file (`nitro.envPrefix: 'IRMIN_'`). Key variables map to `runtimeConfig` in `nuxt.config.ts`:

- `IRMIN_DB_URL` — MongoDB connection URL
- `IRMIN_DB_NAME` — MongoDB database name (default: `irmin`)
- `IRMIN_REDIS_URL` — Redis connection URL
- `IRMIN_REDIS_SCOPE` — Redis key prefix (default: `irmin`)
- `IRMIN_HOST` — Listen address (default: `0.0.0.0`)
- `IRMIN_PORT` — Listen port (default: `3000`)
- `IRMIN_EVLOG_SAMPLING_INFO` — Info event sampling rate, 0-100% (default: `100`)
- `IRMIN_EVLOG_SAMPLING_DEBUG` — Debug event sampling rate, 0-100% (default: `10`)
- `IRMIN_EVLOG_MAX_FILES` — Max log files retained by fs drain (default: `30`)
- `IRMIN_YGGDRASIL_BASE_URL` — Yggdrasil base URL
- `IRMIN_YGGDRASIL_SKIN_DOMAINS` — Trusted skin domains (comma-separated)
- `IRMIN_PUBLIC_SITE_NAME` — Site name (default: `Irminsul`)
- `IRMIN_TRUST_PROXY` — Trust reverse proxy headers (default: `false`)
- `IRMIN_YGGDRASIL_TOKEN_EXPIRY_MS` — Token TTL in ms (default: `432000000` = 5 days)
- `IRMIN_YGGDRASIL_DEFAULT_SKIN_HASH` — Default skin texture hash
- `IRMIN_LEGACY_GLOBAL_SALT` — Legacy password salt (GHAuth migration)
- `IRMIN_WEBAUTHN_RP_ID` / `IRMIN_WEBAUTHN_ORIGIN` — WebAuthn passkey config

Secrets (Altcha HMAC keys) are auto-generated to `irminsul-data/auto-generate/secrets.yaml` on first run.

## Runtime Data

`irminsul-data/` stores runtime artifacts (not in git): textures, RSA keys, logs, auto-generated secrets. Created automatically on startup by server plugins.

## Non-obvious Config

- Build assets dir is `/_irmin/` (not default `/_nuxt/`) — set in `app.buildAssetsDir`
- Root app element ID is `__irmin_app`
- `mongodb`, `@napi-rs/canvas`, `jsdom` are excluded from Nitro bundling; `mongodb-connection-string-url` is force-inlined
- `evlog/nuxt` module tags all wide events with `service: "irminsul"`
