import type { UserHookPayloadMap } from "./plugin/types";
import { getPluginManager } from "./plugin/plugin-manager";

export function emitUserHook<K extends keyof UserHookPayloadMap>(
  hookName: K,
  payload: UserHookPayloadMap[K],
): void {
  const manager = getPluginManager();
  if (!manager) return;

  const { status } = manager.getHostStatus();
  if (status !== "running" && status !== "dirty") return;

  manager.emitUserHook(hookName, payload).catch((err) => {
    console.warn(`[plugin] emitUserHook(${hookName}) unexpected error:`, err);
  });
}
