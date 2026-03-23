export default defineNitroPlugin(() => {
  console.log("[Plugin 00] Runtime check");
  if (typeof Bun === "undefined") {
    console.error("Irminsul requires Bun runtime.");
    process.exit(1);
  }
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });
});
