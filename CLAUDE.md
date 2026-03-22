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
bun run test       # Run tests with Vitest
```

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
- `tests/` — Vitest test files

### Server Routes & API

Nitro file-based API routes replace Telefunc. Convention:
- `server/api/**/*.get.ts` — GET endpoints
- `server/api/**/*.post.ts` — POST endpoints
- `server/routes/yggdrasil/` — Yggdrasil protocol endpoints

All server utils in `server/utils/` are auto-imported in server context.

### Data Fetching

- **Page data:** Use `useAsyncData` + `$fetch('/api/...')` in pages/components
- **User interactions:** Use `$fetch` directly for mutations (form submits, button clicks)
- Do NOT use Telefunc (removed in Nuxt migration)

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

## Conventions

- **Commit style:** Conventional commits, enforced by commitlint (`feat:`, `fix:`, etc.)
- **Pre-commit hooks:** lint-staged runs oxlint on staged files (via bun-git-hooks)
- **Type imports:** Use top-level `import type` (enforced by oxlint `import/consistent-type-specifier-style`)
- **Node imports:** Use `node:` protocol prefix (enforced by oxlint `unicorn/prefer-node-protocol`)
- **Custom elements:** `altcha-widget` is registered as a Vue custom element in `nuxt.config.ts`
- **Auto-imports:** Components, composables, and server utils are auto-imported by Nuxt — no manual import needed

## Environment

Config via `NUXT_*` environment variables or `.env` file. Key variables map to `runtimeConfig` in `nuxt.config.ts`:

- `NUXT_DB_URL` — MongoDB connection URL
- `NUXT_DB_NAME` — MongoDB database name (default: `irmin`)
- `NUXT_REDIS_URL` — Redis connection URL
- `NUXT_REDIS_SCOPE` — Redis key prefix (default: `irmin`)
- `NUXT_APP_HOST` — Listen address (default: `0.0.0.0`)
- `NUXT_APP_LOG_LEVEL` — Log level (default: `debug`)
- `NUXT_YGGDRASIL_BASE_URL` — Yggdrasil base URL
- `NUXT_YGGDRASIL_SKIN_DOMAINS` — Trusted skin domains (comma-separated)
- `NUXT_PUBLIC_SITE_NAME` — Site name (default: `Irminsul`)

Secrets (Altcha HMAC keys) are auto-generated to `irminsul-data/auto-generate/secrets.yaml` on first run.

## Runtime Data

`irminsul-data/` stores runtime artifacts (not in git): textures, RSA keys, logs, auto-generated secrets. Created automatically on startup by server plugins.

## Key Differences from Vike Version

- **RPC:** Telefunc replaced by Nitro server routes + `$fetch`
- **Data fetching:** Vike `+data.ts` replaced by `useAsyncData` + `/api/` routes
- **User context:** `pageContext.user` replaced by `event.context.user` (server) / `useUser()` composable (client)
- **Auto-imports:** Components, composables, and server utils are auto-imported — no manual imports needed
- **Routing:** Vike filesystem routing replaced by Nuxt `pages/` directory
- **Layouts:** Vike `+Layout.vue` replaced by Nuxt `layouts/`
- **Config:** `vite.config.ts` replaced by `nuxt.config.ts`
