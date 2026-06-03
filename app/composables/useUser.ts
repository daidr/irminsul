import type { ClientUser } from "~~/shared/client-user";

export function useUser() {
  return useNuxtData<ClientUser>("current-user");
}
