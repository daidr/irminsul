<script setup lang="ts">
useHead({
  htmlAttrs: { lang: "zh-CN" },
  titleTemplate: (title) => (title ? `${title} · Irminsul` : "Irminsul"),
});

useSeoMeta({
  description: '轻量的第三方 Minecraft 服务器 yggdrasil 验证系统',
  ogTitle: 'Irminsul',
  ogDescription: '轻量的第三方 Minecraft 服务器 yggdrasil 验证系统',
  ogImage: '/banner.png',
  ogUrl: '/',
  twitterTitle: 'Irminsul',
  twitterDescription: '轻量的第三方 Minecraft 服务器 yggdrasil 验证系统',
  twitterImage: '/banner.png',
  twitterCard: 'summary_large_image',
  twitterSite: '@imdaidr',
})

useHead({
  link: [
    {
      rel: 'icon',
      type: 'image/x-icon',
      href: '/favicon.ico'
    }
  ]
})

const { data: user, refresh: refreshUser } = await useFetch("/api/auth/me", { key: "current-user" });

// Prerendered pages carry stale payload — refresh user data on client
if (import.meta.client && useNuxtApp().payload.prerenderedAt) {
  refreshUser();
}
const profileStore = useProfileStore();

watch(
  user,
  (newUser) => {
    if (newUser) profileStore.initFromUser(newUser);
    else profileStore.reset();
  },
  { immediate: true },
);
</script>

<template>
  <WappalyzerCheat />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ClientOnly>
    <ToastContainer />
  </ClientOnly>
</template>
