<script setup lang="ts">
const { data: user } = useUser();

defineProps<{
  pageData: {
    announcement: string;
    yggdrasilApiUrl: string;
  } | null;
}>();

// ---- 共享 modal ----
type ModalType = "change-password" | "session-manage" | "ban-history" | "passkey" | "admin-panel";
// renderedModal 控制 v-if 渲染的内容，关闭时保留，避免动画期间闪白
// activeModal 跟踪逻辑上的开关状态
const activeModal = ref<ModalType | null>(null);
const renderedModal = ref<ModalType | null>(null);
const modalDialogRef = useTemplateRef<HTMLDialogElement>("modalDialogRef");
const adminPanelRef = ref<{ canClose: () => boolean } | null>(null);

const modalBoxClass = computed(() => {
  switch (renderedModal.value) {
    case "change-password":
      return "sm:max-w-[480px]";
    case "session-manage":
    case "passkey":
      return "sm:max-w-[560px]";
    case "ban-history":
      return "sm:max-w-[520px]";
    case "admin-panel":
      return "sm:max-w-[700px]";
    default:
      return "";
  }
});

function openModal(type: ModalType) {
  activeModal.value = type;
  renderedModal.value = type;
  nextTick(() => modalDialogRef.value?.showModal());
}

function closeModal() {
  modalDialogRef.value?.close();
}

function onDialogClose() {
  activeModal.value = null;
  // renderedModal 保留，下次 openModal 时才更新
}

function requestClose() {
  if (activeModal.value === "admin-panel" && adminPanelRef.value && !adminPanelRef.value.canClose()) {
    return;
  }
  closeModal();
}

function onDialogCancel(e: Event) {
  if (activeModal.value === "admin-panel" && adminPanelRef.value && !adminPanelRef.value.canClose()) {
    e.preventDefault();
    return;
  }
}

// OAuth 回调 toast 提示
const route = useRoute();
const toast = useToast();
const oauthMessages: Record<string, { type: "error" | "success"; text: string }> = {
  "bind-success": { type: "success", text: "第三方账号绑定成功" },
  "already-bound": { type: "error", text: "该第三方账号已绑定其他用户" },
  duplicate: { type: "error", text: "你已绑定该服务的账号" },
  denied: { type: "error", text: "你取消了第三方授权" },
  error: { type: "error", text: "操作失败，请重试" },
};

onMounted(() => {
  const oauthParam = route.query.oauth as string;
  if (oauthParam && oauthMessages[oauthParam]) {
    const msg = oauthMessages[oauthParam];
    if (msg.type === "error") toast.error(msg.text);
    else toast.success(msg.text);
    // 清理 URL 中的 oauth 参数
    const { oauth, ...rest } = route.query;
    navigateTo({ query: rest }, { replace: true });
  }
});

// ---- 邮箱验证 ----
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
        <ShortcutCard
          :is-admin="user?.isAdmin"
          @change-password="openModal('change-password')"
          @session-manage="openModal('session-manage')"
          @passkey-manage="openModal('passkey')"
          @ban-history="openModal('ban-history')"
          @admin-panel="openModal('admin-panel')"
        />
        <OAuthBindings />
      </div>
      <!-- 右列 -->
      <div class="lg:col-span-8 flex flex-col gap-6">
        <LauncherCard :api-url="pageData?.yggdrasilApiUrl ?? ''" />
        <SkinPreviewCard />
        <TextureUploadCard v-if="!user?.needsEmailVerification" />
      </div>
    </div>
  </div>

  <!-- 共享 modal 容器 -->
  <ClientOnly>
    <Teleport to="body">
      <dialog
        ref="modalDialogRef"
        class="modal modal-bottom sm:modal-middle"
        @close="onDialogClose"
        @cancel="onDialogCancel"
      >
        <div class="modal-box" :class="modalBoxClass">
          <LazyChangePasswordModal v-if="renderedModal === 'change-password'" />
          <LazySessionManageModal v-if="renderedModal === 'session-manage'" />
          <LazyBanHistoryModal v-if="renderedModal === 'ban-history'" />
          <LazyPasskeyModal v-if="renderedModal === 'passkey'" />
          <LazyAdminPanelModal
            v-if="renderedModal === 'admin-panel'"
            ref="adminPanelRef"
            @close="closeModal"
          />
        </div>
        <div class="modal-backdrop" @click="requestClose" />
      </dialog>
    </Teleport>
  </ClientOnly>
</template>

<style scoped lang="scss"></style>
