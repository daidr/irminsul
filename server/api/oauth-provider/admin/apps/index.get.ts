export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const query = getQuery(event);
  const filter: { approved?: boolean } = {};

  if (query.approved === "true") {
    filter.approved = true;
  } else if (query.approved === "false") {
    filter.approved = false;
  }

  const apps = await findAllOAuthApps(filter);
  return apps.map(({ clientSecretHash, ...rest }) => rest);
});
