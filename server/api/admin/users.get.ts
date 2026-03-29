export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const query = getQuery(event);
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 20)));
  const search = typeof query.search === "string" ? query.search.slice(0, 100) : "";
  const filter = query.filter === "banned" || query.filter === "admin" ? query.filter : undefined;

  const mongoFilter: Record<string, unknown> = {};

  // Search: escaped regex on gameId or email
  if (search) {
    const escaped = escapeRegExp(search);
    mongoFilter.$or = [
      { gameId: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ];
  }

  // Filter by status
  if (filter === "admin") {
    mongoFilter.isAdmin = true;
  } else if (filter === "banned") {
    const now = new Date();
    mongoFilter.bans = {
      $elemMatch: {
        revokedAt: { $exists: false },
        start: { $lte: now },
        $or: [{ end: { $exists: false } }, { end: { $gt: now } }],
      },
    };
  }

  const collection = getUserCollection();
  const [users, total] = await Promise.all([
    collection
      .find(mongoFilter, {
        projection: { uuid: 1, gameId: 1, email: 1, isAdmin: 1, bans: 1, time: 1 },
      })
      .sort({ "time.register": -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(mongoFilter),
  ]);

  return {
    success: true,
    users: users.map((u) => ({
      id: u.uuid,
      gameId: u.gameId,
      email: u.email,
      isAdmin: u.isAdmin,
      hasBan: hasActiveBan(u.bans),
      registerAt: u.time.register.getTime(),
    })),
    total,
    page,
    pageSize,
  };
});
