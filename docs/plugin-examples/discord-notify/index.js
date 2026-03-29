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

  ctx.hook("user:ban-created", (e) => {
    const duration = e.ban.end
      ? `至 ${new Date(e.ban.end).toLocaleDateString()}`
      : "永久";
    send(
      `🚫 用户封禁：**${e.gameId}**（${duration}）${e.ban.reason ? `\n理由：${e.ban.reason}` : ""}`,
    );
  });

  ctx.hook("user:ban-edited", (e) => {
    const oldDuration = e.old.end
      ? `至 ${new Date(e.old.end).toLocaleDateString()}`
      : "永久";
    const newDuration = e.new.end
      ? `至 ${new Date(e.new.end).toLocaleDateString()}`
      : "永久";
    send(`📝 封禁变更：**${e.gameId}**\n${oldDuration} → ${newDuration}`);
  });

  ctx.hook("user:ban-revoked", (e) => {
    send(`✅ 用户解封：**${e.gameId}**`);
  });

  ctx.hook("user:ban-deleted", (e) => {
    const status = e.wasActive ? "（活跃封禁）" : "（已失效）";
    send(`🗑️ 封禁记录删除：**${e.gameId}**${status}`);
  });
}
