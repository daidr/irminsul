export default defineNitroPlugin(async () => {
  await loadOrGenerateKeys();
});
