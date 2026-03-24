import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

const PLUGIN_MANAGER_KEY = Symbol.for("irminsul.pluginManager");

export function getPluginManager(): PluginManager {
  return (globalThis as any)[PLUGIN_MANAGER_KEY];
}

export function setPluginManager(manager: PluginManager): void {
  (globalThis as any)[PLUGIN_MANAGER_KEY] = manager;
}

export class PluginManager {
  private plugins = new Map<string, PluginState>();
  private dirtyReasons: DirtyReason[] = [];
  private hostStatus: HostStatus = "stopped";
  private bridge: PluginBridge;
  private hookRegistry = new HookRegistry();
  private logManager: PluginLogManager;
  private watcher: PluginWatcher | null = null;
  private pluginsDir: string;

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
    if (!existsSync(this.pluginsDir)) return;

    const dirs = readdirSync(this.pluginsDir, { withFileTypes: true }).filter(
      (d) => d.isDirectory(),
    );

    const discovered = new Map<string, PluginState>();

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

      if (!result.ok) {
        discovered.set(dir.name, {
          id: dir.name,
          meta: { name: dir.name, version: "0.0.0", hooks: [] },
          status: "error",
          order: 0,
          error: result.errors.join("; "),
          dir: pluginDir,
        });
        continue;
      }

      discovered.set(dir.name, {
        id: dir.name,
        meta: result.meta,
        status: "disabled",
        order: 0,
        dir: pluginDir,
      });
    }

    // Sync with registry
    const registry =
      ((getSetting("plugin.system.registry") as PluginRegistryEntry[]) ?? []);
    const registryMap = new Map(registry.map((e) => [e.id, e]));

    // Update discovered plugins with registry state
    let maxOrder = 0;
    for (const entry of registry) {
      if (entry.order > maxOrder) maxOrder = entry.order;
      const plugin = discovered.get(entry.id);
      if (plugin && plugin.status !== "error") {
        plugin.order = entry.order;
        plugin.status = "disabled"; // will be set to enabled on load
        // Store enabled flag temporarily
        (plugin as any)._shouldEnable = entry.enabled;
      }
    }

    // New plugins get next order
    for (const [id, plugin] of discovered) {
      if (!registryMap.has(id) && plugin.status !== "error") {
        maxOrder++;
        plugin.order = maxOrder;
      }
    }

    this.plugins = discovered;

    // Save updated registry
    await this.saveRegistry();
  }

  async start(): Promise<void> {
    this.bridge.start();
    this.hostStatus = "running";

    // Load enabled plugins in order
    const toLoad = [...this.plugins.values()]
      .filter((p) => (p as any)._shouldEnable && p.status !== "error")
      .sort((a, b) => a.order - b.order);

    for (const plugin of toLoad) {
      await this.loadPluginIntoHost(plugin);
      delete (plugin as any)._shouldEnable;
    }

    // Clean up _shouldEnable on remaining
    for (const plugin of this.plugins.values()) {
      delete (plugin as any)._shouldEnable;
    }

    // Start watcher if enabled
    const watcherEnabled = getSetting("plugin.system.watcher") as boolean;
    if (watcherEnabled !== false) {
      this.startWatcher();
    }

    // Cleanup expired logs
    const retentionDays =
      (getSetting("plugin.system.logRetentionDays") as number) ?? 7;
    this.logManager.cleanupExpiredLogs(retentionDays);
  }

  // === Plugin Lifecycle ===

  async enablePlugin(id: string): Promise<{ ok: boolean; error?: string }> {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status === "enabled") return { ok: true };
    if (plugin.status === "error" && plugin.meta.hooks.length === 0) {
      return { ok: false, error: plugin.error ?? "Plugin has errors" };
    }

    try {
      await this.loadPluginIntoHost(plugin);

      // Update registry
      plugin.status = "enabled";
      plugin.error = undefined;
      await this.saveRegistry();

      return { ok: true };
    } catch (err: unknown) {
      plugin.status = "error";
      plugin.error = err instanceof Error ? err.message : String(err);
      await this.saveRegistry();
      return { ok: false, error: plugin.error };
    }
  }

  async disablePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin || plugin.status !== "enabled") return;

    // Remove from hook registry (stop forwarding calls)
    this.hookRegistry.removePlugin(id);

    // Mark dirty
    plugin.status = "disabled";
    this.addDirtyReason(id, "disabled");

    await this.saveRegistry();
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
      const plugin = this.plugins.get(ids[i]);
      if (plugin) plugin.order = i + 1;
    }
    await this.saveRegistry();
  }

  // === Host Management ===

  async restartHost(): Promise<void> {
    // Shutdown existing Host
    await this.bridge.shutdown();
    this.hookRegistry.clear();
    this.hostStatus = "stopped";

    // Create new Host
    this.bridge.start();
    this.hostStatus = "running";

    // Reload all enabled plugins
    const toLoad = [...this.plugins.values()]
      .filter((p) => p.status === "enabled")
      .sort((a, b) => a.order - b.order);

    for (const plugin of toLoad) {
      await this.loadPluginIntoHost(plugin);
    }

    // Clear dirty state
    this.dirtyReasons = [];
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

  getLogManager(): PluginLogManager {
    return this.logManager;
  }

  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  // === Evlog Bridge ===

  bridgeEvlogHooks(nitroApp: any): void {
    nitroApp.hooks.hook("evlog:drain", async (events: any[]) => {
      // Enrichers: patch model
      for (const handler of this.hookRegistry.get("evlog:enricher")) {
        try {
          const patches = (await this.bridge.callHook(
            handler.pluginId,
            "evlog:enricher",
            events,
          )) as Record<string, unknown>[];
          if (Array.isArray(patches)) {
            for (let i = 0; i < events.length && i < patches.length; i++) {
              if (patches[i]) Object.assign(events[i], patches[i]);
            }
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

      // Drains
      for (const handler of this.hookRegistry.get("evlog:drain")) {
        try {
          await this.bridge.callHook(
            handler.pluginId,
            "evlog:drain",
            events,
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

  // === Cleanup ===

  async destroy(): Promise<void> {
    this.watcher?.stop();
    await this.bridge.shutdown();
    this.logManager.destroy();
    this.hookRegistry.clear();
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
    // eslint-disable-next-line no-console
    console.error(`[plugin-manager] Host crashed: ${error}`);

    this.hostStatus = "crashed";
    this.hookRegistry.clear();

    // Prevent infinite restart loop: max 3 restarts within 30 seconds
    if (now - this.lastCrashTime < 30_000) {
      this.crashCount++;
    } else {
      this.crashCount = 1;
    }
    this.lastCrashTime = now;

    if (this.crashCount > 3) {
      // eslint-disable-next-line no-console
      console.error("[plugin-manager] Too many crashes, giving up auto-restart");
      return;
    }

    // Auto-restart after delay
    setTimeout(async () => {
      try {
        this.bridge.start();
        this.hostStatus = "running";

        const toLoad = [...this.plugins.values()]
          .filter((p) => p.status === "enabled")
          .sort((a, b) => a.order - b.order);

        for (const plugin of toLoad) {
          try {
            await this.loadPluginIntoHost(plugin);
          } catch {
            plugin.status = "error";
            plugin.error = "Failed to reload after crash";
          }
        }

        this.dirtyReasons = [];
      } catch (restartErr) {
        // eslint-disable-next-line no-console
        console.error(`[plugin-manager] Recovery failed: ${restartErr}`);
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

    if (!result.ok) {
      this.plugins.set(pluginId, {
        id: pluginId,
        meta: { name: pluginId, version: "0.0.0", hooks: [] },
        status: "error",
        order,
        error: result.errors.join("; "),
        dir: pluginDir,
      });
    } else {
      this.plugins.set(pluginId, {
        id: pluginId,
        meta: result.meta,
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
  }

  private async saveRegistry(): Promise<void> {
    const registry: PluginRegistryEntry[] = [...this.plugins.values()]
      .filter((p) => p.status !== "error" || p.meta.hooks.length > 0)
      .map((p) => ({
        id: p.id,
        enabled: p.status === "enabled",
        order: p.order,
      }));
    await setSetting(
      "plugin.system.registry",
      registry,
      "irminsul.plugin",
    );
  }
}
