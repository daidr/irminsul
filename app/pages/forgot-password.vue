<script setup lang="ts">
import type AltchaField from "~/components/AltchaField.vue";

useHead({ title: "忘记密码" });

const email = ref("");
const altchaPayload = ref("");
const errorMsg = ref("");
const successMsg = ref("");
const isLoading = ref(false);
const altchaRef = ref<InstanceType<typeof AltchaField> | null>(null);

async function handleSubmit() {
  errorMsg.value = "";
  successMsg.value = "";

  if (!email.value.trim()) {
    errorMsg.value = "请输入邮箱";
    return;
  }
  if (!altchaPayload.value) {
    errorMsg.value = "请完成人机验证";
    return;
  }

  isLoading.value = true;
  try {
    const result = await $fetch("/api/auth/forgot-password", {
      method: "POST",
      body: {
        email: email.value.trim(),
        altchaPayload: altchaPayload.value,
      },
    });
    if (result.success) {
      successMsg.value =
        result.message || "如果该邮箱已注册，我们已发送密码重置链接，请检查收件箱。";
    } else {
      errorMsg.value = result.error || "操作失败";
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
    <form class="w-full max-w-105 flex flex-col gap-7" @submit.prevent="handleSubmit">
      <h1 class="text-4xl text-base-content text-center">忘记密码</h1>

      <!-- Error message -->
      <div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
        <span>{{ errorMsg }}</span>
      </div>

      <!-- Success message -->
      <div v-if="successMsg" role="alert" class="alert alert-success alert-soft">
        <span>{{ successMsg }}</span>
      </div>

      <template v-if="!successMsg">
        <!-- Email -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-sm font-semibold">邮箱</legend>
          <input
            v-model="email"
            type="email"
            class="input input-bordered w-full"
            placeholder="你的邮箱"
            autocomplete="email"
            required
          />
          <p class="fieldset-label text-xs leading-relaxed">
            我们会向你的邮箱发送一封带有密码重置链接的邮件。
          </p>
        </fieldset>

        <!-- Altcha Captcha -->
        <ClientOnly>
          <AltchaField ref="altchaRef" v-model="altchaPayload" />
        </ClientOnly>

        <!-- Submit Button -->
        <button type="submit" class="btn btn-primary w-full text-base" :disabled="isLoading">
          <span v-if="isLoading" class="loading loading-spinner loading-sm" />
          发送邮件
        </button>
      </template>

      <!-- Back to login -->
      <NuxtLink to="/login" class="text-primary text-sm text-center"> 返回登录 </NuxtLink>
    </form>
  </div>
</template>
