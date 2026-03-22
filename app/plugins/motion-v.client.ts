import { MotionPlugin } from "motion-v";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(MotionPlugin);
});
