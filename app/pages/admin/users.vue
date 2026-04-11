<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { MoreVerticalIcon } from "@hugeicons/core-free-icons";

definePageMeta({ hideFooter: true });

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

interface UserItem {
  id: string;
  gameId: string;
  email: string;
  isAdmin: boolean;
  isDeveloper: boolean;
  hasBan: boolean;
  registerAt: number;
}

const users = ref<UserItem[]>([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const filter = ref<"" | "banned" | "admin">("");

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

// Debounced search
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function onSearchInput(value: string) {
  search.value = value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    fetchUsers();
  }, 300);
}

function onFilterChange(value: string) {
  filter.value = value as typeof filter.value;
  page.value = 1;
  fetchUsers();
}

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  fetchUsers();
}

async function fetchUsers() {
  loading.value = true;
  try {
    const query: Record<string, string | number> = {
      page: page.value,
      pageSize: pageSize.value,
    };
    if (search.value) query.search = search.value;
    if (filter.value) query.filter = filter.value;

    const res = await $fetch<{
      success: boolean;
      users: UserItem[];
      total: number;
      page: number;
      pageSize: number;
    }>("/api/admin/users", { query });

    if (res.success) {
      users.value = res.users;
      total.value = res.total;
    }
  } catch {
    toast.error("加载用户列表失败");
  } finally {
    loading.value = false;
  }
}

onMounted(fetchUsers);

// Ban modal
const banModalRef = useTemplateRef<{ open: (userId: string, gameId: string) => void }>("banModalRef");

function openBanModal(userId: string) {
  const u = users.value.find((item) => item.id === userId);
  banModalRef.value?.open(userId, u?.gameId ?? "");
}

async function toggleDeveloper(uuid: string, currentStatus: boolean) {
  try {
    if (currentStatus) {
      await $fetch(`/api/oauth-provider/admin/developers/${uuid}`, { method: "DELETE" });
      toast.success("已撤销开发者身份");
    } else {
      await $fetch(`/api/oauth-provider/admin/developers/${uuid}`, { method: "POST" });
      toast.success("已标记为开发者");
    }
    await fetchUsers();
  } catch {
    toast.error("操作失败");
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Pagination display: show at most 5 page numbers around current page
const visiblePages = computed(() => {
  const pages: number[] = [];
  const total = totalPages.value;
  const current = page.value;
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});
</script>

<template>
  <div v-if="user?.isAdmin" class="flex flex-1 flex-col min-h-0 mx-0 md:mx-4">
    <div class="flex-1 border-x border-base-300 bg-base-200 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="p-4 border-b border-base-300 flex flex-col sm:flex-row gap-3 shrink-0">
        <h1 class="text-lg font-bold shrink-0">用户管理</h1>
        <div class="flex flex-1 gap-2">
          <input type="text" class="input input-sm input-bordered flex-1 min-w-0" placeholder="搜索用户名或邮箱..."
            :value="search" @input="onSearchInput(($event.target as HTMLInputElement).value)">
          <select class="select select-sm select-bordered w-auto" :value="filter"
            @change="onFilterChange(($event.target as HTMLSelectElement).value)">
            <option value="">全部状态</option>
            <option value="banned">封禁中</option>
            <option value="admin">管理员</option>
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
        <div v-else-if="users.length === 0" class="flex justify-center p-12 text-base-content/40">
          暂无用户数据
        </div>

        <!-- User table -->
        <table v-else class="table table-sm w-full">
          <thead>
            <tr class="border-b border-base-300">
              <th class="font-semibold">用户名</th>
              <th class="font-semibold">邮箱</th>
              <th class="font-semibold hidden sm:table-cell">注册时间</th>
              <th class="font-semibold">状态</th>
              <th class="font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-b border-base-300/50 hover:bg-base-300/30">
              <td class="font-medium">
                <AdminUserBubble :user-id="u.id" />
              </td>
              <td class="text-base-content/60 text-sm">{{ u.email }}</td>
              <td class="text-base-content/50 text-sm hidden sm:table-cell">{{ formatTime(u.registerAt) }}</td>
              <td>
                <div class="flex flex-wrap gap-1">
                  <span v-if="u.hasBan" class="badge badge-error badge-sm">封禁中</span>
                  <span v-else-if="u.isAdmin" class="badge badge-info badge-sm">管理员</span>
                  <span v-else class="badge badge-ghost badge-sm">正常</span>
                  <span v-if="u.isDeveloper" class="badge badge-warning badge-sm">开发者</span>
                </div>
              </td>
              <td class="text-right">
                <div class="dropdown dropdown-end">
                  <div tabindex="0" role="button" class="btn btn-ghost btn-xs">
                    <HugeiconsIcon :icon="MoreVerticalIcon" :size="16" />
                  </div>
                  <ul tabindex="0"
                    class="dropdown-content z-10 menu menu-sm shadow-lg bg-base-100 border border-base-300 w-36">
                    <li><a @click="openBanModal(u.id)">封禁信息</a></li>
                    <li><a @click="toggleDeveloper(u.id, u.isDeveloper)">{{ u.isDeveloper ? '撤销开发者' : '标记为开发者' }}</a>
                    </li>
                  </ul>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="!loading && total > 0"
        class="p-3 border-t border-base-300 flex justify-between items-center text-sm shrink-0">
        <span class="text-base-content/50">共 {{ total }} 位用户</span>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-xs" :disabled="page <= 1" @click="goToPage(page - 1)">‹</button>
          <button v-for="p in visiblePages" :key="p" class="btn btn-xs"
            :class="p === page ? 'btn-primary' : 'btn-ghost'" @click="goToPage(p)">
            {{ p }}
          </button>
          <button class="btn btn-ghost btn-xs" :disabled="page >= totalPages" @click="goToPage(page + 1)">›</button>
        </div>
      </div>
    </div>

    <!-- Ban Modal -->
    <ClientOnly>
      <LazyAdminBanModal ref="banModalRef" @updated="fetchUsers" />
    </ClientOnly>
  </div>
</template>
