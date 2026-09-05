# Irminsul

[![MIT License](https://img.shields.io/badge/license-MIT-yellowgreen.svg?style=flat-square)](https://github.com/daidr/irminsul/blob/master/LICENSE)

轻量的 MC 服务器 yggdrasil 验证/皮肤加载解决方案

> [!WARNING]
> 在设计上，Irminsul 将取代原先的 GHAuth 项目，在[./cli](./cli)目录下提供了一键迁移脚本，用于将原先的 GHAuth 数据迁移到 Irminsul 中。
>
> 请在迁移前完整备份 GHAuth 的数据表，并做好回滚准备。

线上 GHAuth 已经迁移到了 Irminsul，可以通过下面的链接访问：

[Irminsul SaaS](https://auth.daidr.me)

## 功能

- yggdrasil 协议支持
- 游戏皮肤、披风管理
- 用户列表、封禁管理
- 邮箱验证
- OAuth2 鉴权
- OAuth2 登录（通过插件提供）
- FIDO2 (WebAuthn) 登录
- 用户聊天信息验证密钥对（Java MC > 1.19.1）
- 插件系统（Preview）

## 环境

- MongoDB
- Redis
- Bun.js

## 部署

### Docker Compose

安装 Docker Engine 和 Docker Compose 插件，在项目根目录执行：

```bash
cp .env.example .env
```

编辑 `.env`，将 `auth.example.com` 替换为实际域名：

| 配置项                         | 说明                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `IRMIN_PUBLIC_SITE_NAME`       | 站点名称                                                                     |
| `IRMIN_YGGDRASIL_BASE_URL`     | 对外访问的站点地址，例如 `https://auth.example.com`，不带末尾斜杠或 API 路径 |
| `IRMIN_YGGDRASIL_SKIN_DOMAINS` | 允许的皮肤域名，多个域名使用英文逗号分隔，不带协议或路径                     |
| `IRMIN_WEBAUTHN_RP_ID`         | Passkey 所用域名，例如 `auth.example.com`                                    |
| `IRMIN_WEBAUTHN_ORIGIN`        | 浏览器访问站点的完整来源，例如 `https://auth.example.com`                    |
| `IRMIN_HTTP_PORT`              | 宿主机监听端口，默认 `3000`                                                  |
| `IRMIN_TRUST_PROXY`            | 是否信任代理传入的客户端 IP，默认 `false`；仅在入口限制为可信反向代理时开启  |

```bash
docker compose up -d --build
docker compose logs -f app
```

Compose 会启动应用、MongoDB 和 Redis，等待数据库健康检查通过后再启动应用。数据库连接地址由 Compose 设置为内部服务名，覆盖 `.env` 中的 `IRMIN_DB_URL` 和 `IRMIN_REDIS_URL`；MongoDB 和 Redis 不发布宿主机端口。

应用默认监听宿主机 `127.0.0.1:3000`。在宿主机配置 Nginx、Caddy 等反向代理，将上述域名的 HTTPS 请求转发至该地址。生产环境登录 Cookie 带有 `Secure` 属性，请通过 HTTPS 域名访问、注册和登录。若反向代理也在容器中，应让它加入同一 Docker 网络并转发到 `app:3000`。

空数据库中首个注册的用户会成为管理员，部署后请先完成管理员注册，再开放站点。SMTP、注册策略等设置可在管理界面配置。

### 数据持久化与更新

Compose 使用三个命名卷：

- `irminsul-data`：应用的密钥、皮肤、披风、插件和日志，挂载到 `/app/irminsul-data`。
- `mongo-data`：MongoDB 数据。
- `redis-data`：Redis 数据，已开启 AOF 持久化。

命名卷不会自动导入宿主机已有的 `irminsul-data/`。迁移已有实例时，需要将该目录的完整内容恢复至应用卷，并确保容器内的 `bun` 用户可读写；数据库和 `.env` 配置也需要一并迁移。

更新代码后执行 `docker compose up -d --build`。修改 `.env` 后执行 `docker compose up -d` 以重新创建应用容器。可使用 `docker compose down` 停止服务；不要在需要保留数据时使用 `docker compose down -v`，该命令会删除命名卷。备份应包含 `.env`、应用数据以及 MongoDB、Redis 的一致性备份。

### 手动部署

准备 Bun（Docker 镜像使用 `1.4.1`）、MongoDB 和 Redis，复制 `.env.example` 为 `.env`，填写实际连接地址和域名。也可使用 `cli/` 中的交互式初始化或 GHAuth 迁移向导：

```bash
bun install --cwd cli
bun cli/src/init.ts
```

向导会在当前目录生成 `.env`，已有配置请先备份。从项目根目录构建并启动：

```bash
bun install --frozen-lockfile
bun run build
bun --env-file=.env .output/server/index.mjs
```

请使用服务管理器保持进程运行，并配置 HTTPS 反向代理。运行时保持项目根目录为工作目录，持久化并备份其中的 `irminsul-data/`。不要使用 Node.js 启动产物，服务依赖 Bun 的 Redis 等运行时 API。

## 生成签名验证密钥

Irminsul 会在首次启动时创建RSA密钥对，用于 Yggdrasil 接口签名。

对于 Java MC > 1.19.1 版本，Irminsul 会在玩家首次请求 certificates 接口时，生成 RSA 签名密钥对，储存在 Redis 中，用于验证玩家聊天信息。

> [!WARNING]
> 注意，GHAuth 迁移脚本不会迁移密钥对。在迁移完成后，游戏中的玩家必须重新登录才能正常使用各项功能。

## 安全警告

Yggdrasil 验证时明文传递密码（协议限制），你需要启用 https 以提升安全性

## 协议

MIT Licence

## 命名的由来

伊尔明苏尔(Irminsul)一词取自游戏《原神》中的世界树，在北欧神话中 Irminsul 与 Yggdrasil 都指代支撑天地的世界之树。
