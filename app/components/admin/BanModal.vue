<script setup lang="ts">
const emit = defineEmits<{ updated: [] }>();

const toast = useToast();
const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");

// State
const userId = ref("");
const gameId = ref("");
const bans = ref<BanItem[]>([]);
const loading = ref(false);
const actionLoading = ref<string | null>(null);

// New ban form
const newBanDuration = ref<"1d" | "7d" | "30d" | "permanent" | "custom">("7d");
const newBanCustomDate = ref("");
const newBanReason = ref("");
const creating = ref(false);

// Edit state
const editingBanId = ref<string | null>(null);
const editEnd = ref<string | null>(null);
const editEndCustom = ref("");
const editReason = ref("");
const editDuration = ref<"1d" | "7d" | "30d" | "permanent" | "custom">("custom");

// Remove confirm state
const confirmRemoveId = ref<string | null>(null);

interface BanItem {
  id: string;
  start: number;
  end?: number;
  reason?: string;
  operatorId: string;
  revokedAt?: number;
  revokedBy?: string;
}

function open(uid: string, gid: string) {
  userId.value = uid;
  gameId.value = gid;
  resetForm();
  dialogRef.value?.showModal();
  loadBans();
}

function resetForm() {
  newBanDuration.value = "7d";
  newBanCustomDate.value = "";
  newBanReason.value = "";
  editingBanId.value = null;
  confirmRemoveId.value = null;
}

defineExpose({ open });

// Helpers
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function banStatus(ban: BanItem): "active" | "revoked" | "expired" {
  if (ban.revokedAt) return "revoked";
  const now = Date.now();
  if (ban.start <= now && (!ban.end || ban.end > now)) return "active";
  return "expired";
}

function computeEndDate(duration: string): string | undefined {
  if (duration === "permanent") return undefined;
  const now = new Date();
  const ms = { "1d": 86400000, "7d": 604800000, "30d": 2592000000 }[duration];
  if (ms) return new Date(now.getTime() + ms).toISOString();
  return undefined;
}

// Load bans
async function loadBans() {
  loading.value = true;
  try {
    const res = await $fetch<{ success: boolean; bans: BanItem[] }>(
      `/api/admin/users/${userId.value}/bans`,
    );
    if (res.success) bans.value = res.bans;
  } catch {
    toast.error("加载封禁记录失败");
  } finally {
    loading.value = false;
  }
}

// Create ban
async function createBan() {
  creating.value = true;
  try {
    let end: string | undefined;
    if (newBanDuration.value === "custom") {
      if (!newBanCustomDate.value) {
        toast.error("请选择截止时间");
        return;
      }
      end = new Date(newBanCustomDate.value).toISOString();
    } else {
      end = computeEndDate(newBanDuration.value);
    }

    const res = await $fetch<{ success: boolean; error?: string }>(`/api/admin/users/${userId.value}/bans`, {
      method: "POST",
      body: { end, reason: newBanReason.value || undefined },
    });

    if (res.success) {
      toast.success("封禁成功");
      newBanReason.value = "";
      newBanDuration.value = "7d";
      newBanCustomDate.value = "";
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "封禁失败");
    }
  } catch {
    toast.error("封禁失败");
  } finally {
    creating.value = false;
  }
}

// Revoke ban
async function handleRevoke(banId: string) {
  actionLoading.value = banId;
  try {
    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/admin/users/${userId.value}/bans/${banId}/revoke`,
      { method: "POST" },
    );
    if (res.success) {
      toast.success("已撤销");
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "撤销失败");
    }
  } catch {
    toast.error("撤销失败");
  } finally {
    actionLoading.value = null;
  }
}

// Start editing
function startEdit(ban: BanItem) {
  editingBanId.value = ban.id;
  editReason.value = ban.reason ?? "";
  if (ban.end) {
    editDuration.value = "custom";
    // Format for datetime-local input
    const d = new Date(ban.end);
    editEndCustom.value = d.toISOString().slice(0, 16);
  } else {
    editDuration.value = "permanent";
    editEndCustom.value = "";
  }
}

function cancelEdit() {
  editingBanId.value = null;
}

// Save edit
async function saveEdit(banId: string) {
  actionLoading.value = banId;
  try {
    let end: string | null | undefined;
    if (editDuration.value === "permanent") {
      end = null;
    } else if (editDuration.value === "custom" && editEndCustom.value) {
      end = new Date(editEndCustom.value).toISOString();
    }

    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/admin/users/${userId.value}/bans/${banId}`,
      {
        method: "PATCH",
        body: { end, reason: editReason.value || undefined },
      },
    );

    if (res.success) {
      toast.success("已更新");
      editingBanId.value = null;
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "更新失败");
    }
  } catch {
    toast.error("更新失败");
  } finally {
    actionLoading.value = null;
  }
}

// Remove ban
async function handleRemove(banId: string) {
  if (confirmRemoveId.value !== banId) {
    confirmRemoveId.value = banId;
    return;
  }
  actionLoading.value = banId;
  try {
    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/admin/users/${userId.value}/bans/${banId}`,
      { method: "DELETE" },
    );
    if (res.success) {
      toast.success("已移除");
      confirmRemoveId.value = null;
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "移除失败");
    }
  } catch {
    toast.error("移除失败");
  } finally {
    actionLoading.value = null;
  }
}
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box max-w-xl">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>

          <h3 class="text-lg font-bold">封禁管理 — {{ gameId }}</h3>

          <!-- New Ban Form -->
          <div class="mt-4 border border-base-300 p-4">
            <h4 class="text-sm font-semibold mb-3">新建封禁</h4>
            <div class="mb-3">
              <label class="text-xs text-base-content/50 block mb-1">封禁时长</label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="opt in [
                    { value: '1d', label: '1 天' },
                    { value: '7d', label: '7 天' },
                    { value: '30d', label: '30 天' },
                    { value: 'permanent', label: '永久' },
                    { value: 'custom', label: '自定义' },
                  ]"
                  :key="opt.value"
                  class="btn btn-xs"
                  :class="newBanDuration === opt.value ? 'btn-active' : 'btn-ghost'"
                  @click="newBanDuration = opt.value as typeof newBanDuration"
                >
                  {{ opt.label }}
                </button>
              </div>
              <input
                v-if="newBanDuration === 'custom'"
                v-model="newBanCustomDate"
                type="datetime-local"
                class="input input-sm input-bordered w-full mt-2"
              >
            </div>
            <div class="mb-3">
              <label class="text-xs text-base-content/50 block mb-1">封禁理由（可选）</label>
              <input
                v-model="newBanReason"
                type="text"
                class="input input-sm input-bordered w-full"
                placeholder="输入封禁理由..."
                maxlength="500"
              >
            </div>
            <div class="text-right">
              <button class="btn btn-sm btn-error" :disabled="creating" @click="createBan">
                <span v-if="creating" class="loading loading-spinner loading-xs" />
                确认封禁
              </button>
            </div>
          </div>

          <!-- Ban History -->
          <div class="mt-4">
            <h4 class="text-sm font-semibold mb-3">封禁历史</h4>

            <div v-if="loading" class="flex justify-center py-6">
              <span class="loading loading-spinner loading-sm" />
            </div>

            <div v-else-if="bans.length === 0" class="py-6 text-center text-sm text-base-content/40">
              暂无封禁记录
            </div>

            <div v-else class="flex flex-col gap-2 max-h-[40dvh] overflow-auto">
              <div
                v-for="ban in bans"
                :key="ban.id"
                class="border p-3"
                :class="banStatus(ban) === 'active' ? 'border-error/50 bg-error/5' : 'border-base-300 opacity-70'"
              >
                <!-- Display mode -->
                <template v-if="editingBanId !== ban.id">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <!-- Status badges -->
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span
                          v-if="banStatus(ban) === 'active'"
                          class="bg-error text-error-content px-2 py-0.5 text-[10px] font-semibold"
                        >
                          生效中
                        </span>
                        <span
                          v-else-if="banStatus(ban) === 'revoked'"
                          class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold"
                        >
                          已撤销
                        </span>
                        <span
                          v-else
                          class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold"
                        >
                          已过期
                        </span>
                        <span
                          v-if="!ban.end && banStatus(ban) !== 'revoked'"
                          class="bg-warning/20 text-warning px-2 py-0.5 text-[10px]"
                        >
                          永久
                        </span>
                      </div>

                      <!-- Time info -->
                      <div class="mt-1.5 text-xs text-base-content/50">
                        <div v-if="ban.revokedAt">
                          {{ formatTime(ban.start) }} → 撤销于 {{ formatTime(ban.revokedAt) }}
                        </div>
                        <div v-else-if="ban.end">
                          {{ formatTime(ban.start) }} ~ {{ formatTime(ban.end) }}
                        </div>
                        <div v-else>
                          {{ formatTime(ban.start) }} 起，永久
                        </div>
                      </div>

                      <!-- Reason -->
                      <div v-if="ban.reason" class="mt-1 text-xs">
                        <span class="text-base-content/40">理由：</span>{{ ban.reason }}
                      </div>

                      <!-- Operator -->
                      <div class="mt-1 text-[11px] text-base-content/30 flex items-center gap-1 flex-wrap">
                        <span>操作者：</span>
                        <AdminUserBubble v-if="ban.operatorId" :user-id="ban.operatorId" />
                        <span v-else>未知</span>
                        <template v-if="ban.revokedBy">
                          <span> · 撤销者：</span>
                          <AdminUserBubble :user-id="ban.revokedBy" />
                        </template>
                      </div>
                    </div>

                    <!-- Action buttons -->
                    <div class="flex gap-1 shrink-0">
                      <button
                        v-if="banStatus(ban) === 'active'"
                        class="btn btn-ghost btn-xs"
                        :disabled="actionLoading === ban.id"
                        @click="handleRevoke(ban.id)"
                      >
                        撤销
                      </button>
                      <button
                        class="btn btn-ghost btn-xs"
                        :disabled="actionLoading === ban.id"
                        @click="startEdit(ban)"
                      >
                        编辑
                      </button>
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        :disabled="actionLoading === ban.id"
                        @click="handleRemove(ban.id)"
                      >
                        {{ confirmRemoveId === ban.id ? '确认？' : '移除' }}
                      </button>
                    </div>
                  </div>
                </template>

                <!-- Edit mode -->
                <template v-else>
                  <div class="flex flex-col gap-2">
                    <div>
                      <label class="text-xs text-base-content/50 block mb-1">截止时间</label>
                      <div class="flex flex-wrap gap-1.5">
                        <button
                          class="btn btn-xs"
                          :class="editDuration === 'permanent' ? 'btn-active' : 'btn-ghost'"
                          @click="editDuration = 'permanent'"
                        >
                          永久
                        </button>
                        <button
                          class="btn btn-xs"
                          :class="editDuration === 'custom' ? 'btn-active' : 'btn-ghost'"
                          @click="editDuration = 'custom'"
                        >
                          自定义
                        </button>
                      </div>
                      <input
                        v-if="editDuration === 'custom'"
                        v-model="editEndCustom"
                        type="datetime-local"
                        class="input input-sm input-bordered w-full mt-2"
                      >
                    </div>
                    <div>
                      <label class="text-xs text-base-content/50 block mb-1">理由</label>
                      <input
                        v-model="editReason"
                        type="text"
                        class="input input-sm input-bordered w-full"
                        maxlength="500"
                      >
                    </div>
                    <div class="flex justify-end gap-1">
                      <button class="btn btn-ghost btn-xs" @click="cancelEdit">取消</button>
                      <button
                        class="btn btn-primary btn-xs"
                        :disabled="actionLoading === ban.id"
                        @click="saveEdit(ban.id)"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>
</template>
