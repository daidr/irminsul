<script setup lang="ts">
useHead({
  htmlAttrs: { lang: "zh-CN" },
  titleTemplate: (title) => (title ? `${title} · Irminsul` : "Irminsul"),
});

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
