# Irminsul

[![MIT License](https://img.shields.io/badge/license-MIT-yellowgreen.svg?style=flat-square)](https://github.com/daidr/irminsul/blob/master/LICENSE)

轻量的 MC 服务器 yggdrasil 验证/皮肤加载解决方案

> [!WARNING]
> 在设计上，Irminsul 将取代原先的 GHAuth 项目，在[./cli](./cli)目录下提供了一键迁移脚本，用于将原先的 GHAuth 数据迁移到 Irminsul 中。
>
> 但由于目前 Irminsul 正在早期开发中，为避免数据损坏或丢失，请在迁移前完整备份 GHAuth 的数据表，并做好随时回滚的准备。

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

WIP

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
