<script setup lang="ts">
const { data: user } = useUser();

// Prerendered page — after client-side user refresh, redirect logged-in users
if (import.meta.client) {
  watch(user, (u) => {
    if (u?.userId) navigateTo("/home", { replace: true });
  });
}
</script>

<template>
  <LandingPage />
</template>
