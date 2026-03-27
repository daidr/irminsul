import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLogger } from "evlog";
import type {
  PluginState,
  PluginRegistryEntry,
  DirtyReason,
  HostStatus,
  PluginLogEntry,
  WorkerToMainMessage,
} from "./types";
import { parsePluginYaml } from "./yaml-parser";
import { validatePluginConfig } from "./config-validator";
import type { ValidateResult } from "./config-validator";
import { HookRegistry } from "./hook-registry";
import { PluginLogManager } from "./log-manager";
import { PluginBridge } from "./plugin-bridge";
import { PluginWatcher } from "./plugin-watcher";
import type { OAuthProviderDescriptor } from "../oauth";

const PLUGIN_MANAGER_KEY = Symbol.for("irminsul.pluginManager");

export function getPluginManager(): PluginManager {
  return (globalThis as any)[PLUGIN_MANAGER_KEY];
}

export function setPluginManager(manager: PluginManager): void {
  (globalThis as any)[PLUGIN_MANAGER_KEY] = manager;
}

function emitPluginEvent(action: string, data?: Record<string, unknown>): void {
  const log = createLogger({ category: "plugin" });
  log.set({ action, ...data });
  log.emit();
}

export class PluginManager {
  private plugins = new Map<string, PluginState>();
  private dirtyReasons: DirtyReason[] = [];
  private hostStatus: HostStatus = "stopped";
  private bridge: PluginBridge;
  private hookRegistry = new HookRegistry();
  private oauthProviders = new Map<string, { descriptor: OAuthProviderDescriptor; pluginId: string }>();
  private logManager: PluginLogManager;
  private watcher: PluginWatcher | null = null;
  private pluginsDir: string;
  private statusSubscribers = new Set<ReadableStreamDefaultController>();

  constructor(pluginsDir: string) {
    this.pluginsDir = resolve(pluginsDir);
    const bufferSize =
      (getSetting("plugin.system.logBufferSize") as number) ?? 200;
    this.logManager = new PluginLogManager(this.pluginsDir, bufferSize);

    this.bridge = new PluginBridge({
      onLog: (msg) => this.handlePluginLog(msg),
      onHookRegister: (pluginId, hookName) => {
        const plugin = this.plugins.get(pluginId);
        if (plugin) {
          this.hookRegistry.register(pluginId, hookName, plugin.order);
        }
      },
      onCrash: (error) => this.handleCrash(error),
    });
  }

  // === Scan & Startup ===

  async scan(): Promise<void> {
    // 1. Collect enabled state from DB
    const registry =
      ((getSetting("plugin.system.registry") as PluginRegistryEntry[]) ?? []);
    const registryMap = new Map(registry.map((e) => [e.id, e]));
    emitPluginEvent("scan:registry_loaded", {
      count: registry.length,
      entries: registry.map((e) => ({ id: e.id, enabled: e.enabled, order: e.order })),
    });

    // 2. Scan plugin directories for available plugins
    const discovered = new Map<string, PluginState>();

    if (existsSync(this.pluginsDir)) {
      const dirs = readdirSync(this.pluginsDir, { withFileTypes: true }).filter(
        (d) => d.isDirectory(),
      );
      let maxOrder = Math.max(0, ...registry.map((e) => e.order));

      for (const dir of dirs) {
        const pluginDir = join(this.pluginsDir, dir.name);
        const yamlPath = existsSync(join(pluginDir, "plugin.yaml"))
          ? join(pluginDir, "plugin.yaml")
          : existsSync(join(pluginDir, "plugin.yml"))
            ? join(pluginDir, "plugin.yml")
            : null;

        if (!yamlPath) continue;

        const yamlContent = readFileSync(yamlPath, "utf-8");
        const result = parsePluginYaml(yamlContent);
        const entry = registryMap.get(dir.name);

        if (!result.ok) {
          const enabled = entry?.enabled ?? false;
          discovered.set(dir.name, {
            id: dir.name,
            meta: { name: dir.name, version: "0.0.0", hooks: [] },
            enabled,
            status: "error",
            order: entry?.order ?? ++maxOrder,
            error: result.errors.join("; "),
            dir: pluginDir,
          });
          emitPluginEvent("scan:plugin_error", {
            pluginId: dir.name,
            error: result.errors.join("; "),
          });
          continue;
        }

        const enabled = entry?.enabled ?? false;
        discovered.set(dir.name, {
          id: dir.name,
          meta: result.meta,
          enabled,
          status: "disabled",
          order: entry?.order ?? ++maxOrder,
          dir: pluginDir,
        });
        emitPluginEvent("scan:plugin_found", {
          pluginId: dir.name,
          version: result.meta.version,
          enabled,
          isNew: !entry,
          hooks: result.meta.hooks,
        });
      }
    }

    // 3. Remove DB state/config for plugins no longer on disk, detect structural changes
    let registryChanged = false;
    for (const entry of registry) {
      if (!discovered.has(entry.id)) {
        emitPluginEvent("scan:plugin_removed", { pluginId: entry.id });
        await deleteSetting(`plugin.custom.${entry.id}.config`);
        registryChanged = true;
      }
    }
    for (const id of discovered.keys()) {
      if (!registryMap.has(id)) {
        registryChanged = true;
      }
    }

    this.plugins = discovered;

    // Only write registry when structure changed (new/deleted plugins)
    if (registryChanged) {
      await this.saveRegistry();
    }

    emitPluginEvent("scan:complete", {
      total: discovered.size,
      enabled: [...discovered.values()].filter((p) => p.enabled).length,
      errors: [...discovered.values()].filter((p) => p.status === "error").length,
      registryChanged,
    });
  }

  async start(): Promise<void> {
    emitPluginEvent("host:starting");
    this.bridge.start();
    this.setHostStatus("running");

    // 4. Load enabled plugins in order
    const toLoad = [...this.plugins.values()]
      .filter((p) => p.enabled && p.status !== "error")
      .sort((a, b) => a.order - b.order);

    emitPluginEvent("host:started", {
      pluginsToLoad: toLoad.map((p) => p.id),
    });

    for (const plugin of toLoad) {
      try {
        await this.loadPluginIntoHost(plugin);
        emitPluginEvent("plugin:loaded", {
          pluginId: plugin.id,
          hooks: plugin.meta.hooks,
        });
      } catch (err: unknown) {
        plugin.status = "error";
        plugin.error = err instanceof Error ? err.message : String(err);
        emitPluginEvent("plugin:load_failed", {
          pluginId: plugin.id,
          error: plugin.error,
        });
      }
    }

    // Start watcher if enabled
    const watcherEnabled = getSetting("plugin.system.watcher") as boolean;
    if (watcherEnabled !== false) {
      this.startWatcher();
      emitPluginEvent("watcher:started");
    }

    // Cleanup expired logs
    const retentionDays =
      (getSetting("plugin.system.logRetentionDays") as number) ?? 7;
    this.logManager.cleanupExpiredLogs(retentionDays);

    // Discover OAuth providers from loaded plugins
    await this.discoverOAuthProviders();
  }

  // === Plugin Lifecycle ===

  async enablePlugin(id: string): Promise<{ ok: boolean; error?: string }> {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status === "enabled") return { ok: true };

    // If the plugin was just marked pending_disable (still running in Host), just flip the flag.
    if (plugin.status === "pending_disable") {
      plugin.enabled = true;
      plugin.status = "enabled";
      plugin.error = undefined;
      this.dirtyReasons = this.dirtyReasons.filter(
        (r) => !(r.pluginId === id && r.reason === "disabled"),
      );
      this.notifyStatusChange();
      await this.saveRegistry();
      return { ok: true };
    }

    if (plugin.status === "error" && plugin.meta.hooks.length === 0) {
      return { ok: false, error: plugin.error ?? "Plugin has errors" };
    }

    try {
      await this.loadPluginIntoHost(plugin);
      plugin.enabled = true;
      plugin.error = undefined;
      await this.saveRegistry();
      // 新插件启用后重新发现 OAuth provider
      await this.discoverOAuthProviders();
      emitPluginEvent("plugin:enabled", { pluginId: id });
      return { ok: true };
    } catch (err: unknown) {
      plugin.status = "error";
      plugin.error = err instanceof Error ? err.message : String(err);
      await this.saveRegistry();
      emitPluginEvent("plugin:enable_failed", { pluginId: id, error: plugin.error });
      return { ok: false, error: plugin.error };
    }
  }

  async disablePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin || plugin.status !== "enabled") return;

    // Mark as pending_disable + dirty. The plugin keeps running in the Host
    // until the admin restarts the Host.
    // 注意：不清理 OAuth provider 缓存，因为插件仍在运行中。
    // Host restart 时 discoverOAuthProviders() 会自然重建缓存，已禁用的插件不会被发现。
    plugin.enabled = false;
    plugin.status = "pending_disable";
    this.addDirtyReason(id, "disabled");

    await this.saveRegistry();
    emitPluginEvent("plugin:disabled", { pluginId: id });
  }

  async updateConfig(
    id: string,
    input: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, errors: { _: "Plugin not found" } };
    if (!plugin.meta.config)
      return { ok: false, errors: { _: "Plugin has no config schema" } };

    const result = validatePluginConfig(plugin.meta.config, input);
    if (!result.ok) return result;

    // Get old config
    const oldConfig =
      ((getSetting(`plugin.custom.${id}.config`) as Record<
        string,
        unknown
      >) ?? {});
    const newConfig = result.config;

    // Persist
    await setSetting(
      `plugin.custom.${id}.config`,
      newConfig,
      "irminsul.plugin",
    );

    if (plugin.status !== "enabled") return result;

    // Determine changes
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const allKeys = new Set([
      ...Object.keys(oldConfig),
      ...Object.keys(newConfig),
    ]);
    for (const key of allKeys) {
      if (oldConfig[key] !== newConfig[key]) {
        changes[key] = { old: oldConfig[key], new: newConfig[key] };
      }
    }

    if (Object.keys(changes).length === 0) return result;

    // Check if any changed keys have restart: true
    const restartKeys = (plugin.meta.config ?? [])
      .filter((f) => f.restart)
      .map((f) => f.key);
    const nonRestartChanges: Record<
      string,
      { old: unknown; new: unknown }
    > = {};
    let hasRestartKey = false;

    for (const [key, change] of Object.entries(changes)) {
      if (restartKeys.includes(key)) {
        hasRestartKey = true;
      } else {
        nonRestartChanges[key] = change;
      }
    }

    // Hot-update non-restart keys
    if (Object.keys(nonRestartChanges).length > 0) {
      this.bridge.updateConfig(id, newConfig, nonRestartChanges);
    }

    // Mark dirty for restart keys
    if (hasRestartKey) {
      this.addDirtyReason(id, "config_restart");
    }

    return result;
  }

  async updateOrder(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      const plugin = this.plugins.get(ids[i]!);
      if (plugin) plugin.order = i + 1;
    }
    await this.saveRegistry();
  }

  // === Host Management ===

  async restartHost(): Promise<void> {
    emitPluginEvent("host:restarting");
    await this.bridge.shutdown();
    this.hookRegistry.clear();
    this.setHostStatus("stopped");

    // Finalize pending_disable → disabled
    for (const plugin of this.plugins.values()) {
      if (plugin.status === "pending_disable") {
        emitPluginEvent("plugin:finalize_disable", { pluginId: plugin.id });
        plugin.status = "disabled";
      }
    }

    // Create new Host
    this.bridge.start();
    this.setHostStatus("running");

    // Reload all enabled plugins
    const toLoad = [...this.plugins.values()]
      .filter((p) => p.enabled && p.status !== "error")
      .sort((a, b) => a.order - b.order);

    for (const plugin of toLoad) {
      try {
        await this.loadPluginIntoHost(plugin);
        emitPluginEvent("plugin:reloaded", { pluginId: plugin.id });
      } catch (err: unknown) {
        plugin.status = "error";
        plugin.error = err instanceof Error ? err.message : String(err);
        emitPluginEvent("plugin:reload_failed", {
          pluginId: plugin.id,
          error: plugin.error,
        });
      }
    }

    // Re-discover OAuth providers after host restart
    await this.discoverOAuthProviders();

    // Clear dirty state
    this.dirtyReasons = [];
    this.notifyStatusChange();
    emitPluginEvent("host:restarted", {
      loaded: toLoad.filter((p) => p.status === "enabled").length,
      failed: toLoad.filter((p) => p.status === "error").length,
    });
  }

  getPlugins(): PluginState[] {
    return [...this.plugins.values()].sort((a, b) => a.order - b.order);
  }

  getPlugin(id: string): PluginState | undefined {
    return this.plugins.get(id);
  }

  getHostStatus(): { status: HostStatus; dirtyReasons: DirtyReason[] } {
    const status =
      this.dirtyReasons.length > 0
        ? ("dirty" as HostStatus)
        : this.hostStatus;
    return { status, dirtyReasons: [...this.dirtyReasons] };
  }

  private setHostStatus(status: HostStatus): void {
    this.hostStatus = status;
    this.notifyStatusChange();
  }

  private notifyStatusChange(): void {
    const data = this.getHostStatus();
    const encoded = new TextEncoder().encode(
      `event: status\ndata: ${JSON.stringify(data)}\n\n`,
    );
    for (const controller of this.statusSubscribers) {
      try {
        controller.enqueue(encoded);
      } catch {
        this.statusSubscribers.delete(controller);
      }
    }
  }

  subscribeHostStatus(controller: ReadableStreamDefaultController): () => void {
    this.statusSubscribers.add(controller);
    return () => {
      this.statusSubscribers.delete(controller);
    };
  }

  getLogManager(): PluginLogManager {
    return this.logManager;
  }

  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  // === OAuth Provider Access ===

  getOAuthProviders(): OAuthProviderDescriptor[] {
    return [...this.oauthProviders.values()].map((p) => p.descriptor);
  }

  getOAuthProvider(id: string): { descriptor: OAuthProviderDescriptor; pluginId: string } | null {
    return this.oauthProviders.get(id) ?? null;
  }

  getOAuthProviderByPlugin(pluginId: string): { descriptor: OAuthProviderDescriptor; pluginId: string } | null {
    for (const entry of this.oauthProviders.values()) {
      if (entry.pluginId === pluginId) return entry;
    }
    return null;
  }

  // === Plugin Hook Proxy (避免暴露 bridge) ===

  async callPluginHook(pluginId: string, hookName: string, ...args: unknown[]): Promise<unknown> {
    return this.bridge.callHook(pluginId, hookName, ...args);
  }

  // === Evlog Bridge ===

  bridgeEvlogHooks(nitroApp: any): void {
    // evlog calls hooks with context objects:
    //   evlog:enrich → { event, request?, headers? }  (runs BEFORE drain)
    //   evlog:drain  → { event, request?, headers? }  (runs AFTER enrich)

    // Enrichers: hook into evlog:enrich (runs before drain/FS write)
    nitroApp.hooks.hook("evlog:enrich", async (ctx: any) => {
      for (const handler of this.hookRegistry.get("evlog:enricher")) {
        try {
          // Send only the serializable event data to the Worker
          const patch = (await this.bridge.callHook(
            handler.pluginId,
            "evlog:enricher",
            ctx.event,
          )) as Record<string, unknown> | null;
          if (patch && typeof patch === "object") {
            Object.assign(ctx.event, patch);
          }
        } catch (err: unknown) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: `enricher error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    });

    // Drains: hook into evlog:drain (runs after enrich)
    nitroApp.hooks.hook("evlog:drain", async (ctx: any) => {
      for (const handler of this.hookRegistry.get("evlog:drain")) {
        try {
          await this.bridge.callHook(
            handler.pluginId,
            "evlog:drain",
            ctx.event,
          );
        } catch (err: unknown) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: `drain error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    });
  }

  // === OAuth Provider Discovery ===

  async discoverOAuthProviders(): Promise<void> {
    const providers = new Map<string, { descriptor: OAuthProviderDescriptor; pluginId: string }>();
    const handlers = this.hookRegistry.get("oauth:provider");

    for (const handler of handlers) {
      try {
        const descriptor = (await this.bridge.callHook(
          handler.pluginId,
          "oauth:provider",
        )) as OAuthProviderDescriptor;

        if (!descriptor?.id || !descriptor?.name) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: "oauth:provider hook returned invalid descriptor (missing id or name)",
          });
          continue;
        }

        if (providers.has(descriptor.id)) {
          const existing = providers.get(descriptor.id)!;
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: `oauth:provider id "${descriptor.id}" already registered by plugin "${existing.pluginId}", skipping`,
          });
          continue;
        }

        providers.set(descriptor.id, { descriptor, pluginId: handler.pluginId });
        emitPluginEvent("oauth:provider_discovered", {
          pluginId: handler.pluginId,
          providerId: descriptor.id,
          providerName: descriptor.name,
        });
      } catch (err: unknown) {
        this.logManager.push({
          timestamp: new Date().toISOString(),
          level: "error",
          type: "event",
          pluginId: handler.pluginId,
          message: `oauth:provider discovery error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    this.oauthProviders = providers;
    emitPluginEvent("oauth:discovery_complete", { count: providers.size });
  }

  // === Cleanup ===

  async destroy(): Promise<void> {
    emitPluginEvent("host:shutting_down");
    this.watcher?.stop();
    await this.bridge.shutdown();
    this.logManager.destroy();
    this.hookRegistry.clear();
    for (const controller of this.statusSubscribers) {
      try { controller.close(); } catch { }
    }
    this.statusSubscribers.clear();
    emitPluginEvent("host:shutdown");
  }

  // === Watcher Management ===

  startWatcher(): void {
    if (this.watcher) return;
    this.watcher = new PluginWatcher(this.pluginsDir, {
      onPluginChanged: (pluginId) => this.handlePluginChanged(pluginId),
      onPluginRemoved: (pluginId) => this.handlePluginRemoved(pluginId),
    });
    this.watcher.start();
  }

  stopWatcher(): void {
    this.watcher?.stop();
    this.watcher = null;
  }

  // === Private Helpers ===

  private async loadPluginIntoHost(plugin: PluginState): Promise<void> {
    plugin.status = "loading";
    const config =
      ((getSetting(`plugin.custom.${plugin.id}.config`) as Record<
        string,
        unknown
      >) ?? {});
    const entryPath = join(plugin.dir, "index.js");

    await this.bridge.loadPlugin({
      pluginId: plugin.id,
      pluginDir: plugin.dir,
      entryPath,
      config,
      meta: {
        id: plugin.id,
        name: plugin.meta.name,
        version: plugin.meta.version,
        dir: plugin.dir,
      },
      allowedHooks: plugin.meta.hooks,
    });

    plugin.status = "enabled";
    // 加载后更新 watcher 的 mtime 快照，避免 import 触发的文件访问被误判为修改
    this.watcher?.updateSnapshot(plugin.id);
  }

  private handlePluginLog(
    msg: Extract<WorkerToMainMessage, { type: "log" }>,
  ): void {
    const entry: PluginLogEntry = {
      timestamp: new Date().toISOString(),
      level: (msg.level as PluginLogEntry["level"]) ?? "info",
      type: (msg.logType as PluginLogEntry["type"]) ?? "event",
      message: msg.message,
      data: msg.data,
      pluginId: msg.pluginId ?? "host",
    };
    this.logManager.push(entry);
  }

  private crashCount = 0;
  private lastCrashTime = 0;

  private handleCrash(error: string): void {
    const now = Date.now();

    this.setHostStatus("crashed");
    this.hookRegistry.clear();

    // Prevent infinite restart loop: max 3 restarts within 30 seconds
    if (now - this.lastCrashTime < 30_000) {
      this.crashCount++;
    } else {
      this.crashCount = 1;
    }
    this.lastCrashTime = now;

    emitPluginEvent("host:crashed", {
      error,
      crashCount: this.crashCount,
      willRestart: this.crashCount <= 3,
    });

    if (this.crashCount > 3) {
      emitPluginEvent("host:crash_limit_reached", { crashCount: this.crashCount });
      return;
    }

    // Auto-restart after delay
    setTimeout(async () => {
      try {
        emitPluginEvent("host:crash_recovery_start", { attempt: this.crashCount });
        this.bridge.start();
        this.setHostStatus("running");

        const toLoad = [...this.plugins.values()]
          .filter((p) => p.enabled)
          .sort((a, b) => a.order - b.order);

        for (const plugin of toLoad) {
          try {
            await this.loadPluginIntoHost(plugin);
          } catch {
            plugin.status = "error";
            plugin.error = "Failed to reload after crash";
          }
        }

        // Re-discover OAuth providers after crash recovery
        await this.discoverOAuthProviders();

        this.dirtyReasons = [];
        this.notifyStatusChange();
        emitPluginEvent("host:crash_recovery_done", {
          loaded: toLoad.filter((p) => p.status === "enabled").length,
          failed: toLoad.filter((p) => p.status === "error").length,
        });
      } catch (restartErr) {
        emitPluginEvent("host:crash_recovery_failed", {
          error: restartErr instanceof Error ? restartErr.message : String(restartErr),
        });
      }
    }, 1000);
  }

  private handlePluginChanged(pluginId: string): void {
    const existing = this.plugins.get(pluginId);
    if (!existing) {
      // New plugin discovered
      this.rescanPlugin(pluginId);
      return;
    }

    if (existing.status === "enabled") {
      // Enabled plugin changed — mark dirty
      this.addDirtyReason(pluginId, "file_changed");
    } else {
      // Disabled plugin changed — just rescan metadata
      this.rescanPlugin(pluginId);
    }
  }

  private handlePluginRemoved(pluginId: string): void {
    const existing = this.plugins.get(pluginId);
    if (!existing) return;

    if (existing.status === "enabled") {
      this.hookRegistry.removePlugin(pluginId);
      // 清理该插件注册的 OAuth provider
      for (const [providerId, entry] of this.oauthProviders) {
        if (entry.pluginId === pluginId) {
          this.oauthProviders.delete(providerId);
        }
      }
      this.addDirtyReason(pluginId, "deleted");
    }

    this.plugins.delete(pluginId);
    void this.saveRegistry();
  }

  private rescanPlugin(pluginId: string): void {
    const pluginDir = join(this.pluginsDir, pluginId);
    const yamlPath = existsSync(join(pluginDir, "plugin.yaml"))
      ? join(pluginDir, "plugin.yaml")
      : existsSync(join(pluginDir, "plugin.yml"))
        ? join(pluginDir, "plugin.yml")
        : null;

    if (!yamlPath) return;

    const yamlContent = readFileSync(yamlPath, "utf-8");
    const result = parsePluginYaml(yamlContent);

    const existing = this.plugins.get(pluginId);
    const order = existing?.order ?? this.plugins.size + 1;

    const enabled = existing?.enabled ?? false;

    if (!result.ok) {
      this.plugins.set(pluginId, {
        id: pluginId,
        meta: { name: pluginId, version: "0.0.0", hooks: [] },
        enabled,
        status: "error",
        order,
        error: result.errors.join("; "),
        dir: pluginDir,
      });
    } else {
      this.plugins.set(pluginId, {
        id: pluginId,
        meta: result.meta,
        enabled,
        status: "disabled",
        order,
        dir: pluginDir,
      });
    }

    void this.saveRegistry();
  }

  private addDirtyReason(
    pluginId: string,
    reason: DirtyReason["reason"],
  ): void {
    // Avoid duplicates
    if (
      this.dirtyReasons.some(
        (r) => r.pluginId === pluginId && r.reason === reason,
      )
    )
      return;
    this.dirtyReasons.push({ pluginId, reason });
    this.notifyStatusChange();
  }

  private async saveRegistry(): Promise<void> {
    const registry: PluginRegistryEntry[] = [...this.plugins.values()]
      .map((p) => ({
        id: p.id,
        enabled: p.enabled,
        order: p.order,
      }));
    await setSetting(
      "plugin.system.registry",
      registry,
      "irminsul.plugin",
    );
  }
}
