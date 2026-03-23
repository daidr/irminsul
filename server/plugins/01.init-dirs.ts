import fs from "node:fs";

const DATA_DIR = "./irminsul-data";
const LOG_DIR = `${DATA_DIR}/log`;
const TEXTURES_DIR = `${DATA_DIR}/textures`;
const AUTO_GENERATE_DIR = `${DATA_DIR}/auto-generate`;

export default defineNitroPlugin(() => {
  console.log("[Plugin 01] Init dirs");
  for (const dir of [DATA_DIR, LOG_DIR, TEXTURES_DIR, AUTO_GENERATE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
});
