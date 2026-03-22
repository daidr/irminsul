export default defineYggdrasilHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  return yggdrasilPlayerCertificates(authorization, extractClientIp(event));
});
