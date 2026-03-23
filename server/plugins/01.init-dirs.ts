import fs from "node:fs";

const DATA_DIR = "./irminsul-data";
const LOG_DIR = `${DATA_DIR}/log`;
const TEXTURES_DIR = `${DATA_DIR}/textures`;
const AUTO_GENERATE_DIR = `${DATA_DIR}/auto-generate`;

export default defineNitroPlugin(() => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "01.init-dirs" });
  for (const dir of [DATA_DIR, LOG_DIR, TEXTURES_DIR, AUTO_GENERATE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  log.set({ status: "ok" });
  log.emit();
});
