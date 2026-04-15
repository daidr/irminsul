import { initRuntimeCheck } from "../init-modules/runtime-check";
import { initDirs } from "../init-modules/init-dirs";
import { initEvlogDrain } from "../init-modules/evlog-drain";
import { initDb } from "../init-modules/db";
import { initIndexes } from "../init-modules/init-indexes";
import { initSettings } from "../init-modules/init-settings";
import { initKeys } from "../init-modules/init-keys";
import { initSecrets } from "../init-modules/init-secrets";
import { initPlugins } from "../init-modules/plugins";

export default defineNitroPlugin(async (nitroApp) => {
  if (import.meta.prerender) {
    return;
  }

  // Phase 1: Sync setup
  initEvlogDrain(nitroApp);
  initRuntimeCheck();
  initDirs();
  initDb(nitroApp);

  // Phase 2: Async init (all depend on DB, can run in parallel)
  await Promise.all([initIndexes(), initSettings(), initKeys()]);
  initSecrets();

  // Phase 3: Plugin system (depends on settings)
  await initPlugins(nitroApp);
});
