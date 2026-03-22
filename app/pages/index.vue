<script setup lang="ts">
const { data: user } = useUser();
const { data: pageData } = await useAsyncData("index-data", () =>
  $fetch("/api/page-data/index"),
);
</script>

<template>
  <HomePage v-if="user" :page-data="pageData" />
  <LandingPage v-else />
</template>
