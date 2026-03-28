/**
 * OAuth POST 回调 — 支持 response_mode=form_post（如 Apple Sign In）
 * 第三方以 POST + application/x-www-form-urlencoded 方式将 code/state 提交到此端点
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return handleOAuthCallback(event, {
    code: body?.code as string,
    state: body?.state as string,
    error: body?.error as string | undefined,
    rawParams: (body ?? {}) as Record<string, unknown>,
  });
});
