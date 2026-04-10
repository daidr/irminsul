<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { Delete02Icon, PlusSignIcon, Copy01Icon } from "@hugeicons/core-free-icons";

useHead({ title: "创建应用" });

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

const SCOPE_OPTIONS = [
  { value: "profile:read", label: "profile:read - 读取基础档案", required: true },
  { value: "profile:write", label: "profile:write - 修改材质", required: false },
  { value: "email:read", label: "email:read - 读取邮箱地址", required: false },
  { value: "account:base", label: "account:base - 读取基础账户信息", required: false },
  { value: "account:ban", label: "account:ban - 读取封禁信息", required: false },
];

const name = ref("");
const description = ref("");
const type = ref<"confidential" | "public">("confidential");
const redirectUris = ref([""] as string[]);
const scopes = ref<string[]>(["profile:read"]);
const icon = ref<{ name: string; hue: number } | null>(null);

const isSubmitting = ref(false);

// Credential display
const createdClientId = ref("");
const createdClientSecret = ref("");
const credentialDialogRef = useTemplateRef<HTMLDialogElement>("credentialDialogRef");

function addRedirectUri() {
  redirectUris.value.push("");
}

function removeRedirectUri(index: number) {
  if (redirectUris.value.length <= 1) return;
  redirectUris.value.splice(index, 1);
}

function toggleScope(scope_value: string) {
  const idx = scopes.value.indexOf(scope_value);
  if (idx >= 0) {
    scopes.value.splice(idx, 1);
  } else {
    scopes.value.push(scope_value);
  }
}

async function handleSubmit() {
  if (!name.value.trim()) {
    toast.error("请输入应用名称");
    return;
  }

  const validUris = redirectUris.value.filter((u) => u.trim());
  if (validUris.length === 0) {
    toast.error("请添加至少一个回调地址");
    return;
  }

  if (scopes.value.length === 0) {
    toast.error("请选择至少一个权限范围");
    return;
  }

  isSubmitting.value = true;
  try {
    const result = await $fetch<{
      success: boolean;
      clientId: string;
      clientSecret: string | null;
    }>("/api/oauth-provider/apps", {
      method: "POST",
      body: {
        name: name.value.trim(),
        description: description.value.trim(),
        type: type.value,
        redirectUris: validUris,
        scopes: scopes.value,
        icon: icon.value,
      },
    });

    if (result.success) {
      createdClientId.value = result.clientId;
      createdClientSecret.value = result.clientSecret ?? "";
      credentialDialogRef.value?.showModal();
    }
  } catch {
    toast.error("创建应用失败，请重试");
  } finally {
    isSubmitting.value = false;
  }
}

function handleCredentialClose() {
  navigateTo("/developer/apps");
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("已复制到剪贴板");
}
</script>

<template>
  <div class="flex justify-center px-4 py-8 bg-base-100 min-h-dvh -mt-18 pt-22">
    <form class="w-full max-w-140 flex flex-col gap-6" @submit.prevent="handleSubmit">
      <h1 class="text-2xl font-bold">创建应用</h1>

      <!-- Icon -->
      <IconPicker v-model="icon" />

      <!-- Name -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">应用名称</legend>
        <input
          v-model="name"
          type="text"
          class="input input-bordered w-full"
          placeholder="我的应用"
          maxlength="100"
          required
        />
      </fieldset>

      <!-- Description -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">描述</legend>
        <textarea
          v-model="description"
          class="textarea textarea-bordered w-full"
          placeholder="应用描述（可选）"
          maxlength="500"
          rows="3"
        />
      </fieldset>

      <!-- Type -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">应用类型</legend>
        <select v-model="type" class="select select-bordered w-full">
          <option value="confidential">机密应用（Confidential）— 有后端服务器</option>
          <option value="public">公开应用（Public）— 纯前端/移动端</option>
        </select>
      </fieldset>

      <!-- Redirect URIs -->
      <fieldset class="fieldset">
        <legend class="fieldset-legend text-sm font-semibold">回调地址</legend>
        <div class="flex flex-col gap-2">
          <div v-for="(_, index) in redirectUris" :key="index" class="flex gap-2">
            <input
              v-model="redirectUris[index]"
              type="url"
              class="input input-bordered flex-1"
              placeholder="https://example.com/callback"
              required
            />
            <button
              v-if="redirectUris.length > 1"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="removeRedirectUri(index)"
            >
              <HugeiconsIcon :icon="Delete02Icon" :size="16" />
            </button>
          </div>
          <button
            v-if="redirectUris.length < 10"
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
              :checked="scopes.includes(opt.value)"
              :disabled="opt.required"
              @change="toggleScope(opt.value)"
            />
            <span class="text-sm" :class="{ 'text-base-content/50': opt.required }">{{ opt.label }}</span>
            <span v-if="opt.required" class="badge badge-ghost badge-xs">必选</span>
          </label>
        </div>
      </fieldset>

      <!-- Submit -->
      <div class="flex gap-3">
        <NuxtLink to="/developer/apps" class="btn btn-ghost flex-1">取消</NuxtLink>
        <button type="submit" class="btn btn-primary flex-1" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="loading loading-spinner loading-sm" />
          创建
        </button>
      </div>
    </form>
  </div>

  <!-- Credential Display Modal -->
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="credentialDialogRef" class="modal modal-bottom sm:modal-middle" @close="handleCredentialClose">
        <div class="modal-box">
          <h3 class="text-lg font-bold">应用创建成功</h3>
          <p class="text-sm text-base-content/60 mt-2">请妥善保存以下凭据，Client Secret 仅显示一次。</p>

          <div class="flex flex-col gap-3 mt-4">
            <div>
              <p class="text-xs font-semibold text-base-content/60 mb-1">Client ID</p>
              <div class="flex items-center gap-2 bg-base-200 border border-base-300 p-2">
                <code class="text-sm flex-1 break-all">{{ createdClientId }}</code>
                <button type="button" class="btn btn-ghost btn-xs" @click="copyToClipboard(createdClientId)">
                  <HugeiconsIcon :icon="Copy01Icon" :size="16" />
                </button>
              </div>
            </div>

            <div v-if="createdClientSecret">
              <p class="text-xs font-semibold text-base-content/60 mb-1">Client Secret</p>
              <div class="flex items-center gap-2 bg-base-200 border border-base-300 p-2">
                <code class="text-sm flex-1 break-all">{{ createdClientSecret }}</code>
                <button type="button" class="btn btn-ghost btn-xs" @click="copyToClipboard(createdClientSecret)">
                  <HugeiconsIcon :icon="Copy01Icon" :size="16" />
                </button>
              </div>
            </div>
          </div>

          <div class="modal-action">
            <form method="dialog">
              <button class="btn btn-primary">我已保存，关闭</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>
</template>
