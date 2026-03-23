export default defineNitroPlugin(async () => {
  console.log("[Plugin 04] Init indexes");
  await ensureUserIndexes();
  await ensureSettingsIndexes();
});
