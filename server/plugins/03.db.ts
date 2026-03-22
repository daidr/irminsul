export default defineNitroPlugin((nitroApp) => {
  console.log('[Plugin 03] DB connections')
  // Trigger lazy connections by accessing once
  getDb()
  getRedisClient()

  nitroApp.hooks.hook('close', async () => {
    await gracefulCloseDB()
    await gracefulCloseRedis()
  })
})
