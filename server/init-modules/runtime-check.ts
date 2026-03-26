import { createLogger } from "evlog";

export function initRuntimeCheck() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "runtime-check" });

  if (typeof Bun === "undefined") {
    log.set({ error: "Irminsul requires Bun runtime" });
    log.emit();
    process.exit(1);
  }

  process.on("uncaughtException", (err) => {
    const errLog = createLogger({ category: "error" });
    errLog.set({ type: "uncaughtException", message: String(err) });
    errLog.error(err);
    errLog.emit();
  });
  process.on("unhandledRejection", (reason) => {
    const errLog = createLogger({ category: "error" });
    errLog.set({ type: "unhandledRejection", message: String(reason) });
    errLog.emit();
  });

  log.set({ status: "ok" });
  log.emit();
}
