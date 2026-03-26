import { createFsDrain } from "evlog/fs";
import { createDrainPipeline } from "evlog/pipeline";
import type { DrainContext } from "evlog";
import type { NitroApp } from "nitropack/types";

const LOG_DIR = "./irminsul-data/log";

export function initEvlogDrain(nitroApp: NitroApp) {
  const config = useRuntimeConfig();
  const rawMaxFiles = Number(config.evlogMaxFiles);
  const rawSamplingInfo = Number(config.evlogSamplingInfo);
  const rawSamplingDebug = Number(config.evlogSamplingDebug);
  const maxFiles = Number.isNaN(rawMaxFiles) ? 30 : rawMaxFiles;
  const samplingInfo = Number.isNaN(rawSamplingInfo) ? 100 : rawSamplingInfo;
  const samplingDebug = Number.isNaN(rawSamplingDebug) ? 10 : rawSamplingDebug;

  const fsDrain = createFsDrain({ dir: LOG_DIR, maxFiles });

  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 50, intervalMs: 5000 },
    retry: { maxAttempts: 3 },
  });
  const drain = pipeline(fsDrain);

  nitroApp.hooks.hook("evlog:drain" as any, drain);
  nitroApp.hooks.hook("close", () => drain.flush());

  nitroApp.hooks.hook("evlog:emit:keep" as any, (ctx: any) => {
    const level = ctx.event?.level;
    if (level === "info" && Math.random() * 100 > samplingInfo) ctx.shouldKeep = false;
    if (level === "debug" && Math.random() * 100 > samplingDebug) ctx.shouldKeep = false;
  });
}
