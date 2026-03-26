<script setup lang="ts">
const { data: user } = useUser();
const { data: pageData } = await useAsyncData("index-data", () => $fetch("/api/page-data"));
</script>

<template>
  <LazyHomePage v-if="user?.userId" :page-data="pageData" />
  <LazyLandingPage v-else />
</template>
