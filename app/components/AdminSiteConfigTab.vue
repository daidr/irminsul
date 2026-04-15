<script setup lang="ts">
const toast = useToast();

// ---- 表单数据 ----
const smtp = reactive({
  host: "",
  port: 465,
  secure: true,
  user: "",
  pass: "",
  from: "",
});

const auth = reactive({
  requireEmailVerification: false,
});

const oauth = reactive({
  enabled: false,
});

const announcement = ref("");

// ---- 原始快照（用于脏检查） ----
const smtpSnapshot = ref({ ...smtp });
const authSnapshot = ref({ ...auth });
const oauthSnapshot = ref({ ...oauth });
const announcementSnapshot = ref("");

// ---- 状态 ----
const loading = ref(true);
const loadError = ref("");

const smtpSaving = ref(false);
const authSaving = ref(false);
const oauthSaving = ref(false);
const announcementSaving = ref(false);

// ---- 脏检查 ----
const smtpDirty = computed(
  () =>
    smtp.host !== smtpSnapshot.value.host ||
    smtp.port !== smtpSnapshot.value.port ||
    smtp.secure !== smtpSnapshot.value.secure ||
    smtp.user !== smtpSnapshot.value.user ||
    smtp.pass !== smtpSnapshot.value.pass ||
    smtp.from !== smtpSnapshot.value.from,
);

const authDirty = computed(
  () => auth.requireEmailVerification !== authSnapshot.value.requireEmailVerification,
);

const oauthDirty = computed(() => oauth.enabled !== oauthSnapshot.value.enabled);

const announcementDirty = computed(() => announcement.value !== announcementSnapshot.value);

const anyDirty = computed(
  () => smtpDirty.value || authDirty.value || oauthDirty.value || announcementDirty.value,
);

defineExpose({ anyDirty });

// ---- 加载 ----
onMounted(async () => {
  try {
    const result = await $fetch<{ success: boolean; settings: Record<string, any>; error: string }>(
      "/api/admin/settings",
    );
    if (!result.success) {
      loadError.value = result.error;
      return;
    }
    const s = result.settings;
    smtp.host = (s["smtp.host"] as string) ?? "";
    smtp.port = (s["smtp.port"] as number) ?? 465;
    smtp.secure = (s["smtp.secure"] as boolean) ?? true;
    smtp.user = (s["smtp.user"] as string) ?? "";
    smtp.pass = (s["smtp.pass"] as string) ?? "";
    smtp.from = (s["smtp.from"] as string) ?? "";
    auth.requireEmailVerification = (s["auth.requireEmailVerification"] as boolean) ?? false;
    oauth.enabled = (s["oauth.enabled"] as boolean) ?? false;
    announcement.value = (s["general.announcement"] as string) ?? "";

    // 更新快照
    smtpSnapshot.value = { ...smtp };
    authSnapshot.value = { ...auth };
    oauthSnapshot.value = { ...oauth };
    announcementSnapshot.value = announcement.value;
  } catch {
    loadError.value = "加载配置失败";
  } finally {
    loading.value = false;
  }
});

// ---- 保存 ----
async function saveSmtp() {
  smtpSaving.value = true;
  try {
    const result = await $fetch<{ success: boolean; error: string }>("/api/admin/settings", {
      method: "POST",
      body: {
        category: "smtp",
        values: {
          "smtp.host": smtp.host,
          "smtp.port": smtp.port,
          "smtp.secure": smtp.secure,
          "smtp.user": smtp.user,
          "smtp.pass": smtp.pass,
          "smtp.from": smtp.from,
        },
      },
    });
    if (!result.success) {
      toast.error(result.error);
    } else {
      smtpSnapshot.value = { ...smtp };
    }
  } catch {
    toast.error("保存失败");
  } finally {
    smtpSaving.value = false;
  }
}

async function saveAuth() {
  authSaving.value = true;
  try {
    const result = await $fetch<{ success: boolean; error: string }>("/api/admin/settings", {
      method: "POST",
      body: {
        category: "auth",
        values: { "auth.requireEmailVerification": auth.requireEmailVerification },
      },
    });
    if (!result.success) {
      toast.error(result.error);
    } else {
      authSnapshot.value = { ...auth };
    }
  } catch {
    toast.error("保存失败");
  } finally {
    authSaving.value = false;
  }
}

async function saveOAuth() {
  oauthSaving.value = true;
  try {
    const result = await $fetch<{ success: boolean; error: string }>("/api/admin/settings", {
      method: "POST",
      body: {
        category: "oauth",
        values: { "oauth.enabled": oauth.enabled },
      },
    });
    if (!result.success) {
      toast.error(result.error);
    } else {
      oauthSnapshot.value = { ...oauth };
    }
  } catch {
    toast.error("保存失败");
  } finally {
    oauthSaving.value = false;
  }
}

async function saveAnnouncement() {
  announcementSaving.value = true;
  try {
    const result = await $fetch<{ success: boolean; error: string }>("/api/admin/settings", {
      method: "POST",
      body: {
        category: "general",
        values: { "general.announcement": announcement.value },
      },
    });
    if (!result.success) {
      toast.error(result.error);
    } else {
      announcementSnapshot.value = announcement.value;
    }
  } catch {
    toast.error("保存失败");
  } finally {
    announcementSaving.value = false;
  }
}
</script>

<template>
  <!-- 加载中 -->
  <div v-if="loading" class="flex items-center justify-center py-16">
    <span class="loading loading-spinner loading-md" />
  </div>

  <!-- 加载失败 -->
  <div v-else-if="loadError" class="py-6">
    <div role="alert" class="alert alert-error alert-soft">
      <span>{{ loadError }}</span>
    </div>
  </div>

  <!-- 配置表单 -->
  <div v-else class="flex flex-col gap-0">
    <!-- SMTP 设置 -->
    <div class="py-5">
      <h4 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
        <span v-if="smtpDirty" class="inline-block h-2 w-2 rounded-full bg-warning" />
        SMTP 设置
      </h4>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">SMTP 主机</legend>
          <input
            v-model="smtp.host"
            type="text"
            class="input input-bordered w-full"
            placeholder="smtp.example.com"
          />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">端口</legend>
          <input
            v-model.number="smtp.port"
            type="number"
            class="input input-bordered w-full"
            placeholder="465"
            min="1"
            max="65535"
          />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">用户名</legend>
          <input
            v-model="smtp.user"
            type="text"
            class="input input-bordered w-full"
            placeholder="user@example.com"
          />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">密码</legend>
          <input
            v-model="smtp.pass"
            type="password"
            class="input input-bordered w-full"
            placeholder="••••••"
          />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">发件人地址</legend>
          <input
            v-model="smtp.from"
            type="text"
            class="input input-bordered w-full"
            placeholder="Irminsul <noreply@example.com>"
          />
        </fieldset>
        <div class="flex items-end pb-2">
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input v-model="smtp.secure" type="checkbox" class="checkbox checkbox-sm" />
            使用 TLS
          </label>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <button
          class="btn btn-primary btn-sm"
          :disabled="!smtpDirty || smtpSaving"
          @click="saveSmtp"
        >
          <span v-if="smtpSaving" class="loading loading-spinner loading-xs" />
          保存
        </button>
      </div>
    </div>

    <!-- 分割线 -->
    <div class="divider my-0" />

    <!-- 认证设置 -->
    <div class="py-5">
      <h4 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
        <span v-if="authDirty" class="inline-block h-2 w-2 rounded-full bg-warning" />
        认证设置
      </h4>
      <label class="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input
          v-model="auth.requireEmailVerification"
          type="checkbox"
          class="checkbox checkbox-sm"
        />
        要求邮箱验证
      </label>
      <p class="ml-6 mt-1 text-xs opacity-50">开启后，未通过邮箱验证的用户将无法登录游戏</p>
      <div class="mt-3 flex justify-end">
        <button
          class="btn btn-primary btn-sm"
          :disabled="!authDirty || authSaving"
          @click="saveAuth"
        >
          <span v-if="authSaving" class="loading loading-spinner loading-xs" />
          保存
        </button>
      </div>
    </div>

    <!-- 分割线 -->
    <div class="divider my-0" />

    <!-- OAuth 设置 -->
    <div class="py-5">
      <h4 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
        <span v-if="oauthDirty" class="inline-block h-2 w-2 rounded-full bg-warning" />
        OAuth 授权服务
      </h4>
      <label class="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input v-model="oauth.enabled" type="checkbox" class="checkbox checkbox-sm" />
        启用 OAuth 授权服务
      </label>
      <p class="ml-6 mt-1 text-xs opacity-50">
        开启后，经审批的第三方应用可通过 OAuth 协议获取玩家数据
      </p>
      <div class="mt-3 flex justify-end">
        <button
          class="btn btn-primary btn-sm"
          :disabled="!oauthDirty || oauthSaving"
          @click="saveOAuth"
        >
          <span v-if="oauthSaving" class="loading loading-spinner loading-xs" />
          保存
        </button>
      </div>
    </div>

    <!-- 分割线 -->
    <div class="divider my-0" />

    <!-- 公告设置 -->
    <div class="py-5">
      <h4 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
        <span v-if="announcementDirty" class="inline-block h-2 w-2 rounded-full bg-warning" />
        公告设置
      </h4>
      <fieldset class="fieldset mt-3">
        <legend class="fieldset-legend text-xs">公告内容</legend>
        <textarea
          v-model="announcement"
          class="textarea textarea-bordered w-full"
          placeholder="留空则仅显示标题"
          rows="3"
        />
      </fieldset>
      <div class="mt-3 flex justify-end">
        <button
          class="btn btn-primary btn-sm"
          :disabled="!announcementDirty || announcementSaving"
          @click="saveAnnouncement"
        >
          <span v-if="announcementSaving" class="loading loading-spinner loading-xs" />
          保存
        </button>
      </div>
    </div>
  </div>
</template>
