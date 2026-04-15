<script setup lang="ts">
import {
  startAuthentication,
  browserSupportsWebAuthn,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { HugeiconsIcon } from "@hugeicons/vue";
import { Key01Icon } from "@hugeicons/core-free-icons";
import type AltchaField from "~/components/AltchaField.vue";

useHead({ title: "登录" });

const email = ref("");
const password = ref("");
const altchaPayload = ref("");
const isLoading = ref(false);
const toast = useToast();
const altchaRef = ref<InstanceType<typeof AltchaField> | null>(null);

const route = useRoute();
const redirectTarget = computed(() => {
  const r = route.query.redirect as string | undefined;
  // 仅允许站内路径，防止 open redirect
  return r?.startsWith("/") ? r : "/";
});

// OAuth 回调 toast 提示
const oauthMessages: Record<string, { type: "error" | "success"; text: string }> = {
  "not-bound": { type: "error", text: "该第三方账号未绑定任何用户" },
  denied: { type: "error", text: "你取消了第三方授权" },
  error: { type: "error", text: "第三方登录失败，请重试" },
};

async function handleSubmit() {
  if (!email.value.trim()) {
    toast.error("请输入邮箱");
    return;
  }
  if (!password.value) {
    toast.error("请输入密码");
    return;
  }
  if (!altchaPayload.value) {
    toast.error("请完成人机验证");
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
      await navigateTo(redirectTarget.value, {
        external: redirectTarget.value.startsWith("/api/"),
      });
    } else {
      toast.error(result.error || "登录失败");
      altchaRef.value?.reset();
    }
  } catch {
    toast.error("网络错误，请稍后重试");
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
  try {
    const result = await $fetch("/api/passkey/auth-verify", {
      method: "POST",
      body: { credential, challengeId },
    });
    if (result.success) {
      await refreshNuxtData("current-user");
      await navigateTo(redirectTarget.value, {
        external: redirectTarget.value.startsWith("/api/"),
      });
    } else {
      toast.error(result.error || "通行密钥验证失败");
    }
  } catch {
    toast.error("网络错误，请稍后重试");
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
  try {
    const startResult = await $fetch("/api/passkey/auth-options", { method: "POST" });
    if (!startResult.success || !startResult.options || !startResult.challengeId) {
      toast.error(startResult.error || "获取验证选项失败");
      return;
    }

    const credential = await startAuthentication({
      optionsJSON: startResult.options,
    });

    await handlePasskeyResult(credential, startResult.challengeId);
  } catch (e: any) {
    if (e.name === "NotAllowedError") return;
    toast.error("通行密钥验证失败");
  } finally {
    passkeyLoading.value = false;
  }
}

onMounted(() => {
  if (browserSupportsWebAuthn()) {
    initConditionalUI();
  }

  const oauthParam = route.query.oauth as string;
  if (oauthParam && oauthMessages[oauthParam]) {
    const msg = oauthMessages[oauthParam];
    if (msg.type === "error") toast.error(msg.text);
    else toast.success(msg.text);
    // 清理 URL 中的 oauth 参数，避免刷新重复 toast
    const { oauth, ...rest } = route.query;
    navigateTo({ query: rest }, { replace: true });
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
          <HugeiconsIcon :icon="Key01Icon" :size="16" />
          使用通行密钥登录
        </template>
      </button>

      <!-- OAuth Providers -->
      <OAuthButtons />

      <!-- Forgot Password -->
      <NuxtLink to="/forgot-password" class="text-primary text-sm text-center">
        忘记密码？
      </NuxtLink>
    </form>
  </div>
</template>
