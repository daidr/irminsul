export function useUser() {
  return useNuxtData<any>("current-user");
}
