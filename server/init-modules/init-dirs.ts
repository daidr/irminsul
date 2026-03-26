import { createLogger } from "evlog";
import fs from "node:fs";

const DATA_DIR = "./irminsul-data";
const DIRS = [
  DATA_DIR,
  `${DATA_DIR}/log`,
  `${DATA_DIR}/textures`,
  `${DATA_DIR}/auto-generate`,
  `${DATA_DIR}/plugins`,
];

export function initDirs() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "init-dirs" });
  for (const dir of DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
  log.set({ status: "ok" });
  log.emit();
}
