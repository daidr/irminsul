export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const query = getQuery(event);

  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache");
  setResponseHeader(event, "Connection", "keep-alive");

  const manager = getPluginManager();
  const logManager = manager.getLogManager();

  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = logManager.subscribe(id, controller, {
        level: query.level as string | undefined,
        type: query.type as string | undefined,
      });

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
