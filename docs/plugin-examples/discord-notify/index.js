export function setup(ctx) {
  async function send(content) {
    const { webhookUrl } = ctx.config.getAll();
    if (!webhookUrl) return;
    await ctx.fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  ctx.hook("user:registered", (e) => {
    send(`📋 新用户注册：**${e.gameId}**（${e.email}）`);
  });

  ctx.hook("user:login", (e) => {
    const { enableLogin } = ctx.config.getAll();
    if (!enableLogin) return;
    const methods = { password: "密码", passkey: "Passkey", oauth: "OAuth" };
    send(`🔑 用户登录：**${e.gameId}**（${methods[e.method]}）`);
  });

  ctx.hook("user:banned", (e) => {
    const duration = e.end
      ? `至 ${new Date(e.end).toLocaleDateString()}`
      : "永久";
    send(
      `🚫 用户封禁：**${e.gameId}**（${duration}）${e.reason ? `\n理由：${e.reason}` : ""}`,
    );
  });

  ctx.hook("user:unbanned", (e) => {
    send(`✅ 用户解封：**${e.gameId}**`);
  });
}
