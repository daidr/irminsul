import { shallowRef } from "vue";

export interface ToastInfo {
  _id: string;
  _createdAt: number;
  content: string;
  type?: "info" | "success" | "warning" | "error" | "loading";
  icon?: string;
  onClose?: () => void;
  duration?: number | false;
  hideClose?: boolean;
}

export type ToastProps = Omit<ToastInfo, "_id" | "_createdAt">;
type ToastInput = string | Omit<ToastProps, "type">;

// Client-only shared state — never mutated during SSR
const toasts = shallowRef<ToastInfo[]>([]);

function generateId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createToast(props: ToastProps) {
  const id = generateId();
  const toast: ToastInfo = { _id: id, _createdAt: Date.now(), ...props };
  toasts.value = [toast, ...toasts.value];
  return { close: () => closeToast(id) };
}

function closeToast(id: string) {
  const toast = toasts.value.find((t) => t._id === id);
  if (toast?.onClose) toast.onClose();
  toasts.value = toasts.value.filter((t) => t._id !== id);
}

function normalize(input: ToastInput): Omit<ToastProps, "type"> {
  return typeof input === "string" ? { content: input } : input;
}

export function useToast() {
  return {
    toasts,
    createToast,
    closeToast,
    info(input: ToastInput) {
      const p = normalize(input);
      return createToast({ ...p, type: "info", duration: p.duration ?? 2000 });
    },
    success(input: ToastInput) {
      const p = normalize(input);
      return createToast({ ...p, type: "success", duration: p.duration ?? 2000 });
    },
    warning(input: ToastInput) {
      const p = normalize(input);
      return createToast({ ...p, type: "warning", duration: p.duration ?? 2000 });
    },
    error(input: ToastInput) {
      const p = normalize(input);
      return createToast({ ...p, type: "error", duration: p.duration ?? 2000 });
    },
    loading(input: ToastInput) {
      const p = normalize(input);
      return createToast({
        ...p,
        type: "loading",
        duration: p.duration ?? false,
        hideClose: p.hideClose ?? true,
      });
    },
  };
}
