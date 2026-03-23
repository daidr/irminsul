<script setup lang="ts">
import type AltchaField from '~/components/AltchaField.vue';

useHead({ title: "注册" });

const email = ref("");
const gameId = ref("");
const password = ref("");
const confirmPassword = ref("");
const altchaPayload = ref("");
const errorMsg = ref("");
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

  if (!altchaPayload.value) {
    errorMsg.value = "请完成人机验证";
    return;
  }

  isLoading.value = true;
  try {
    const result = await $fetch("/api/auth/register", {
      method: "POST",
      body: {
        email: email.value.trim(),
        gameId: gameId.value.trim(),
        password: password.value,
        confirmPassword: confirmPassword.value,
        altchaPayload: altchaPayload.value,
      },
    });
    if (result.success) {
      await navigateTo("/login");
    } else {
      errorMsg.value = result.error || "注册失败";
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
      <h1 class="text-4xl text-base-content text-center">注册</h1>

      <!-- Error message -->
      <div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
        <span>{{ errorMsg }}</span>
      </div>

      <!-- Email -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">邮箱</legend>
        <input v-model="email" type="email" class="input input-bordered w-full validator" placeholder="你的邮箱"
          autocomplete="email" required />
        <p class="fieldset-label text-xs leading-relaxed">
          放心，我们不会将你的邮箱泄露给任何人。<br />
          不合法的邮箱可能会导致无法加入游戏。
        </p>
      </fieldset>

      <!-- Game ID -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">游戏昵称</legend>
        <input v-model="gameId" type="text" class="input input-bordered w-full validator" placeholder="游戏昵称"
          autocomplete="username" pattern="[a-zA-Z0-9_]{4,12}" title="仅支持字母、数字、下划线，长度4-12个字符" minlength="4"
          maxlength="12" required />
        <p class="fieldset-label text-xs leading-relaxed">
          这将会是你游戏内的玩家名称。<br />
          支持字母、数字、下划线。<br />
          合理的游戏ID应为4-12个字符。
        </p>
      </fieldset>

      <!-- Password -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">密码</legend>
        <input v-model="password" type="password" class="input input-bordered w-full validator" placeholder="密码"
          autocomplete="new-password" minlength="8" maxlength="128" required />
      </fieldset>

      <!-- Confirm Password -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">重复密码</legend>
        <input ref="confirmPasswordRef" v-model="confirmPassword" type="password"
          class="input input-bordered w-full validator" placeholder="确认你的密码正确无误" autocomplete="confirm-password"
          required />
      </fieldset>

      <!-- Altcha Captcha -->
      <ClientOnly>
        <AltchaField ref="altchaRef" v-model="altchaPayload" />
      </ClientOnly>

      <!-- Register Button -->
      <button type="submit" class="btn btn-primary w-full text-base" :disabled="isLoading">
        <span v-if="isLoading" class="loading loading-spinner loading-sm" />
        注册
      </button>

      <!-- Link to login -->
      <NuxtLink to="/login" class="text-primary text-sm text-center"> 已有账号？去登录 </NuxtLink>
    </form>
  </div>
</template>
