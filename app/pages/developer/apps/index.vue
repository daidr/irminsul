<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { PlusSignIcon, PuzzleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

definePageMeta({ hideFooter: true });

useHead({ title: "我的应用" });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

// Developer guard
watch(
  () => user.value,
  (u) => {
    if (!u || (!u.isDeveloper && !u.isAdmin)) router.replace("/");
  },
  { immediate: true },
);

interface AppItem {
  clientId: string;
  name: string;
  description: string;
  type: string;
  approved: boolean;
  createdAt: string;
}

const apps = ref<AppItem[]>([]);
const loading = ref(true);

async function fetchApps() {
  loading.value = true;
  try {
    apps.value = await $fetch<AppItem[]>("/api/oauth-provider/apps");
  } catch {
    toast.error("加载应用列表失败");
  } finally {
    loading.value = false;
  }
}

onMounted(fetchApps);
</script>

<template>
  <div v-if="user?.isDeveloper || user?.isAdmin" class="flex flex-1 flex-col min-h-0 mx-0 md:mx-4">
    <div class="flex-1 border-x border-base-300 bg-base-200 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="p-4 border-b border-base-300 flex items-center justify-between shrink-0">
        <h1 class="text-lg font-bold">我的应用</h1>
        <NuxtLink to="/developer/apps/new" class="btn btn-primary btn-sm">
          <HugeiconsIcon :icon="PlusSignIcon" :size="16" />
          创建应用
        </NuxtLink>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto">
        <!-- Loading -->
        <div v-if="loading" class="flex justify-center p-12">
          <span class="loading loading-spinner loading-md" />
        </div>

        <!-- Empty -->
        <div v-else-if="apps.length === 0" class="flex flex-col items-center justify-center p-12 gap-3 text-base-content/40">
          <HugeiconsIcon :icon="PuzzleIcon" :size="36" />
          <p>还没有创建任何应用</p>
          <NuxtLink to="/developer/apps/new" class="btn btn-primary btn-sm">创建第一个应用</NuxtLink>
        </div>

        <!-- App list -->
        <div v-else class="flex flex-col">
          <NuxtLink
            v-for="app in apps"
            :key="app.clientId"
            :to="`/developer/apps/${app.clientId}`"
            class="flex items-center gap-4 p-4 border-b border-base-300/50 hover:bg-base-300/30 transition-colors"
          >
            <div class="w-10 h-10 shrink-0 bg-base-300 border border-base-300 flex items-center justify-center">
              <HugeiconsIcon :icon="PuzzleIcon" :size="16" class="text-base-content/40" />
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium truncate">{{ app.name }}</span>
                <span class="badge badge-sm" :class="app.type === 'confidential' ? 'badge-info' : 'badge-ghost'">
                  {{ app.type === "confidential" ? "机密" : "公开" }}
                </span>
                <span v-if="app.approved" class="badge badge-success badge-sm">已审批</span>
                <span v-else class="badge badge-warning badge-sm">待审批</span>
              </div>
              <p v-if="app.description" class="text-sm text-base-content/60 truncate mt-0.5">{{ app.description }}</p>
            </div>

            <HugeiconsIcon :icon="ArrowRight01Icon" :size="16" class="text-base-content/40 shrink-0" />
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
