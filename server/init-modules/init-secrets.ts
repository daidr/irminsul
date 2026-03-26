import { createLogger } from "evlog";

export function initSecrets() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "init-secrets" });
  loadSecrets();
  log.set({ status: "ok" });
  log.emit();
}
