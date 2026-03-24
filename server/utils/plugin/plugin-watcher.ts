import { watch, existsSync, statSync } from "node:fs";
import { join } from "node:path";

interface PluginWatcherCallbacks {
  onPluginChanged: (pluginId: string) => void;
  onPluginRemoved: (pluginId: string) => void;
}

export class PluginWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs = 500;
  private pluginsDir: string;
  private callbacks: PluginWatcherCallbacks;

  constructor(pluginsDir: string, callbacks: PluginWatcherCallbacks) {
    this.pluginsDir = pluginsDir;
    this.callbacks = callbacks;
  }

  start(): void {
    if (!existsSync(this.pluginsDir)) return;
    this.watcher = watch(
      this.pluginsDir,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const parts = filename.replace(/\\/g, "/").split("/");
        const pluginId = parts[0];
        if (!pluginId) return;

        const relPath = parts.slice(1).join("/");
        if (this.shouldIgnore(relPath)) return;

        const existing = this.debounceTimers.get(pluginId);
        if (existing) clearTimeout(existing);
        this.debounceTimers.set(
          pluginId,
          setTimeout(() => {
            this.debounceTimers.delete(pluginId);
            this.handleChange(pluginId);
          }, this.debounceMs),
        );
      },
    );
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }

  private shouldIgnore(relPath: string): boolean {
    if (!relPath) return false;
    return (
      /(?:^|\/)(?:node_modules|\.git|logs)(?:\/|$)/.test(relPath) ||
      /\.tmp$|~$/.test(relPath)
    );
  }

  private handleChange(pluginId: string): void {
    const pluginDir = join(this.pluginsDir, pluginId);
    if (
      !existsSync(pluginDir) ||
      !statSync(pluginDir).isDirectory()
    ) {
      this.callbacks.onPluginRemoved(pluginId);
      return;
    }
    const yamlPath = join(pluginDir, "plugin.yaml");
    const ymlPath = join(pluginDir, "plugin.yml");
    if (!existsSync(yamlPath) && !existsSync(ymlPath)) {
      return;
    }
    this.callbacks.onPluginChanged(pluginId);
  }
}
