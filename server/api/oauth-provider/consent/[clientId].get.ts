// Public metadata endpoint for the OAuth consent screen (/oauth/authorize).
// Returns only the fields needed to render the consent UI for any logged-in
// end user, without exposing owner/secret/redirect-uri details.
//
// Unapproved apps are reported as 404 so client_id enumeration cannot
// distinguish "not approved" from "does not exist".
export default defineEventHandler(async (event) => {
  requireAuth(event);

  const clientId = getRouterParam(event, "clientId");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing clientId" });
  }

  const app = await findOAuthAppByClientId(clientId);
  if (!app || !app.approved) {
    throw createError({ statusCode: 404, statusMessage: "App not found" });
  }

  return {
    name: app.name,
    description: app.description,
    icon: app.icon,
  };
});
