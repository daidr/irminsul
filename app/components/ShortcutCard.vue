<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import {
  ParagraphBulletsPoint01Icon,
  SquareLockPasswordIcon,
  GameController03Icon,
  Key01Icon,
  CalendarRemove01Icon,
  LinkCircle02Icon,
  DashboardSquareSettingIcon,
  Plug01Icon,
  SourceCodeIcon,
  AuthorizedIcon,
  ApiIcon,
} from "@hugeicons/core-free-icons";

const props = defineProps<{
  isAdmin?: boolean;
  isDeveloper?: boolean;
}>();

const emit = defineEmits<{
  "change-password": [];
  "session-manage": [];
  "passkey-manage": [];
  "ban-history": [];
  "oauth-bindings": [];
  "admin-panel": [];
}>();

type ShortcutAction =
  | "change-password"
  | "session-manage"
  | "passkey-manage"
  | "ban-history"
  | "oauth-bindings"
  | "admin-panel";
type ShortcutIcon = typeof ParagraphBulletsPoint01Icon;

type ShortcutItem = {
  icon: ShortcutIcon;
  label: string;
  kind: "button" | "link";
  action?: ShortcutAction;
  to?: string;
  show?: () => boolean;
};

type ShortcutSection = {
  title: string;
  items: ShortcutItem[];
};

const shortcutSections: ShortcutSection[] = [
  {
    title: "账号安全",
    items: [
      {
        icon: SquareLockPasswordIcon,
        label: "修改密码",
        kind: "button",
        action: "change-password",
      },
      { icon: Key01Icon, label: "通行密钥", kind: "button", action: "passkey-manage" },
      { icon: LinkCircle02Icon, label: "账号绑定", kind: "button", action: "oauth-bindings" },
      { icon: AuthorizedIcon, label: "应用授权", kind: "link", to: "/settings/authorizations" },
    ],
  },
  {
    title: "游戏与记录",
    items: [
      { icon: GameController03Icon, label: "会话管理", kind: "button", action: "session-manage" },
      { icon: CalendarRemove01Icon, label: "封禁记录", kind: "button", action: "ban-history" },
    ],
  },
  {
    title: "管理与开发",
    items: [
      {
        icon: DashboardSquareSettingIcon,
        label: "管理面板",
        kind: "button",
        action: "admin-panel",
        show: () => !!props.isAdmin,
      },
      {
        icon: Plug01Icon,
        label: "插件管理",
        kind: "link",
        to: "/admin/plugins",
        show: () => !!props.isAdmin,
      },
      {
        icon: SourceCodeIcon,
        label: "开发者",
        kind: "link",
        to: "/developer/apps",
        show: () => !!(props.isDeveloper || props.isAdmin),
      },
      {
        icon: ApiIcon,
        label: "OAuth 应用",
        kind: "link",
        to: "/admin/oauth-apps",
        show: () => !!props.isAdmin,
      },
    ],
  },
];

const visibleShortcutSections = computed(() =>
  shortcutSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.show?.() ?? true),
    }))
    .filter((section) => section.items.length > 0),
);

function handleClick(item: ShortcutItem) {
  switch (item.action) {
    case "change-password":
      emit("change-password");
      break;
    case "session-manage":
      emit("session-manage");
      break;
    case "passkey-manage":
      emit("passkey-manage");
      break;
    case "ban-history":
      emit("ban-history");
      break;
    case "oauth-bindings":
      emit("oauth-bindings");
      break;
    case "admin-panel":
      emit("admin-panel");
      break;
  }
}
</script>

<template>
  <div class="border border-base-300 bg-base-200 p-5">
    <div class="flex items-center gap-2.5 text-lg">
      <HugeiconsIcon :icon="ParagraphBulletsPoint01Icon" :size="20" />
      <h2>快捷入口</h2>
    </div>
    <div class="mt-4 space-y-5">
      <section v-for="section in visibleShortcutSections" :key="section.title">
        <div class="mb-2.5 flex items-center gap-3">
          <h3 class="text-[11px] font-medium text-base-content/60">{{ section.title }}</h3>
          <div class="h-px flex-1 bg-base-content/15" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <template v-for="item in section.items" :key="item.label">
            <NuxtLink v-if="item.kind === 'link'" :to="item.to" class="btn border border-base-300">
              <HugeiconsIcon :icon="item.icon" :size="18" class="shrink-0" />
              <span class="text-[13px] font-medium">{{ item.label }}</span>
            </NuxtLink>
            <button
              v-else
              type="button"
              class="btn border border-base-300"
              @click="handleClick(item)"
            >
              <HugeiconsIcon :icon="item.icon" :size="18" class="shrink-0" />
              <span class="text-[13px] font-medium">{{ item.label }}</span>
            </button>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
