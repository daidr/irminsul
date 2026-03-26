<script setup lang="ts">
const { data: user } = useUser();

if (!user.value?.userId) {
  await navigateTo("/", { replace: true });
}

const { data: pageData } = await useAsyncData("index-data", () => $fetch("/api/page-data"));
</script>

<template>
  <HomePage :page-data="pageData" />
</template>
