import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export default defineEventHandler((event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const query = getQuery(event);
  const date = (query.date as string) ?? new Date().toISOString().slice(0, 10);

  const manager = getPluginManager();
  const plugin = manager.getPlugin(id);
  if (!plugin) throw createError({ statusCode: 404, message: "Plugin not found" });

  const filePath = join(plugin.dir, "logs", `${date}.jsonl`);
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: "Log file not found for this date" });
  }

  const content = readFileSync(filePath, "utf-8");
  setResponseHeader(event, "Content-Type", "application/x-ndjson");
  setResponseHeader(event, "Content-Disposition", `attachment; filename="${id}-${date}.jsonl"`);
  return content;
});
