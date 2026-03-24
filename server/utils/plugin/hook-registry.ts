export interface RegisteredHandler {
  pluginId: string;
  hookName: string;
  order: number;
}

export class HookRegistry {
  private handlers = new Map<string, RegisteredHandler[]>();

  register(pluginId: string, hookName: string, order: number): void {
    const list = this.handlers.get(hookName) ?? [];
    list.push({ pluginId, hookName, order });
    list.sort((a, b) => a.order - b.order);
    this.handlers.set(hookName, list);
  }

  get(hookName: string): RegisteredHandler[] {
    return this.handlers.get(hookName) ?? [];
  }

  removePlugin(pluginId: string): void {
    for (const [hookName, list] of this.handlers) {
      const filtered = list.filter((h) => h.pluginId !== pluginId);
      if (filtered.length === 0) this.handlers.delete(hookName);
      else this.handlers.set(hookName, filtered);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
