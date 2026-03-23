import { createFsDrain } from "evlog/fs";
import { createDrainPipeline } from "evlog/pipeline";
import type { DrainContext } from "evlog";

const LOG_DIR = "./irminsul-data/log";

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();
  const maxFiles = Number(config.evlogMaxFiles) || 30;
  const samplingInfo = Number(config.evlogSamplingInfo) || 100;
  const samplingDebug = Number(config.evlogSamplingDebug) || 10;

  const fsDrain = createFsDrain({ dir: LOG_DIR, maxFiles });

  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 50, intervalMs: 5000 },
    retry: { maxAttempts: 3 },
  });
  const drain = pipeline(fsDrain);

  // 扩展点：未来在此添加外部 drain
  // 例如：const axiomDrain = pipeline(createAxiomDrain());

  nitroApp.hooks.hook("evlog:drain", drain);
  nitroApp.hooks.hook("close", () => drain.flush());

  // 从环境变量应用采样率
  nitroApp.hooks.hook("evlog:emit:keep", (ctx) => {
    const level = ctx.event?.level;
    if (level === "info" && Math.random() * 100 > samplingInfo) ctx.shouldKeep = false;
    if (level === "debug" && Math.random() * 100 > samplingDebug) ctx.shouldKeep = false;
  });
});
