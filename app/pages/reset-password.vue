<script setup lang="ts">
import type AltchaField from "~/components/AltchaField.vue";

useHead({ title: "重置密码" });

const route = useRoute();
const { data: tokenData } = await useAsyncData("reset-token", () =>
  $fetch("/api/page-data/reset-password", { query: { token: route.query.token } }),
);

const password = ref("");
const confirmPassword = ref("");
const altchaPayload = ref("");
const errorMsg = ref("");
const successMsg = ref("");
const isLoading = ref(false);
const altchaRef = ref<InstanceType<typeof AltchaField> | null>(null);
const confirmPasswordRef = useTemplateRef<HTMLInputElement>("confirmPasswordRef");

watch([password, confirmPassword], () => {
  const el = confirmPasswordRef.value;
  if (!el) return;
  if (confirmPassword.value && password.value !== confirmPassword.value) {
    el.setCustomValidity("两次输入的密码不一致");
  } else {
    el.setCustomValidity("");
  }
});

async function handleSubmit() {
  errorMsg.value = "";
  successMsg.value = "";

  if (!altchaPayload.value) {
    errorMsg.value = "请完成人机验证";
    return;
  }

  isLoading.value = true;
  try {
    const result = await $fetch("/api/auth/reset-password", {
      method: "POST",
      body: {
        token: tokenData.value?.token,
        password: password.value,
        confirmPassword: confirmPassword.value,
        altchaPayload: altchaPayload.value,
      },
    });
    if (result.success) {
      successMsg.value = "密码重置成功，正在跳转...";
      await navigateTo("/login");
    } else {
      errorMsg.value = result.error || "重置失败";
      altchaRef.value?.reset();
    }
  } catch {
    errorMsg.value = "网络错误，请稍后重试";
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="flex justify-center items-center px-4 min-h-dvh -mt-18 pt-22 pb-8 bg-base-100">
    <form
      v-if="tokenData?.tokenValid"
      class="w-full max-w-105 flex flex-col gap-7"
      @submit.prevent="handleSubmit"
    >
      <h1 class="text-4xl text-base-content text-center">重置密码</h1>

      <!-- Error message -->
      <div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
        <span>{{ errorMsg }}</span>
      </div>

      <!-- Success message -->
      <div v-if="successMsg" role="alert" class="alert alert-success alert-soft">
        <span>{{ successMsg }}</span>
      </div>

      <template v-if="!successMsg">
        <!-- New Password -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-sm font-semibold">新密码</legend>
          <input
            v-model="password"
            type="password"
            class="input input-bordered w-full validator"
            placeholder="新密码"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
          />
          <p class="fieldset-label text-xs leading-relaxed">密码长度至少 8 个字符。</p>
        </fieldset>

        <!-- Confirm Password -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-sm font-semibold">确认密码</legend>
          <input
            ref="confirmPasswordRef"
            v-model="confirmPassword"
            type="password"
            class="input input-bordered w-full validator"
            placeholder="确认你的新密码"
            autocomplete="confirm-password"
            required
          />
        </fieldset>

        <!-- Altcha Captcha -->
        <ClientOnly>
          <AltchaField ref="altchaRef" v-model="altchaPayload" />
        </ClientOnly>

        <!-- Submit Button -->
        <button type="submit" class="btn btn-primary w-full text-base" :disabled="isLoading">
          <span v-if="isLoading" class="loading loading-spinner loading-sm" />
          重置密码
        </button>
      </template>

      <!-- Back to login -->
      <NuxtLink to="/login" class="text-primary text-sm text-center"> 返回登录 </NuxtLink>
    </form>

    <!-- Invalid token -->
    <div v-else class="w-full max-w-105 flex flex-col gap-7 items-center">
      <h1 class="text-4xl text-base-content text-center">重置密码</h1>
      <div role="alert" class="alert alert-error alert-soft w-full">
        <span>重置链接无效或已过期，请重新发送密码重置邮件。</span>
      </div>
      <NuxtLink to="/forgot-password" class="text-primary text-sm text-center">
        重新发送重置邮件
      </NuxtLink>
      <NuxtLink to="/login" class="text-primary text-sm text-center"> 返回登录 </NuxtLink>
    </div>
  </div>
</template>
