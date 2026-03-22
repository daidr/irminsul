<script setup lang="ts">
const { data: user } = useUser();

defineProps<{
  pageData: {
    announcement: string;
    yggdrasilApiUrl: string;
  } | null;
}>();

const changePasswordRef = ref<{ open: () => void } | null>(null);
const sessionManageRef = ref<{ open: () => void } | null>(null);
const banHistoryRef = ref<{ open: () => void } | null>(null);
const passkeyRef = ref<{ open: () => void } | null>(null);
const adminPanelRef = ref<{ open: () => void } | null>(null);

const verifyLoading = ref(false);
const verifyMsg = ref("");
const verifyError = ref("");

async function handleSendVerification() {
  verifyLoading.value = true;
  verifyMsg.value = "";
  verifyError.value = "";
  try {
    const result = await $fetch("/api/auth/send-verification-email", { method: "POST" });
    if (result.success) {
      verifyMsg.value = result.message || "验证邮件已发送";
    } else {
      verifyError.value = result.error || "发送失败";
    }
  } catch {
    verifyError.value = "网络错误，请稍后重试";
  } finally {
    verifyLoading.value = false;
  }
}
</script>

<template>
  <div class="px-5 md:px-20 py-8">
    <!-- 邮箱未验证提示 -->
    <div v-if="user?.needsEmailVerification" class="mb-6">
      <div role="alert" class="alert alert-warning alert-soft">
        <div class="flex flex-col gap-2 w-full">
          <span>你的邮箱尚未验证，验证后即可解锁全部功能（如上传材质、登录游戏）。</span>
          <div class="flex items-center gap-3">
            <span v-if="verifyMsg" class="text-success text-sm">{{ verifyMsg }}</span>
            <span v-if="verifyError" class="text-error text-sm">{{ verifyError }}</span>
            <button
              v-if="!verifyMsg"
              class="btn btn-sm btn-warning"
              :disabled="verifyLoading"
              @click="handleSendVerification"
            >
              <span v-if="verifyLoading" class="loading loading-spinner loading-xs" />
              发送验证邮件
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <!-- 左列 -->
      <div class="lg:col-span-4 flex flex-col gap-6">
        <AnnouncementCard :announcement="pageData?.announcement ?? ''" />
        <ShortcutCard :is-admin="user?.isAdmin" @change-password="changePasswordRef?.open()"
          @session-manage="sessionManageRef?.open()" @passkey-manage="passkeyRef?.open()"
          @ban-history="banHistoryRef?.open()" @admin-panel="adminPanelRef?.open()" />
      </div>
      <!-- 右列 -->
      <div class="lg:col-span-8 flex flex-col gap-6">
        <LauncherCard :api-url="pageData?.yggdrasilApiUrl ?? ''" />
        <SkinPreviewCard />
        <TextureUploadCard v-if="!user?.needsEmailVerification" />
      </div>
    </div>
  </div>

  <ClientOnly>
    <ChangePasswordModal ref="changePasswordRef" />
    <SessionManageModal ref="sessionManageRef" />
    <BanHistoryModal ref="banHistoryRef" />
    <PasskeyModal ref="passkeyRef" />
    <AdminPanelModal ref="adminPanelRef" />
  </ClientOnly>
</template>

<style scoped lang="scss"></style>
