export default defineNitroPlugin(() => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "07.init-secrets" });
  loadSecrets();
  log.set({ status: "ok" });
  log.emit();
});
