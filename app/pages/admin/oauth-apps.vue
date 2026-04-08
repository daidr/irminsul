<script setup lang="ts">
definePageMeta({ hideFooter: true });

useHead({ title: "OAuth 应用审批" });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

// Admin guard
watch(
  () => user.value,
  (u) => {
    if (!u || !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

interface OAuthAppItem {
  clientId: string;
  name: string;
  description: string;
  type: string;
  icon: string | null;
  ownerId: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

const apps = ref<OAuthAppItem[]>([]);
const loading = ref(true);
const filter = ref<"" | "pending" | "approved">("");

const filteredApps = computed(() => {
  if (filter.value === "pending") return apps.value.filter((a) => !a.approved);
  if (filter.value === "approved") return apps.value.filter((a) => a.approved);
  return apps.value;
});

async function fetchApps() {
  loading.value = true;
  try {
    const query: Record<string, string> = {};
    if (filter.value === "pending") query.approved = "false";
    else if (filter.value === "approved") query.approved = "true";

    apps.value = await $fetch<OAuthAppItem[]>("/api/oauth-provider/admin/apps", { query });
  } catch {
    toast.error("加载应用列表失败");
  } finally {
    loading.value = false;
  }
}

onMounted(fetchApps);

function onFilterChange(value: string) {
  filter.value = value as typeof filter.value;
  fetchApps();
}

async function approveApp(clientId: string) {
  try {
    await $fetch(`/api/oauth-provider/admin/apps/${clientId}/approve`, { method: "POST" });
    toast.success("已审批通过");
    await fetchApps();
  } catch {
    toast.error("审批失败");
  }
}

async function revokeApproval(clientId: string) {
  try {
    await $fetch(`/api/oauth-provider/admin/apps/${clientId}/revoke-approval`, { method: "POST" });
    toast.success("已撤销审批");
    await fetchApps();
  } catch {
    toast.error("撤销审批失败");
  }
}

// Delete
const deleteDialogRef = useTemplateRef<HTMLDialogElement>("deleteDialogRef");
const deleteTarget = ref<string>("");
const isDeleting = ref(false);

function openDeleteDialog(clientId: string) {
  deleteTarget.value = clientId;
  deleteDialogRef.value?.showModal();
}

async function handleDelete() {
  if (!deleteTarget.value) return;
  isDeleting.value = true;
  try {
    await $fetch(`/api/oauth-provider/admin/apps/${deleteTarget.value}`, { method: "DELETE" });
    toast.success("应用已删除");
    deleteDialogRef.value?.close();
    await fetchApps();
  } catch {
    toast.error("删除失败");
  } finally {
    isDeleting.value = false;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
</script>

<template>
  <div v-if="user?.isAdmin" class="flex flex-1 flex-col min-h-0 mx-0 md:mx-4">
    <div class="flex-1 border-x border-base-300 bg-base-200 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="p-4 border-b border-base-300 flex flex-col sm:flex-row gap-3 shrink-0">
        <h1 class="text-lg font-bold shrink-0">OAuth 应用审批</h1>
        <div class="flex flex-1 justify-end">
          <select
            class="select select-sm select-bordered w-auto"
            :value="filter"
            @change="onFilterChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部</option>
            <option value="pending">待审批</option>
            <option value="approved">已审批</option>
          </select>
        </div>
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        <!-- Loading -->
        <div v-if="loading" class="flex justify-center p-12">
          <span class="loading loading-spinner loading-md" />
        </div>

        <!-- Empty -->
        <div v-else-if="filteredApps.length === 0" class="flex justify-center p-12 text-base-content/40">
          暂无应用数据
        </div>

        <!-- App table -->
        <table v-else class="table table-sm w-full">
          <thead>
            <tr class="border-b border-base-300">
              <th class="font-semibold">应用名称</th>
              <th class="font-semibold hidden sm:table-cell">Client ID</th>
              <th class="font-semibold hidden md:table-cell">类型</th>
              <th class="font-semibold">状态</th>
              <th class="font-semibold hidden lg:table-cell">创建时间</th>
              <th class="font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="app in filteredApps"
              :key="app.clientId"
              class="border-b border-base-300/50 hover:bg-base-300/30"
            >
              <td>
                <div class="flex items-center gap-2">
                  <div v-if="app.icon" class="w-6 h-6 shrink-0 overflow-hidden border border-base-300">
                    <img :src="app.icon" :alt="app.name" class="w-full h-full object-cover" />
                  </div>
                  <span class="font-medium truncate">{{ app.name }}</span>
                </div>
              </td>
              <td class="text-base-content/60 text-xs font-mono hidden sm:table-cell">
                {{ app.clientId.slice(0, 12) }}...
              </td>
              <td class="hidden md:table-cell">
                <span class="badge badge-sm" :class="app.type === 'confidential' ? 'badge-info' : 'badge-ghost'">
                  {{ app.type === "confidential" ? "机密" : "公开" }}
                </span>
              </td>
              <td>
                <span v-if="app.approved" class="badge badge-success badge-sm">已审批</span>
                <span v-else class="badge badge-warning badge-sm">待审批</span>
              </td>
              <td class="text-base-content/50 text-sm hidden lg:table-cell">
                {{ formatDate(app.createdAt) }}
              </td>
              <td class="text-right">
                <div class="dropdown dropdown-end">
                  <div tabindex="0" role="button" class="btn btn-ghost btn-xs">
                    <Icon name="hugeicons:more-vertical" class="text-base" />
                  </div>
                  <ul tabindex="0" class="dropdown-content z-10 menu menu-sm shadow-lg bg-base-100 border border-base-300 w-36">
                    <li v-if="!app.approved">
                      <a @click="approveApp(app.clientId)">审批通过</a>
                    </li>
                    <li v-if="app.approved">
                      <a @click="revokeApproval(app.clientId)">撤销审批</a>
                    </li>
                    <li>
                      <a class="text-error" @click="openDeleteDialog(app.clientId)">删除</a>
                    </li>
                  </ul>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Delete Confirm Modal -->
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="deleteDialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>
          <h3 class="text-lg font-bold">确认删除</h3>
          <p class="py-4 text-sm">确定要删除这个应用吗？所有关联的授权和令牌将被清除，此操作不可逆。</p>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn btn-ghost">取消</button>
            </form>
            <button class="btn btn-error" :disabled="isDeleting" @click="handleDelete">
              <span v-if="isDeleting" class="loading loading-spinner loading-sm" />
              确认删除
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
