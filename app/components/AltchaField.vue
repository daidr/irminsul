<script setup lang="ts">
import "@/assets/css/altcha.css";
const payload = defineModel<string>({ default: "" });

const inited = ref(false);

const AltchaRef = useTemplateRef("AltchaRef");

onMounted(async () => {
  await import("altcha/external");
  const { default: Pbkdf2Worker } = await import("altcha/workers/pbkdf2?worker");
  const i18n = {
    ariaLinkLabel: "访问 Altcha.org",
    enterCode: "输入代码",
    enterCodeAria: "输入您听到的代码。按空格键播放音频。",
    error: "验证失败。稍后再试。",
    expired: "验证已过期。请重试。",
    footer:
      '由 <a href="https://altcha.org/" target="_blank" aria-label="访问 Altcha.org">ALTCHA</a> 保护',
    getAudioChallenge: "获取音频挑战",
    label: "我不是机器人",
    loading: "加载中...",
    reload: "重新加载",
    verify: "验证",
    verificationRequired: "需要验证！",
    verified: "已验证",
    verifying: "正在验证...",
    waitAlert: "正在验证... 请稍等。",
    cancel: "取消",
    enterCodeFromImage: "为继续操作，请输入下图中显示的验证码。",
  };
  if ("$altcha" in globalThis) {
    (globalThis as any).$altcha.i18n.set("zh-cn", i18n);
    (globalThis as any).$altcha.algorithms.set("PBKDF2/SHA-256", () => new Pbkdf2Worker());
  }

  AltchaRef.value?.configure({
    fetch: customFetch,
    hideLogo: true,
    hideFooter: true,
  });
  inited.value = true;
});

function handleStateChange(event: CustomEvent) {
  if (event.detail.state === "verified") {
    payload.value = event.detail.payload;
  } else {
    payload.value = "";
  }
}

async function reset() {
  payload.value = "";
  AltchaRef.value?.reset?.();
}

async function customFetch() {
  const data = await $fetch("/api/auth/altcha-challenge");
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

defineExpose({ reset });
</script>

<template>
  <div
    class="w-full h-10"
    :class="{
      skeleton: !inited,
    }"
  >
    <altcha-widget
      v-show="inited"
      ref="AltchaRef"
      type="native"
      challenge="/fetch-challenge"
      language="zh-cn"
      @statechange="handleStateChange"
    />
  </div>
</template>

<style scoped>
altcha-widget {
  --altcha-max-width: 100%;
}
</style>
