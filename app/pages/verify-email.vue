<script setup lang="ts">
useHead({ title: "验证邮箱" });

const route = useRoute();
const { data: tokenData } = await useAsyncData("verify-token", () =>
  $fetch("/api/page-data/verify-email", { query: { token: route.query.token } }),
);

const successMsg = ref("");
const isLoading = ref(false);
const toast = useToast();
let redirectTimer: ReturnType<typeof setTimeout> | undefined;

async function handleConfirm() {
  isLoading.value = true;
  try {
    const result = await $fetch("/api/auth/verify-email", {
      method: "POST",
      body: { token: tokenData.value?.token },
    });
    if (result.success) {
      successMsg.value = "你的邮箱已成功验证，正在跳转...";
      redirectTimer = setTimeout(() => {
        navigateTo("/home");
      }, 1500);
    } else {
      toast.error(result.error || "验证失败");
    }
  } catch {
    toast.error("网络错误，请稍后重试");
  } finally {
    isLoading.value = false;
  }
}

onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer);
});
</script>

<template>
  <div class="flex justify-center items-center px-4 min-h-dvh -mt-18 pt-22 pb-8 bg-base-100">
    <!-- Token valid: show confirm button -->
    <div v-if="tokenData?.tokenValid" class="w-full max-w-105 flex flex-col gap-7 items-center">
      <h1 class="text-4xl text-base-content text-center">邮箱验证</h1>

      <!-- Success message -->
      <div v-if="successMsg" role="alert" class="alert alert-success alert-soft w-full">
        <span>{{ successMsg }}</span>
      </div>

      <template v-if="!successMsg">
        <p class="text-base-content/70 text-center">点击下方按钮确认验证你的邮箱。</p>
        <button
          class="btn btn-primary w-full text-base"
          :disabled="isLoading"
          @click="handleConfirm"
        >
          <span v-if="isLoading" class="loading loading-spinner loading-sm" />
          确认验证
        </button>
      </template>

      <NuxtLink to="/" class="text-primary text-sm text-center">返回首页</NuxtLink>
    </div>

    <!-- Invalid token -->
    <div v-else class="w-full max-w-105 flex flex-col gap-7 items-center">
      <h1 class="text-4xl text-base-content text-center">邮箱验证</h1>
      <div role="alert" class="alert alert-error alert-soft w-full">
        <span>验证链接无效或已过期。</span>
      </div>
      <NuxtLink to="/" class="text-primary text-sm text-center">返回首页</NuxtLink>
    </div>
  </div>
</template>
