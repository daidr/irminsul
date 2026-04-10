const ALL_SETTING_KEYS = [
  "smtp.host",
  "smtp.port",
  "smtp.secure",
  "smtp.user",
  "smtp.pass",
  "smtp.from",
  "auth.requireEmailVerification",
  "oauth.enabled",
  "general.announcement",
];

export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const settings = getSettingsMap(ALL_SETTING_KEYS);
  return { success: true, settings };
});
