# Alert 迁移至 Toast 设计文档

## 概要

将代码库中 12 处内联 DaisyUI error alert 替换为 `useToast().error()` 调用。这 12 处均为纯操作反馈型 alert（API 调用失败、表单校验错误）。页面状态型 alert、成功后隐藏表单/跳转的 success alert、以及邮箱未验证 warning 不在本次改动范围内。

## 方案

直接替换（方案 A）：删除 error ref、删除 alert 模板、将赋值语句替换为 `toast.error()`。

## 范围

### 纳入范围（12 处 alert）

注：「赋值处数」仅计 error 赋值行（即需替换为 `toast.error()` 的行），不含 `= ""` 清理行。

| # | 文件 | 变量 | 赋值处数 |
|---|------|------|----------|
| 1 | `app/pages/login.vue` | `errorMsg` | 9 |
| 2 | `app/pages/register.vue` | `errorMsg` | 3 |
| 3 | `app/pages/forgot-password.vue` | `errorMsg` | 4 |
| 4 | `app/pages/reset-password.vue` | `errorMsg` | 3 |
| 5 | `app/pages/verify-email.vue` | `errorMsg` | 2 |
| 6 | `app/components/ChangePasswordModal.vue` | `errorMsg` | 3 |
| 7 | `app/components/PasskeyModal.vue` | `errorMsg` | 5 |
| 8 | `app/components/AdminSiteConfigTab.vue` | `smtpError` | 2 |
| 9 | `app/components/AdminSiteConfigTab.vue` | `authError` | 2 |
| 10 | `app/components/AdminSiteConfigTab.vue` | `announcementError` | 2 |
| 11 | `app/components/admin/PluginConfigTab.vue` | `errors._general` | 1 |
| 12 | `app/components/admin/PluginSystemSettingsModal.vue` | `error` | 1 |

### 排除范围（10 处 alert 保持不变）

- 4 处 success alert（forgot-password、reset-password、verify-email、ChangePasswordModal）— 成功后隐藏表单/触发跳转
- 2 处静态 invalid-token error（reset-password、verify-email）— 页面状态
- 2 处页面加载失败 error（AdminSiteConfigTab、PluginDetail）— 页面状态
- 1 处插件运行时错误（PluginDetail）— 持久状态展示
- 1 处邮箱未验证 warning（HomePage）— 持久警告，含操作按钮

### 注意：TextureUploadCard.vue 不在范围内

`TextureUploadCard.vue` 有 6 处操作反馈型 error 赋值（上传/删除/文件校验失败），但其错误展示使用 `<p class="text-error">` 而非 DaisyUI alert 组件。本次迁移目标仅限 DaisyUI alert，该文件可在后续单独处理。

## 每文件改动模式

对范围内的每个文件：

1. 在 `<script setup>` 中添加 `const toast = useToast()`（如该文件尚未调用）
2. 删除 error ref 声明（如 `const errorMsg = ref("")`）
3. 删除模板中对应的 alert `<div>` 块
4. 删除 handler 函数开头的 `errorMsg.value = ""` 清理行
5. 将 `errorMsg.value = "xxx"` 替换为 `toast.error("xxx")`

## 特殊情况

### AdminSiteConfigTab.vue — 3 个独立 error ref

`smtpError`、`authError`、`announcementError` 各自独立删除（ref 声明、alert 模板、清理行）。该文件无 success ref，迁移不涉及其他状态。

### PluginConfigTab.vue — errors 对象中的 _general 字段

`errors` ref（`Record<string, string>`）同时存储字段级校验错误和通用错误。仅删除 `_general` 的 alert 模板并将其赋值改为 `toast.error()`。`errors` ref 本身保留（字段级错误仍需要）。`errors.value = {}` 清理行保留。

注意：原代码 `errors.value = { _general: err?.data?.message ?? "保存失败" }` 会覆盖整个 `errors` 对象（同时清空字段级错误）。迁移后应改为：
```ts
errors.value = {};
toast.error(err?.data?.message ?? "保存失败");
```
以保持原有的字段级错误清空行为。

### ChangePasswordModal.vue — resetForm() 清理

`resetForm()` 同时清理 `errorMsg` 和 `successMsg`。删除 `errorMsg` 后，仅保留 `successMsg` 的清理。`successMsg` ref 及其 alert 模板保留（不在本次范围内）。

## Toast 配置

所有 error toast 使用默认 2000ms 时长。代码库中的错误消息均为简短中文字符串（20 字以内），2 秒足够阅读。用户可悬停暂停自动关闭计时器。
