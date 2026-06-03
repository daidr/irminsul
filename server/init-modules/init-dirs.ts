import { createLogger } from "evlog";
import fs from "node:fs";

const DIRS = [DATA_DIR, LOG_DIR, TEXTURES_DIR, AUTO_GENERATE_DIR, PLUGINS_DIR];

export function initDirs() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "init-dirs" });
  for (const dir of DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
  log.set({ status: "ok" });
  log.emit();
}
