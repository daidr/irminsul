<script setup lang="ts">
import {
  startAuthentication,
  browserSupportsWebAuthn,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type AltchaField from "~/components/AltchaField.vue";

useHead({ title: "登录" });

const email = ref("");
const password = ref("");
const altchaPayload = ref("");
const errorMsg = ref("");
const isLoading = ref(false);
const altchaRef = ref<InstanceType<typeof AltchaField> | null>(null);

async function handleSubmit() {
  errorMsg.value = "";

  if (!email.value.trim()) {
    errorMsg.value = "请输入邮箱";
    return;
  }
  if (!password.value) {
    errorMsg.value = "请输入密码";
    return;
  }
  if (!altchaPayload.value) {
    errorMsg.value = "请完成人机验证";
    return;
  }

  isLoading.value = true;
  try {
    const result = await $fetch("/api/auth/login", {
      method: "POST",
      body: {
        email: email.value.trim(),
        password: password.value,
        altchaPayload: altchaPayload.value,
      },
    });
    if (result.success) {
      await refreshNuxtData("current-user");
      await navigateTo("/");
    } else {
      errorMsg.value = result.error || "登录失败";
      altchaRef.value?.reset();
    }
  } catch {
    errorMsg.value = "网络错误，请稍后重试";
  } finally {
    isLoading.value = false;
  }
}

const passkeyLoading = ref(false);
let conditionalChallengeId: string | null = null;

async function handlePasskeyResult(
  credential: Awaited<ReturnType<typeof startAuthentication>>,
  challengeId: string,
) {
  passkeyLoading.value = true;
  errorMsg.value = "";
  try {
    const result = await $fetch("/api/passkey/auth-verify", {
      method: "POST",
      body: { credential, challengeId },
    });
    if (result.success) {
      await refreshNuxtData("current-user");
      await navigateTo("/");
    } else {
      errorMsg.value = result.error || "通行密钥验证失败";
    }
  } catch {
    errorMsg.value = "网络错误，请稍后重试";
  } finally {
    passkeyLoading.value = false;
  }
}

async function initConditionalUI() {
  try {
    if (
      !window.PublicKeyCredential ||
      !PublicKeyCredential.isConditionalMediationAvailable ||
      !(await PublicKeyCredential.isConditionalMediationAvailable())
    ) {
      return;
    }

    const startResult = await $fetch("/api/passkey/auth-options", { method: "POST" });
    if (!startResult.success || !startResult.options || !startResult.challengeId) return;

    conditionalChallengeId = startResult.challengeId;

    const credential = await startAuthentication({
      optionsJSON: startResult.options,
      useBrowserAutofill: true,
      verifyBrowserAutofillInput: false,
    });

    await handlePasskeyResult(credential, conditionalChallengeId);
  } catch (e: any) {
    // Silently ignore AbortError and NotAllowedError
    if (e.name === "AbortError" || e.name === "NotAllowedError") return;
  }
}

async function handlePasskeyLogin() {
  passkeyLoading.value = true;
  errorMsg.value = "";
  try {
    const startResult = await $fetch("/api/passkey/auth-options", { method: "POST" });
    if (!startResult.success || !startResult.options || !startResult.challengeId) {
      errorMsg.value = startResult.error || "获取验证选项失败";
      return;
    }

    const credential = await startAuthentication({
      optionsJSON: startResult.options,
    });

    await handlePasskeyResult(credential, startResult.challengeId);
  } catch (e: any) {
    if (e.name === "NotAllowedError") return;
    errorMsg.value = "通行密钥验证失败";
  } finally {
    passkeyLoading.value = false;
  }
}

onMounted(() => {
  if (browserSupportsWebAuthn()) {
    initConditionalUI();
  }
});

onBeforeUnmount(() => {
  WebAuthnAbortService.cancelCeremony();
  conditionalChallengeId = null;
});
</script>

<template>
  <div class="flex justify-center items-center px-4 min-h-dvh -mt-18 pt-22 pb-8 bg-base-100">
    <form class="w-full max-w-105 flex flex-col gap-7" @submit.prevent="handleSubmit">
      <h1 class="text-4xl text-base-content text-center">登录</h1>

      <!-- Error message -->
      <div v-if="errorMsg" role="alert" class="alert alert-error alert-soft">
        <span>{{ errorMsg }}</span>
      </div>

      <!-- Email -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">邮箱</legend>
        <input
          v-model="email"
          type="email"
          class="input input-bordered w-full"
          placeholder="你的邮箱"
          autocomplete="email webauthn"
          required
        />
      </fieldset>

      <!-- Password -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">密码</legend>
        <input
          v-model="password"
          type="password"
          class="input input-bordered w-full"
          placeholder="你的密码"
          autocomplete="current-password"
          required
        />
      </fieldset>

      <!-- Altcha Captcha -->
      <ClientOnly>
        <AltchaField ref="altchaRef" v-model="altchaPayload" />
      </ClientOnly>

      <!-- Login Button -->
      <button type="submit" class="btn btn-primary w-full text-base" :disabled="isLoading">
        <span v-if="isLoading" class="loading loading-spinner loading-sm" />
        登录
      </button>

      <!-- Divider -->
      <div class="flex items-center gap-3">
        <div class="flex-1 border-t border-base-300" />
        <span class="text-xs opacity-40">或</span>
        <div class="flex-1 border-t border-base-300" />
      </div>

      <!-- Passkey Login Button -->
      <button
        type="button"
        class="btn btn-outline w-full"
        :disabled="passkeyLoading"
        @click="handlePasskeyLogin"
      >
        <span v-if="passkeyLoading" class="loading loading-spinner loading-sm" />
        <template v-else>
          <Icon name="hugeicons:key-01" class="text-base" />
          使用通行密钥登录
        </template>
      </button>

      <!-- Forgot Password -->
      <NuxtLink to="/forgot-password" class="text-primary text-sm text-center">
        忘记密码？
      </NuxtLink>
    </form>
  </div>
</template>
