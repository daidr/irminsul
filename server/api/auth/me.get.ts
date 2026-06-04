export default defineEventHandler((event) => {
  // 登出时返回 null（而非 {}），让前端 `if (!user)` 守卫与 useUser 的 ClientUser | null 类型成立
  return event.context.user ?? null;
});
