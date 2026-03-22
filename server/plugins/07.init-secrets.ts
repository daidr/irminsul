// secrets.ts uses lazy initialization via a Proxy.
// This plugin calls loadSecrets() to load or generate secrets from disk,
// after directories have been created by plugin 01.
export default defineNitroPlugin(() => {
  console.log('[Plugin 07] Init secrets')
  loadSecrets()
})
