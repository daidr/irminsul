export default defineYggdrasilHandler(async () => {
  const config = useRuntimeConfig();
  const skinDomains = config.yggdrasilSkinDomains.split(",").filter(Boolean);

  return {
    meta: {
      implementationName: "irminsul",
      implementationVersion: "1.0.0",
      serverName: config.public.siteName,
      "feature.enable_profile_key": true,
      links: {},
    },
    skinDomains,
    signaturePublickey: getPublicKeyPem() || "",
  };
});
