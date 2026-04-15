import { join } from "node:path";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./types";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PluginBridgeOptions {
  onLog: (msg: Extract<WorkerToMainMessage, { type: "log" }>) => void;
  onHookRegister: (pluginId: string, hookName: string) => void;
  onCrash: (error: string) => void;
  hookTimeoutMs?: number;
}

export class PluginBridge {
  private worker: Worker | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private pendingLoads = new Map<string, PendingCall>();
  private callIdCounter = 0;
  private shuttingDown = false;
  private readonly onLog: PluginBridgeOptions["onLog"];
  private readonly onHookRegister: PluginBridgeOptions["onHookRegister"];
  private readonly onCrash: PluginBridgeOptions["onCrash"];
  private readonly hookTimeoutMs: number;

  private boundOnMessage = (e: MessageEvent<WorkerToMainMessage>) => this.handleMessage(e.data);
  private boundOnError = (e: ErrorEvent) => {
    if (!this.shuttingDown) this.handleCrash(e.message ?? "Worker error");
  };
  private boundOnClose = () => {
    if (this.worker && !this.shuttingDown) this.handleCrash("Worker closed unexpectedly");
  };

  constructor(opts: PluginBridgeOptions) {
    this.onLog = opts.onLog;
    this.onHookRegister = opts.onHookRegister;
    this.onCrash = opts.onCrash;
    this.hookTimeoutMs = opts.hookTimeoutMs ?? 30_000;
  }

  start(): void {
    this.shuttingDown = false;
    const workerPath = join(process.cwd(), "server", "worker", "plugin-host.ts");
    this.worker = new Worker(workerPath, {
      smol: true,
    });
    (this.worker as any).unref();
    this.worker.addEventListener("message", this.boundOnMessage);
    this.worker.addEventListener("error", this.boundOnError);
    this.worker.addEventListener("close", this.boundOnClose);
    this.send({ type: "init" });
  }

  async loadPlugin(payload: {
    pluginId: string;
    pluginDir: string;
    entryPath: string;
    config: Record<string, unknown>;
    meta: { id: string; name: string; version: string; dir: string };
    allowedHooks: string[];
  }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingLoads.delete(payload.pluginId);
        reject(new Error(`Plugin ${payload.pluginId} load timed out`));
      }, this.hookTimeoutMs);
      this.pendingLoads.set(payload.pluginId, {
        resolve: () => resolve(),
        reject,
        timer,
      });
      this.send({ type: "plugin:load", ...payload });
    });
  }

  async callHook(pluginId: string, hookName: string, ...args: unknown[]): Promise<unknown> {
    const callId = String(++this.callIdCounter);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(
          new Error(`Hook ${hookName} on ${pluginId} timed out after ${this.hookTimeoutMs}ms`),
        );
      }, this.hookTimeoutMs);
      this.pendingCalls.set(callId, { resolve, reject, timer });
      this.send({ type: "hook:call", pluginId, hookName, args, callId });
    });
  }

  updateConfig(
    pluginId: string,
    config: Record<string, unknown>,
    changes: Record<string, { old: unknown; new: unknown }>,
  ): void {
    this.send({ type: "config:update", pluginId, config, changes });
  }

  async shutdown(): Promise<void> {
    if (!this.worker) return;
    this.shuttingDown = true;
    this.send({ type: "shutdown" });
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.worker?.removeEventListener("message", onDone);
        resolve();
      }, 10_000);
      const onDone = (e: MessageEvent<WorkerToMainMessage>) => {
        if (e.data.type !== "shutdown:done") return;
        clearTimeout(timeout);
        this.worker?.removeEventListener("message", onDone);
        resolve();
      };
      this.worker!.addEventListener("message", onDone);
    });
    this.terminate();
  }

  terminate(): void {
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    // Remove listeners before terminate to prevent stale event firing
    w.removeEventListener("message", this.boundOnMessage);
    w.removeEventListener("error", this.boundOnError);
    w.removeEventListener("close", this.boundOnClose);
    // Reject all pending calls
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Worker terminated"));
    }
    this.pendingCalls.clear();
    for (const [, pending] of this.pendingLoads) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Worker terminated"));
    }
    this.pendingLoads.clear();
    w.terminate();
  }

  get isRunning(): boolean {
    return this.worker !== null;
  }

  private send(msg: MainToWorkerMessage): void {
    this.worker?.postMessage(msg);
  }

  private handleMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case "hook:result": {
        const pending = this.pendingCalls.get(msg.callId);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.pendingCalls.delete(msg.callId);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error ?? "Hook call failed"));
        }
        break;
      }

      case "plugin:loaded": {
        const pending = this.pendingLoads.get(msg.pluginId);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.pendingLoads.delete(msg.pluginId);
        if (msg.ok) {
          pending.resolve(undefined);
        } else {
          pending.reject(new Error(msg.error ?? "Plugin load failed"));
        }
        break;
      }

      case "hook:register": {
        this.onHookRegister(msg.pluginId, msg.hookName);
        break;
      }

      case "log": {
        this.onLog(msg);
        break;
      }
    }
  }

  private handleCrash(error: string): void {
    // Reject all pending calls
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Worker crashed: ${error}`));
    }
    this.pendingCalls.clear();
    for (const [, pending] of this.pendingLoads) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Worker crashed: ${error}`));
    }
    this.pendingLoads.clear();
    this.worker = null;
    this.onCrash(error);
  }
}
