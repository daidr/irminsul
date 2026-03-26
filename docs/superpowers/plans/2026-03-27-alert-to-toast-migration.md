# Alert 迁移至 Toast 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 12 处内联 DaisyUI error alert 替换为 `useToast().error()` 调用

**Architecture:** 纯机械替换，每个文件的改动模式一致：删除 error ref、删除 alert 模板、删除清理行、将赋值改为 toast 调用。无新文件创建，无架构变更。

**Tech Stack:** Vue 3 + Nuxt 4, useToast composable (已实现)

**设计文档:** `docs/superpowers/specs/2026-03-27-alert-to-toast-migration-design.md`

---

### Task 1: 认证页面迁移（5 个文件）

**Files:**
- Modify: `app/pages/login.vue`
- Modify: `app/pages/register.vue`
- Modify: `app/pages/forgot-password.vue`
- Modify: `app/pages/reset-password.vue`
- Modify: `app/pages/verify-email.vue`

- [ ] **Step 1: 修改 `app/pages/login.vue`**

在 `<script setup>` 中添加 toast，删除 errorMsg ref，替换所有赋值，删除 alert 模板：

```diff
 <script setup lang="ts">
+const toast = useToast();
 // ... 其他代码 ...
-const errorMsg = ref("");                           // 删除 line 14
```

删除 3 处清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 19
-  errorMsg.value = "";                              // 删除 line 66
-  errorMsg.value = "";                              // 删除 line 115
```

替换 9 处赋值：
```diff
-  errorMsg.value = "请输入邮箱";                     // line 22
+  toast.error("请输入邮箱");

-  errorMsg.value = "请输入密码";                     // line 26
+  toast.error("请输入密码");

-  errorMsg.value = "请完成人机验证";                  // line 30
+  toast.error("请完成人机验证");

-  errorMsg.value = result.error || "登录失败";       // line 48
+  toast.error(result.error || "登录失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 52
+  toast.error("网络错误，请稍后重试");

-  errorMsg.value = result.error || "通行密钥验证失败"; // line 76
+  toast.error(result.error || "通行密钥验证失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 79
+  toast.error("网络错误，请稍后重试");

-  errorMsg.value = startResult.error || "获取验证选项失败"; // line 119
+  toast.error(startResult.error || "获取验证选项失败");

-  errorMsg.value = "通行密钥验证失败";               // line 130
+  toast.error("通行密钥验证失败");
```

注意：赋值行中 `return;` 语句保留不动，仅替换赋值行本身。

删除模板中的 alert 块（lines 154-156）：
```diff
-<div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
-  <span>{{ errorMsg }}</span>
-</div>
```

- [ ] **Step 2: 修改 `app/pages/register.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const errorMsg = ref("");                           // 删除 line 11
```

删除清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 27
```

替换 3 处赋值：
```diff
-  errorMsg.value = "请完成人机验证";                  // line 30
+  toast.error("请完成人机验证");

-  errorMsg.value = result.error || "注册失败";       // line 49
+  toast.error(result.error || "注册失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 53
+  toast.error("网络错误，请稍后重试");
```

删除模板 alert 块（lines 66-68）：
```diff
-<div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
-  <span>{{ errorMsg }}</span>
-</div>
```

- [ ] **Step 3: 修改 `app/pages/forgot-password.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const errorMsg = ref("");                           // 删除 line 8
```

删除清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 14
```

替换 4 处赋值：
```diff
-  errorMsg.value = "请输入邮箱";                     // line 18
+  toast.error("请输入邮箱");

-  errorMsg.value = "请完成人机验证";                  // line 22
+  toast.error("请完成人机验证");

-  errorMsg.value = result.error || "操作失败";       // line 39
+  toast.error(result.error || "操作失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 43
+  toast.error("网络错误，请稍后重试");
```

删除模板 alert 块（lines 56-58）：
```diff
-<div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
-  <span>{{ errorMsg }}</span>
-</div>
```

注意：`successMsg` ref 及其 alert 模板保留不动。

- [ ] **Step 4: 修改 `app/pages/reset-password.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const errorMsg = ref("");                           // 删除 line 14
```

删除清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 31
```

替换 3 处赋值：
```diff
-  errorMsg.value = "请完成人机验证";                  // line 35
+  toast.error("请完成人机验证");

-  errorMsg.value = result.error || "重置失败";       // line 54
+  toast.error(result.error || "重置失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 58
+  toast.error("网络错误，请稍后重试");
```

删除模板 alert 块（lines 75-77）：
```diff
-<div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
-  <span>{{ errorMsg }}</span>
-</div>
```

注意：`successMsg` alert、静态 invalid-token alert 均保留不动。

- [ ] **Step 5: 修改 `app/pages/verify-email.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const errorMsg = ref("");                           // 删除 line 9
```

删除清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 15
```

替换 2 处赋值：
```diff
-  errorMsg.value = result.error || "验证失败";       // line 28
+  toast.error(result.error || "验证失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 31
+  toast.error("网络错误，请稍后重试");
```

删除模板 alert 块（lines 49-51）：
```diff
-<div v-if="errorMsg" role="alert" class="alert alert-error alert-soft w-full">
-  <span>{{ errorMsg }}</span>
-</div>
```

注意：`successMsg` alert、静态 invalid-token alert 均保留不动。

简化模板中引用了 `errorMsg` 的条件（line 58）：
```diff
-      <template v-if="!successMsg && !errorMsg">
+      <template v-if="!successMsg">
```

- [ ] **Step 6: 验证并提交**

Run: `bun run lint`
Expected: 无新增 lint 错误

```bash
git add app/pages/login.vue app/pages/register.vue app/pages/forgot-password.vue app/pages/reset-password.vue app/pages/verify-email.vue
git commit -m "refactor: 认证页面 error alert 迁移至 toast"
```

---

### Task 2: Modal 组件迁移（2 个文件）

**Files:**
- Modify: `app/components/ChangePasswordModal.vue`
- Modify: `app/components/PasskeyModal.vue`

- [ ] **Step 1: 修改 `app/components/ChangePasswordModal.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const errorMsg = ref("");                           // 删除 line 10
```

删除 2 处清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 36 (resetForm 内)
-  errorMsg.value = "";                              // 删除 line 48 (handleSubmit 内)
```

替换 3 处赋值：
```diff
-  errorMsg.value = "请完成人机验证";                  // line 51
+  toast.error("请完成人机验证");

-  errorMsg.value = result.error || "修改失败";       // line 72
+  toast.error(result.error || "修改失败");

-  errorMsg.value = "网络错误，请稍后重试";            // line 76
+  toast.error("网络错误，请稍后重试");
```

删除模板 alert 块（lines 104-106）：
```diff
-<div v-if="errorMsg" role="alert" class="alert alert-error alert-soft mt-6">
-  <span>{{ errorMsg }}</span>
-</div>
```

注意：`successMsg` ref 及其 alert 模板保留不动。

- [ ] **Step 2: 修改 `app/components/PasskeyModal.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const errorMsg = ref("");                           // 删除 line 18
```

删除 5 处清理行：
```diff
-  errorMsg.value = "";                              // 删除 line 32 (loadPasskeys 内)
-  errorMsg.value = "";                              // 删除 line 43 (handleAdd 内)
-  errorMsg.value = "";                              // 删除 line 90 (confirmRename 内)
-  errorMsg.value = "";                              // 删除 line 113 (handleDelete 内)
-  errorMsg.value = "";                              // 删除 line 131 (open 内)
```

替换 5 处赋值：
```diff
-  errorMsg.value = startResult.error || "获取注册选项失败"; // line 52
+  toast.error(startResult.error || "获取注册选项失败");

-  errorMsg.value = "浏览器验证失败";                  // line 61
+  toast.error("浏览器验证失败");

-  errorMsg.value = finishResult.error || "注册失败";  // line 73
+  toast.error(finishResult.error || "注册失败");

-  errorMsg.value = result.error || "重命名失败";      // line 97
+  toast.error(result.error || "重命名失败");

-  errorMsg.value = result.error || "删除失败";        // line 120
+  toast.error(result.error || "删除失败");
```

删除模板 alert 块（lines 160-162）：
```diff
-<div v-if="errorMsg" class="mt-3 alert alert-error alert-soft text-sm">
-  <span>{{ errorMsg }}</span>
-</div>
```

- [ ] **Step 3: 验证并提交**

Run: `bun run lint`
Expected: 无新增 lint 错误

```bash
git add app/components/ChangePasswordModal.vue app/components/PasskeyModal.vue
git commit -m "refactor: Modal 组件 error alert 迁移至 toast"
```

---

### Task 3: AdminSiteConfigTab 迁移

**Files:**
- Modify: `app/components/AdminSiteConfigTab.vue`

- [ ] **Step 1: 修改 `app/components/AdminSiteConfigTab.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const smtpError = ref("");                          // 删除 line 28
-const authError = ref("");                          // 删除 line 30
-const announcementError = ref("");                  // 删除 line 32
```

注意：`loadError` ref（line 25）保留不动（页面状态型，不在范围内）。

删除 3 处清理行：
```diff
-  smtpError.value = "";                             // 删除 line 88
-  authError.value = "";                             // 删除 line 118
-  announcementError.value = "";                     // 删除 line 141
```

替换 6 处赋值：
```diff
-  smtpError.value = result.error;                   // line 106
+  toast.error(result.error);

-  smtpError.value = "保存失败";                      // line 111
+  toast.error("保存失败");

-  authError.value = result.error;                   // line 129
+  toast.error(result.error);

-  authError.value = "保存失败";                      // line 134
+  toast.error("保存失败");

-  announcementError.value = result.error;           // line 152
+  toast.error(result.error);

-  announcementError.value = "保存失败";              // line 157
+  toast.error("保存失败");
```

删除模板中 3 个 alert 块（loadError 的 alert 保留）：

smtpError alert（lines 240-242）：
```diff
-<div v-if="smtpError" role="alert" class="alert alert-error alert-soft mt-3">
-  <span>{{ smtpError }}</span>
-</div>
```

authError alert（lines 273-275）：
```diff
-<div v-if="authError" role="alert" class="alert alert-error alert-soft mt-3">
-  <span>{{ authError }}</span>
-</div>
```

announcementError alert（lines 306-308）：
```diff
-<div v-if="announcementError" role="alert" class="alert alert-error alert-soft mt-3">
-  <span>{{ announcementError }}</span>
-</div>
```

- [ ] **Step 2: 验证并提交**

Run: `bun run lint`
Expected: 无新增 lint 错误

```bash
git add app/components/AdminSiteConfigTab.vue
git commit -m "refactor: AdminSiteConfigTab error alert 迁移至 toast"
```

---

### Task 4: 插件管理组件迁移（2 个文件）

**Files:**
- Modify: `app/components/admin/PluginConfigTab.vue`
- Modify: `app/components/admin/PluginSystemSettingsModal.vue`

- [ ] **Step 1: 修改 `app/components/admin/PluginConfigTab.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
```

注意：`errors` ref 保留（字段级错误仍需要）。`errors.value = {}` 清理行（lines 35, 91）保留。

替换 `_general` 赋值（line 110）——原代码覆盖整个 errors 对象，需拆为两步以保持字段级错误清空行为：
```diff
-  errors.value = { _general: err?.data?.message ?? "保存失败" };
+  errors.value = {};
+  toast.error(err?.data?.message ?? "保存失败");
```

删除模板中 `_general` alert 块（lines 214-216）：
```diff
-<div v-if="errors._general" role="alert" class="alert alert-error alert-soft mt-2">
-  <span>{{ errors._general }}</span>
-</div>
```

字段级错误的 `<p>` 标签（lines 156, 172, 189, 206）保留不动。

- [ ] **Step 2: 修改 `app/components/admin/PluginSystemSettingsModal.vue`**

```diff
 <script setup lang="ts">
+const toast = useToast();
-const error = ref("");                              // 删除 line 7
```

删除清理行：
```diff
-  error.value = "";                                 // 删除 line 24
```

替换赋值：
```diff
-  error.value = err?.data?.message ?? "保存失败";    // line 36
+  toast.error(err?.data?.message ?? "保存失败");
```

删除模板 alert 块（lines 82-84）：
```diff
-<div v-if="error" role="alert" class="alert alert-error alert-soft">
-  <span>{{ error }}</span>
-</div>
```

- [ ] **Step 3: 验证并提交**

Run: `bun run lint`
Expected: 无新增 lint 错误

```bash
git add app/components/admin/PluginConfigTab.vue app/components/admin/PluginSystemSettingsModal.vue
git commit -m "refactor: 插件管理组件 error alert 迁移至 toast"
```
