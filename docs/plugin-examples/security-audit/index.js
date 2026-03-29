export function setup(ctx) {
  ctx.hook("user:password-changed", (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, ip: e.ip });
    ctx.log.info("用户主动修改密码");
  });

  ctx.hook("user:password-reset", (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, ip: e.ip });
    ctx.log.warn("用户通过忘记密码流程重置密码");
  });

  ctx.hook("user:oauth-bindchanged", (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, provider: e.provider });
    const msg =
      e.action === "bind"
        ? `绑定 OAuth 账号（${e.displayName}）`
        : "解绑 OAuth 账号";
    ctx.log.info(msg);
  });
}
