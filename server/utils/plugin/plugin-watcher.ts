import { watch, existsSync, statSync, readdirSync } from "node:fs";
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
  /** 每个插件目录的关键文件最大 mtime，用于过滤 access-only 事件 */
  private mtimeSnapshot = new Map<string, number>();

  constructor(pluginsDir: string, callbacks: PluginWatcherCallbacks) {
    this.pluginsDir = pluginsDir;
    this.callbacks = callbacks;
  }

  start(): void {
    if (!existsSync(this.pluginsDir)) return;
    // 初始化 mtime 快照
    this.snapshotAll();
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

  /** 手动更新指定插件的 mtime 快照（供外部在加载插件后调用） */
  updateSnapshot(pluginId: string): void {
    const mtime = this.getPluginMtime(pluginId);
    if (mtime !== null) {
      this.mtimeSnapshot.set(pluginId, mtime);
    }
  }

  private shouldIgnore(relPath: string): boolean {
    if (!relPath) return false;
    return (
      /(?:^|\/)(?:node_modules|\.git|logs)(?:\/|$)/.test(relPath) ||
      /^logs$/.test(relPath) ||
      /\.tmp$|~$|\.jsonl$/.test(relPath)
    );
  }

  private handleChange(pluginId: string): void {
    const pluginDir = join(this.pluginsDir, pluginId);
    if (
      !existsSync(pluginDir) ||
      !statSync(pluginDir).isDirectory()
    ) {
      this.mtimeSnapshot.delete(pluginId);
      this.callbacks.onPluginRemoved(pluginId);
      return;
    }
    const yamlPath = join(pluginDir, "plugin.yaml");
    const ymlPath = join(pluginDir, "plugin.yml");
    if (!existsSync(yamlPath) && !existsSync(ymlPath)) {
      return;
    }

    // 比较 mtime：只有文件内容真正被修改时才触发回调
    const currentMtime = this.getPluginMtime(pluginId);
    const previousMtime = this.mtimeSnapshot.get(pluginId) ?? 0;
    if (currentMtime !== null && currentMtime <= previousMtime) {
      return; // mtime 未变化，跳过（access-only 事件）
    }

    // 更新快照并触发回调
    if (currentMtime !== null) {
      this.mtimeSnapshot.set(pluginId, currentMtime);
    }
    this.callbacks.onPluginChanged(pluginId);
  }

  /** 获取插件目录下所有关键文件的最大 mtime */
  private getPluginMtime(pluginId: string): number | null {
    const pluginDir = join(this.pluginsDir, pluginId);
    if (!existsSync(pluginDir)) return null;

    let maxMtime = 0;
    try {
      const entries = readdirSync(pluginDir);
      for (const entry of entries) {
        // 只关注关键文件，忽略 node_modules/logs 等
        if (entry === "node_modules" || entry === "logs" || entry === ".git") continue;
        const fullPath = join(pluginDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && stat.mtimeMs > maxMtime) {
            maxMtime = stat.mtimeMs;
          }
        } catch {
          // 文件可能在 stat 过程中被删除
        }
      }
    } catch {
      return null;
    }
    return maxMtime || null;
  }

  /** 初始化所有已存在插件的 mtime 快照 */
  private snapshotAll(): void {
    if (!existsSync(this.pluginsDir)) return;
    try {
      const entries = readdirSync(this.pluginsDir);
      for (const entry of entries) {
        const mtime = this.getPluginMtime(entry);
        if (mtime !== null) {
          this.mtimeSnapshot.set(entry, mtime);
        }
      }
    } catch {
      // 忽略
    }
  }
}
