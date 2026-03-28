<script setup lang="ts">
const { data: user } = useUser();

const { data: pageData } = user.value?.userId
  ? await useAsyncData("index-data", () => $fetch("/api/page-data"))
  : { data: ref(null) as Ref<{ announcement: string; yggdrasilApiUrl: string } | null> };
</script>

<template>
  <LazyHomePage v-if="user?.userId" :page-data="pageData" />
  <LazyLandingPage v-else />
</template>
