<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { ShieldKeyIcon } from "@hugeicons/core-free-icons";

useHead({ title: "已授权应用" });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

// Auth guard
watch(
  () => user.value,
  (u) => {
    if (!u) router.replace("/login");
  },
  { immediate: true },
);

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "profile:read": "读取基础档案",
  "profile:write": "修改材质",
  "email:read": "读取邮箱",
  "account:base": "读取基础账户信息",
  "account:ban": "读取封禁信息",
};

interface AuthorizationItem {
  clientId: string;
  appName: string | null;
  appDescription: string | null;
  appIcon: { name: string; hue: number } | null;
  scopes: string[];
  grantedAt: string;
  updatedAt: string;
}

const authorizations = ref<AuthorizationItem[]>([]);
const loading = ref(true);

async function fetchAuthorizations() {
  loading.value = true;
  try {
    authorizations.value = await $fetch<AuthorizationItem[]>("/api/oauth-provider/authorizations");
  } catch {
    toast.error("加载授权列表失败");
  } finally {
    loading.value = false;
  }
}

onMounted(fetchAuthorizations);

// Revoke
const revokeDialogRef = useTemplateRef<HTMLDialogElement>("revokeDialogRef");
const revokeTarget = ref<AuthorizationItem | null>(null);
const isRevoking = ref(false);

function openRevokeDialog(auth: AuthorizationItem) {
  revokeTarget.value = auth;
  revokeDialogRef.value?.showModal();
}

async function handleRevoke() {
  if (!revokeTarget.value) return;
  isRevoking.value = true;
  try {
    await $fetch(`/api/oauth-provider/authorizations/${revokeTarget.value.clientId}`, {
      method: "DELETE",
    });
    toast.success("已撤销授权");
    revokeDialogRef.value?.close();
    await fetchAuthorizations();
  } catch {
    toast.error("撤销授权失败");
  } finally {
    isRevoking.value = false;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
</script>

<template>
  <div class="flex justify-center px-4 py-8 bg-base-100 min-h-dvh -mt-18 pt-22">
    <div class="w-full max-w-140 flex flex-col gap-6">
      <h1 class="text-2xl font-bold">已授权应用</h1>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center p-12">
        <span class="loading loading-spinner loading-md" />
      </div>

      <!-- Empty -->
      <div v-else-if="authorizations.length === 0" class="flex flex-col items-center justify-center p-12 gap-3 text-base-content/40">
        <HugeiconsIcon :icon="ShieldKeyIcon" :size="36" />
        <p>还没有授权过任何应用</p>
      </div>

      <!-- List -->
      <div v-else class="flex flex-col gap-3">
        <div
          v-for="auth in authorizations"
          :key="auth.clientId"
          class="border border-base-300 bg-base-200 p-4 flex items-start gap-4"
        >
          <div class="w-10 h-10 shrink-0">
            <OAuthAppIcon :name="auth.appIcon?.name" :hue="auth.appIcon?.hue" :size="16" />
          </div>

          <div class="flex-1 min-w-0">
            <p class="font-medium">{{ auth.appName ?? "未知应用" }}</p>
            <p v-if="auth.appDescription" class="text-sm text-base-content/60 truncate mt-0.5">{{ auth.appDescription }}</p>
            <div class="flex flex-wrap gap-1 mt-2">
              <span
                v-for="s in auth.scopes"
                :key="s"
                class="badge badge-ghost badge-sm"
              >
                {{ SCOPE_DESCRIPTIONS[s] ?? s }}
              </span>
            </div>
            <p class="text-xs text-base-content/40 mt-2">授权于 {{ formatDate(auth.grantedAt) }}</p>
          </div>

          <button
            class="btn btn-outline btn-error btn-sm shrink-0"
            @click="openRevokeDialog(auth)"
          >
            撤销
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Revoke Confirm Modal -->
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="revokeDialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>
          <h3 class="text-lg font-bold">撤销授权</h3>
          <p class="py-4 text-sm">
            确定要撤销
            <strong>{{ revokeTarget?.appName ?? "该应用" }}</strong>
            的授权吗？该应用将无法继续访问你的数据。
          </p>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn btn-ghost">取消</button>
            </form>
            <button class="btn btn-error" :disabled="isRevoking" @click="handleRevoke">
              <span v-if="isRevoking" class="loading loading-spinner loading-sm" />
              确认撤销
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>
</template>
