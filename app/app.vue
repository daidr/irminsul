<script setup lang="ts">
const { data: user } = await useFetch("/api/auth/me", { key: "current-user" });
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
</template>
