<script setup lang="ts">
const { data: user } = useUser();
const { data: pageData } = await useAsyncData("index-data", () =>
  $fetch("/api/page-data"),
);
</script>

<template>
  <HomePage v-if="user?.userId" :page-data="pageData" />
  <LandingPage v-else />
</template>
