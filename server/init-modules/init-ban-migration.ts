import { createLogger } from "evlog";

export async function initBanMigration() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "ban-migration" });

  const collection = getUserCollection();

  // Find users with at least one ban record missing the `id` field
  const cursor = collection.find(
    { bans: { $elemMatch: { id: { $exists: false } } } },
    { projection: { _id: 1, bans: 1 } },
  );

  let migratedCount = 0;
  for await (const user of cursor) {
    const updatedBans = user.bans.map((ban) => ({
      ...ban,
      id: ban.id ?? crypto.randomUUID(),
      operatorId: ban.operatorId ?? "system",
    }));

    await collection.updateOne(
      { _id: user._id },
      { $set: { bans: updatedBans } },
    );
    migratedCount++;
  }

  log.set({ status: "ok", migratedCount });
  log.emit();
}
