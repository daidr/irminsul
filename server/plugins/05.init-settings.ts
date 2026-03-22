export default defineNitroPlugin(async () => {
  console.log('[Plugin 05] Init settings')
  await initBuiltinSettings()
  await loadSettingsCache()
})
