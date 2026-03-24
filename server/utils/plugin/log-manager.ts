import { existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginLogEntry } from "./types";
import { RingBuffer } from "./ring-buffer";

export interface LogFilters {
  level?: string;
  type?: string;
}

export interface HistoryOpts {
  before?: string; // ISO timestamp cursor
  limit?: number; // default 50
  level?: string;
  type?: string;
}

export interface HistoryResult {
  logs: PluginLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class PluginLogManager {
  private buffers = new Map<string, RingBuffer<PluginLogEntry>>();
  private subscribers = new Map<
    string,
    Set<{ controller: ReadableStreamDefaultController; filters?: LogFilters }>
  >();
  private bufferSize: number;
  private pluginsDir: string;

  constructor(pluginsDir: string, bufferSize = 200) {
    this.pluginsDir = pluginsDir;
    this.bufferSize = bufferSize;
  }

  push(entry: PluginLogEntry): void {
    const { pluginId } = entry;

    // Ring buffer
    if (!this.buffers.has(pluginId)) {
      this.buffers.set(pluginId, new RingBuffer<PluginLogEntry>(this.bufferSize));
    }
    this.buffers.get(pluginId)!.push(entry);

    // File persistence (sync append — fast for single lines)
    const logsDir = join(this.pluginsDir, pluginId, "logs");
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = join(logsDir, `${date}.jsonl`);
    appendFileSync(filePath, JSON.stringify(entry) + "\n");

    // SSE notify
    const subs = this.subscribers.get(pluginId);
    if (subs) {
      const encoded = new TextEncoder().encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
      for (const sub of subs) {
        if (sub.filters) {
          if (sub.filters.level && entry.level !== sub.filters.level) continue;
          if (sub.filters.type && entry.type !== sub.filters.type) continue;
        }
        try {
          sub.controller.enqueue(encoded);
        } catch {
          subs.delete(sub); // client disconnected
        }
      }
    }
  }

  getBuffer(pluginId: string, filters?: LogFilters): PluginLogEntry[] {
    const buffer = this.buffers.get(pluginId);
    if (!buffer) return [];
    if (!filters) return buffer.toArray();
    return buffer.filter((entry) => {
      if (filters.level && entry.level !== filters.level) return false;
      if (filters.type && entry.type !== filters.type) return false;
      return true;
    });
  }

  subscribe(
    pluginId: string,
    controller: ReadableStreamDefaultController,
    filters?: LogFilters,
  ): () => void {
    if (!this.subscribers.has(pluginId)) {
      this.subscribers.set(pluginId, new Set());
    }
    const sub = { controller, filters };
    this.subscribers.get(pluginId)!.add(sub);
    return () => {
      this.subscribers.get(pluginId)?.delete(sub);
    };
  }

  getHistory(pluginId: string, opts: HistoryOpts = {}): HistoryResult {
    const limit = opts.limit ?? 50;
    const logsDir = join(this.pluginsDir, pluginId, "logs");
    if (!existsSync(logsDir)) return { logs: [], nextCursor: null, hasMore: false };

    // List available log files sorted descending (newest first)
    const files = readdirSync(logsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    const logs: PluginLogEntry[] = [];

    for (const file of files) {
      const filePath = join(logsDir, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);

      // Parse lines in reverse (newest first)
      for (let i = lines.length - 1; i >= 0; i--) {
        let entry: PluginLogEntry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue;
        }

        // Cursor filter: skip entries at or after the cursor
        if (opts.before && entry.timestamp >= opts.before) continue;

        // Level/type filter
        if (opts.level && entry.level !== opts.level) continue;
        if (opts.type && entry.type !== opts.type) continue;

        if (logs.length >= limit) {
          // Reverse to chronological order (oldest first) before returning
          logs.reverse();
          return { logs, nextCursor: entry.timestamp, hasMore: true };
        }

        logs.push(entry);
      }
    }

    // Reverse to chronological order (oldest first)
    logs.reverse();
    return { logs, nextCursor: null, hasMore: false };
  }

  async clearLogs(pluginId: string): Promise<void> {
    // Clear ring buffer
    this.buffers.get(pluginId)?.clear();

    // Delete log files
    const logsDir = join(this.pluginsDir, pluginId, "logs");
    if (!existsSync(logsDir)) return;
    const files = readdirSync(logsDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        unlinkSync(join(logsDir, file));
      }
    }
  }

  cleanupExpiredLogs(retentionDays: number): void {
    if (!existsSync(this.pluginsDir)) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const pluginDirs = readdirSync(this.pluginsDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    );

    for (const dir of pluginDirs) {
      const logsDir = join(this.pluginsDir, dir.name, "logs");
      if (!existsSync(logsDir)) continue;
      const files = readdirSync(logsDir);
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          const date = file.replace(".jsonl", "");
          if (date < cutoffStr) {
            unlinkSync(join(logsDir, file));
          }
        }
      }
    }
  }

  destroy(): void {
    this.buffers.clear();
    for (const subs of this.subscribers.values()) {
      for (const sub of subs) {
        try {
          sub.controller.close();
        } catch {
          // client already disconnected
        }
      }
    }
    this.subscribers.clear();
  }
}
