import { initLogger } from "evlog";
import { createFsDrain } from "evlog/fs";
import { createDrainPipeline } from "evlog/pipeline";
import { createUserAgentEnricher } from "evlog/enrichers";
import type { DrainContext } from "evlog";
import type { PipelineDrainFn } from "evlog/pipeline";
import type { NitroApp } from "nitropack/types";

const LOG_DIR = "./irminsul-data/log";

export function initEvlogDrain(nitroApp: NitroApp) {
  const config = useRuntimeConfig();

  let drain: PipelineDrainFn<DrainContext> | undefined;

  if (!import.meta.dev) {
    const maxFiles = Number(config.evlogMaxFiles) || 30;
    const fsDrain = createFsDrain({ dir: LOG_DIR, maxFiles });
    const pipeline = createDrainPipeline<DrainContext>({
      batch: { size: 50, intervalMs: 5000 },
      retry: { maxAttempts: 3 },
    });
    drain = pipeline(fsDrain);

    nitroApp.hooks.hook("evlog:drain", drain);
    nitroApp.hooks.hook("close", () => drain!.flush());
  }

  const samplingInfo = Number(config.evlogSamplingInfo) || 100;
  const samplingDebug = import.meta.dev ? 100 : Number(config.evlogSamplingDebug) || 0;

  initLogger({
    env: { service: "irminsul" },
    sampling: {
      rates: { info: samplingInfo, debug: samplingDebug },
    },
    pretty: import.meta.dev,
    ...(drain ? { drain: (ctx: DrainContext) => drain!(ctx) } : {}),
    _suppressDrainWarning: true,
  });

  const uaEnricher = createUserAgentEnricher();
  nitroApp.hooks.hook("evlog:enrich", uaEnricher);
}
