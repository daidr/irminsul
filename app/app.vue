<script setup lang="ts">
const { data: user } = await useFetch('/api/auth/me', { key: 'current-user' })
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
