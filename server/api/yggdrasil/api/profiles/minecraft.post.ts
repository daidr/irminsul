export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, batchProfilesBodySchema.parse);
  return yggdrasilBatchProfiles(body);
});
