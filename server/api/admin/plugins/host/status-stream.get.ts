export default defineEventHandler(async (event) => {
  requireAdmin(event);

  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache");
  setResponseHeader(event, "Connection", "keep-alive");

  const manager = getPluginManager();

  const stream = new ReadableStream({
    start(controller) {
      // Send current status immediately
      const current = manager.getHostStatus();
      controller.enqueue(
        new TextEncoder().encode(
          `event: status\ndata: ${JSON.stringify(current)}\n\n`,
        ),
      );

      const unsubscribe = manager.subscribeHostStatus(controller);

      event.node.req.on("close", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream);
});
