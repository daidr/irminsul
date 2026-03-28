/// <reference lib="webworker" />
declare const self: Worker;

// Types are duplicated here because this file runs in a separate Worker
// and cannot use Nitro auto-imports. Keep in sync with server/utils/plugin/types.ts.

interface PluginMeta {
  id: string;
  name: string;
  version: string;
  dir: string;
}

interface MainToWorkerMessage {
  type: "init" | "plugin:load" | "hook:call" | "config:update" | "shutdown";
  pluginId?: string;
  pluginDir?: string;
  entryPath?: string;
  config?: Record<string, unknown>;
  meta?: PluginMeta;
  allowedHooks?: string[];
  hookName?: string;
  args?: unknown[];
  callId?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

interface WorkerToMainMessage {
  type: "plugin:loaded" | "hook:result" | "hook:register" | "log" | "shutdown:done";
  pluginId?: string | null;
  ok?: boolean;
  error?: string;
  callId?: string;
  result?: unknown;
  hookName?: string;
  level?: string;
  logType?: string;
  message?: string;
  data?: Record<string, unknown>;
}

// --- Plugin State ---
interface LoadedPlugin {
  id: string;
  hooks: Map<string, Function>;
  config: Record<string, unknown>;
  allowedHooks: string[];
}

const LIFECYCLE_HOOKS = ["app:started", "app:shutdown", "config:changed"];
const plugins = new Map<string, LoadedPlugin>();
let currentPluginId: string | null = null;

// --- Console Interception ---
function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
}

function send(msg: WorkerToMainMessage): void {
  postMessage(msg);
}

const originalConsole = globalThis.console;
globalThis.console = {
  ...originalConsole,
  log: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "info", logType: "console", message: formatArgs(args) }),
  warn: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "warn", logType: "console", message: formatArgs(args) }),
  error: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "error", logType: "console", message: formatArgs(args) }),
  debug: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "debug", logType: "console", message: formatArgs(args) }),
} as Console;

// --- ctx Factory ---
interface PluginContext {
  meta: Readonly<PluginMeta>;
  config: {
    get(key: string): unknown;
    getAll(): Record<string, unknown>;
  };
  hook(name: string, handler: Function): void;
  log: {
    set(fields: Record<string, unknown>): void;
    emit(): void;
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    debug(message: string, data?: Record<string, unknown>): void;
  };
  fetch: typeof globalThis.fetch;
  oauth: {
    exchangeToken(
      tokenUrl: string,
      options: { code: string; redirectUri: string; clientId: string; clientSecret: string },
    ): Promise<{ accessToken: string; tokenType: string }>;
    fetchProfile(
      userInfoUrl: string,
      options: { accessToken: string; tokenType: string; headers?: Record<string, string> },
    ): Promise<unknown>;
  };
}

function createPluginContext(
  pluginId: string,
  plugin: LoadedPlugin,
  meta: PluginMeta,
): PluginContext {
  let pendingFields: Record<string, unknown> = {};

  return {
    meta: Object.freeze({ ...meta }),
    config: {
      get(key: string) {
        return plugin.config[key];
      },
      getAll() {
        return { ...plugin.config };
      },
    },
    hook(name: string, handler: Function) {
      const isLifecycle = LIFECYCLE_HOOKS.includes(name);
      if (!isLifecycle && !plugin.allowedHooks.includes(name)) {
        send({
          type: "log",
          pluginId,
          level: "error",
          logType: "event",
          message: `Hook "${name}" not declared in plugin.yaml`,
        });
        return;
      }
      plugin.hooks.set(name, handler);
      send({ type: "hook:register", pluginId, hookName: name });
    },
    log: {
      set(fields) {
        Object.assign(pendingFields, fields);
      },
      emit() {
        send({
          type: "log",
          pluginId,
          level: "info",
          logType: "event",
          data: pendingFields,
        });
        pendingFields = {};
      },
      error(error, context) {
        send({
          type: "log",
          pluginId,
          level: "error",
          logType: "event",
          message: error?.message ?? String(error),
          data: { ...context, stack: error?.stack },
        });
      },
      info(message, data) {
        send({ type: "log", pluginId, level: "info", logType: "event", message, data });
      },
      warn(message, data) {
        send({ type: "log", pluginId, level: "warn", logType: "event", message, data });
      },
      debug(message, data) {
        send({ type: "log", pluginId, level: "debug", logType: "event", message, data });
      },
    },
    fetch: globalThis.fetch.bind(globalThis),
    oauth: {
      async exchangeToken(tokenUrl, options) {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code: options.code,
          redirect_uri: options.redirectUri,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        });

        const res = await globalThis.fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Token exchange failed (${res.status}): ${text}`);
        }

        const data = (await res.json()) as Record<string, unknown>;
        const accessToken = data.access_token as string;
        if (!accessToken) {
          throw new Error("Token exchange response missing access_token");
        }

        return {
          accessToken,
          tokenType: (data.token_type as string) ?? "Bearer",
        };
      },

      async fetchProfile(userInfoUrl, options) {
        const res = await globalThis.fetch(userInfoUrl, {
          headers: {
            Authorization: `${options.tokenType} ${options.accessToken}`,
            Accept: "application/json",
            ...options.headers,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`User info fetch failed (${res.status}): ${text}`);
        }

        return res.json();
      },
    },
  };
}

// --- Message Handler ---
self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      // Host ready — console interception already done
      break;

    case "plugin:load": {
      const { pluginId, pluginDir, entryPath, config, meta, allowedHooks } = msg as Required<
        Pick<MainToWorkerMessage, "pluginId" | "pluginDir" | "entryPath" | "config" | "meta" | "allowedHooks">
      >;
      const plugin: LoadedPlugin = {
        id: pluginId,
        hooks: new Map(),
        config: config ?? {},
        allowedHooks: allowedHooks ?? [],
      };
      plugins.set(pluginId, plugin);

      try {
        currentPluginId = pluginId;
        const mod = await import(entryPath);
        if (typeof mod.setup !== "function") {
          throw new Error("index.js must export a setup() function");
        }
        const ctx = createPluginContext(pluginId, plugin, {
          ...(meta as PluginMeta),
          dir: pluginDir,
        });
        await mod.setup(ctx);

        // Auto-call app:started
        const startedHandler = plugin.hooks.get("app:started");
        if (startedHandler) {
          try {
            await startedHandler();
          } catch {}
        }

        send({ type: "plugin:loaded", pluginId, ok: true });
      } catch (err: unknown) {
        plugins.delete(pluginId);
        send({
          type: "plugin:loaded",
          pluginId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        currentPluginId = null;
      }
      break;
    }

    case "hook:call": {
      const { pluginId, hookName, args, callId } = msg as Required<
        Pick<MainToWorkerMessage, "pluginId" | "hookName" | "args" | "callId">
      >;
      const plugin = plugins.get(pluginId!);
      const handler = plugin?.hooks.get(hookName!);
      if (!handler) {
        send({
          type: "hook:result",
          callId,
          ok: false,
          error: `No handler for ${hookName} in ${pluginId}`,
        });
        break;
      }
      try {
        currentPluginId = pluginId!;
        const result = await handler(...(args ?? []));
        send({ type: "hook:result", callId, ok: true, result });
      } catch (err: unknown) {
        send({
          type: "hook:result",
          callId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        currentPluginId = null;
      }
      break;
    }

    case "config:update": {
      const { pluginId, config, changes } = msg as Required<
        Pick<MainToWorkerMessage, "pluginId" | "config" | "changes">
      >;
      const plugin = plugins.get(pluginId!);
      if (!plugin) break;
      plugin.config = config ?? {};
      const handler = plugin.hooks.get("config:changed");
      if (handler) {
        try {
          currentPluginId = pluginId!;
          await handler({ changes, config });
        } catch {} finally {
          currentPluginId = null;
        }
      }
      break;
    }

    case "shutdown": {
      // Call app:shutdown on all plugins in reverse order
      const pluginList = [...plugins.values()].reverse();
      for (const plugin of pluginList) {
        const handler = plugin.hooks.get("app:shutdown");
        if (handler) {
          try {
            currentPluginId = plugin.id;
            await Promise.race([
              handler(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("shutdown timeout")), 5000),
              ),
            ]);
          } catch {} finally {
            currentPluginId = null;
          }
        }
      }
      // Notify main thread that cleanup is done
      send({ type: "shutdown:done" });
      break;
    }
  }
};
