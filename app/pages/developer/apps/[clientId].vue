<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import {
  ArrowLeft01Icon,
  Copy01Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

useHead({ title: "应用详情" });

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { data: user } = useUser();

// Developer guard
watch(
  () => user.value,
  (u) => {
    if (!u || (!u.isDeveloper && !u.isAdmin)) router.replace("/");
  },
  { immediate: true },
);

const SCOPE_OPTIONS = [
  { value: "profile:read", label: "profile:read - 读取基础档案", required: true },
  { value: "profile:write", label: "profile:write - 修改材质", required: false },
  { value: "email:read", label: "email:read - 读取邮箱地址", required: false },
  { value: "account:base", label: "account:base - 读取基础账户信息", required: false },
  { value: "account:ban", label: "account:ban - 读取封禁信息", required: false },
];

const clientId = computed(() => route.params.clientId as string);

interface AppDetail {
  clientId: string;
  name: string;
  description: string;
  icon: { name: string; hue: number } | null;
  type: string;
  redirectUris: string[];
  scopes: string[];
  approved: boolean;
  createdAt: string;
}

const app = ref<AppDetail | null>(null);
const loading = ref(true);

// Edit form
const editName = ref("");
const editDescription = ref("");
const editRedirectUris = ref<string[]>([]);
const editScopes = ref<string[]>([]);
const editIcon = ref<{ name: string; hue: number } | null>(null);
const isSaving = ref(false);

async function fetchApp() {
  loading.value = true;
  try {
    const data = await $fetch<AppDetail>(`/api/oauth-provider/apps/${clientId.value}`);
    app.value = data;
    editName.value = data.name;
    editDescription.value = data.description;
    editRedirectUris.value = [...data.redirectUris];
    editScopes.value = [...data.scopes];
    editIcon.value = data.icon ? { ...data.icon } : null;
  } catch {
    toast.error("加载应用详情失败");
  } finally {
    loading.value = false;
  }
}

onMounted(fetchApp);

function addRedirectUri() {
  editRedirectUris.value.push("");
}

function removeRedirectUri(index: number) {
  if (editRedirectUris.value.length <= 1) return;
  editRedirectUris.value.splice(index, 1);
}

function toggleScope(scope_value: string) {
  const idx = editScopes.value.indexOf(scope_value);
  if (idx >= 0) {
    editScopes.value.splice(idx, 1);
  } else {
    editScopes.value.push(scope_value);
  }
}

async function handleSave() {
  if (!editName.value.trim()) {
    toast.error("应用名称不能为空");
    return;
  }
  const validUris = editRedirectUris.value.filter((u) => u.trim());
  if (validUris.length === 0) {
    toast.error("请添加至少一个回调地址");
    return;
  }
  if (editScopes.value.length === 0) {
    toast.error("请选择至少一个权限范围");
    return;
  }

  isSaving.value = true;
  try {
    await $fetch(`/api/oauth-provider/apps/${clientId.value}`, {
      method: "PATCH",
      body: {
        name: editName.value.trim(),
        description: editDescription.value.trim(),
        redirectUris: validUris,
        scopes: editScopes.value,
        icon: editIcon.value,
      },
    });
    toast.success("保存成功");
    await fetchApp();
  } catch {
    toast.error("保存失败，请重试");
  } finally {
    isSaving.value = false;
  }
}

// Reset secret
const resetSecretDialogRef = useTemplateRef<HTMLDialogElement>("resetSecretDialogRef");
const newSecret = ref("");
const isResettingSecret = ref(false);

async function handleResetSecret() {
  isResettingSecret.value = true;
  try {
    const result = await $fetch<{ success: boolean; clientSecret: string }>(
      `/api/oauth-provider/apps/${clientId.value}/reset-secret`,
      { method: "POST" },
    );
    if (result.success) {
      newSecret.value = result.clientSecret;
      resetSecretDialogRef.value?.showModal();
    }
  } catch {
    toast.error("重置密钥失败");
  } finally {
    isResettingSecret.value = false;
  }
}

// Delete app
const deleteDialogRef = useTemplateRef<HTMLDialogElement>("deleteDialogRef");
const isDeleting = ref(false);

async function handleDelete() {
  isDeleting.value = true;
  try {
    await $fetch(`/api/oauth-provider/apps/${clientId.value}`, { method: "DELETE" });
    toast.success("应用已删除");
    await navigateTo("/developer/apps");
  } catch {
    toast.error("删除失败");
  } finally {
    isDeleting.value = false;
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("已复制到剪贴板");
}
</script>

<template>
  <div class="flex justify-center px-4 py-8 bg-base-100 min-h-dvh -mt-18 pt-22">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center p-12">
      <span class="loading loading-spinner loading-md" />
    </div>

    <form v-else-if="app" class="w-full max-w-140 flex flex-col gap-6" @submit.prevent="handleSave">
      <div class="flex items-center gap-3">
        <NuxtLink to="/developer/apps" class="btn btn-ghost btn-sm">
          <HugeiconsIcon :icon="ArrowLeft01Icon" :size="16" />
        </NuxtLink>
        <h1 class="text-2xl font-bold">编辑应用</h1>
      </div>

      <!-- Icon + Name -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">应用名称</legend>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 shrink-0">
            <IconPicker v-model="editIcon" />
          </div>
          <input
            v-model="editName"
            type="text"
            class="input input-bordered w-full"
            maxlength="100"
            required
          />
        </div>
      </fieldset>

      <!-- Client ID (readonly) -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">Client ID</legend>
        <div class="flex items-center gap-2">
          <input type="text" class="input input-bordered w-full" :value="app.clientId" readonly />
          <button type="button" class="btn btn-ghost btn-sm" @click="copyToClipboard(app.clientId)">
            <HugeiconsIcon :icon="Copy01Icon" :size="16" />
          </button>
        </div>
      </fieldset>

      <!-- Status -->
      <div class="flex items-center gap-2">
        <span class="text-sm text-base-content/60">状态：</span>
        <span v-if="app.approved" class="badge badge-success badge-sm">已审批</span>
        <span v-else class="badge badge-warning badge-sm">待审批</span>
        <span
          class="badge badge-sm"
          :class="app.type === 'confidential' ? 'badge-info' : 'badge-ghost'"
        >
          {{ app.type === "confidential" ? "机密" : "公开" }}
        </span>
      </div>

      <!-- Description -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">描述</legend>
        <textarea
          v-model="editDescription"
          class="textarea textarea-bordered w-full"
          maxlength="500"
          rows="3"
        />
      </fieldset>

      <!-- Redirect URIs -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">回调地址</legend>
        <div class="flex flex-col gap-2">
          <div v-for="(_, index) in editRedirectUris" :key="index" class="flex gap-2">
            <input
              v-model="editRedirectUris[index]"
              type="url"
              class="input input-bordered flex-1"
              placeholder="https://example.com/callback"
              required
            />
            <button
              v-if="editRedirectUris.length > 1"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="removeRedirectUri(index)"
            >
              <HugeiconsIcon :icon="Delete02Icon" :size="16" />
            </button>
          </div>
          <button
            v-if="editRedirectUris.length < 10"
            type="button"
            class="btn btn-ghost btn-sm self-start"
            @click="addRedirectUri"
          >
            <HugeiconsIcon :icon="PlusSignIcon" :size="16" />
            添加回调地址
          </button>
        </div>
      </fieldset>

      <!-- Scopes -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">权限范围</legend>
        <div class="flex flex-col gap-2">
          <label
            v-for="opt in SCOPE_OPTIONS"
            :key="opt.value"
            class="flex items-center gap-2 cursor-pointer p-2 border border-base-300 hover:bg-base-200 transition-colors"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              :checked="editScopes.includes(opt.value)"
              :disabled="opt.required"
              @change="toggleScope(opt.value)"
            />
            <span class="text-sm" :class="{ 'text-base-content/50': opt.required }">{{
              opt.label
            }}</span>
            <span v-if="opt.required" class="badge badge-ghost badge-xs">必选</span>
          </label>
        </div>
      </fieldset>

      <!-- Save -->
      <button type="submit" class="btn btn-primary w-full" :disabled="isSaving">
        <span v-if="isSaving" class="loading loading-spinner loading-sm" />
        保存修改
      </button>

      <!-- Danger zone -->
      <div class="border border-error/30 p-4 flex flex-col gap-3 mt-4">
        <h2 class="text-sm font-bold text-error">危险操作</h2>

        <div v-if="app.type === 'confidential'" class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">重置 Client Secret</p>
            <p class="text-xs text-base-content/60">现有密钥将立即失效，所有令牌将被吊销</p>
          </div>
          <button
            type="button"
            class="btn btn-outline btn-error btn-sm"
            :disabled="isResettingSecret"
            @click="handleResetSecret"
          >
            <span v-if="isResettingSecret" class="loading loading-spinner loading-sm" />
            重置密钥
          </button>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">删除应用</p>
            <p class="text-xs text-base-content/60">此操作不可逆，所有授权和令牌将被清除</p>
          </div>
          <button type="button" class="btn btn-error btn-sm" @click="deleteDialogRef?.showModal()">
            删除
          </button>
        </div>
      </div>
    </form>

    <div v-else class="text-center text-base-content/40 py-12">应用不存在</div>
  </div>

  <!-- Reset Secret Modal -->
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="resetSecretDialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>
          <h3 class="text-lg font-bold">新的 Client Secret</h3>
          <p class="text-sm text-base-content/60 mt-2">请妥善保存，此密钥仅显示一次。</p>
          <div class="flex items-center gap-2 bg-base-200 border border-base-300 p-2 mt-4">
            <code class="text-sm flex-1 break-all">{{ newSecret }}</code>
            <button type="button" class="btn btn-ghost btn-xs" @click="copyToClipboard(newSecret)">
              <HugeiconsIcon :icon="Copy01Icon" :size="16" />
            </button>
          </div>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn btn-primary">我已保存</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>

  <!-- Delete Confirm Modal -->
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="deleteDialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>
          <h3 class="text-lg font-bold">确认删除</h3>
          <p class="py-4 text-sm">
            确定要删除这个应用吗？所有相关的授权和令牌都将被清除，此操作不可逆。
          </p>
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
