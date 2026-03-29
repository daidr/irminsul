# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin user management page with paginated user list, search/filter, and full ban record CRUD (create, revoke, edit, remove).

**Architecture:** Extend the existing embedded `BanRecord` array in user documents with new fields (`id`, `operatorId`, `revokedAt`, `revokedBy`). Add ban repository functions in a new `server/utils/ban.repository.ts`. Create 6 API routes under `/api/admin/`. Build a new `/admin/users` page with a user table and ban detail modal. Update existing components to support the new ban fields.

**Tech Stack:** TypeScript, MongoDB (embedded array operations), Nuxt 4, Vue 3 Composition API, DaisyUI 5, Vitest.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `server/utils/ban.repository.ts` | Ban CRUD operations on user.bans array |
| `server/utils/escape-regexp.ts` | Regex special character escaping utility |
| `server/init-modules/init-ban-migration.ts` | One-time migration for old BanRecord data |
| `server/api/admin/users/[userId]/bans.get.ts` | GET user's ban list |
| `server/api/admin/users/[userId]/bans.post.ts` | POST create new ban |
| `server/api/admin/users/[userId]/bans/[banId].patch.ts` | PATCH edit ban |
| `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts` | POST revoke ban |
| `server/api/admin/users/[userId]/bans/[banId].delete.ts` | DELETE remove ban |
| `app/pages/admin/users.vue` | Admin user management page |
| `app/components/admin/BanModal.vue` | Ban detail modal component |
| `tests/utils/ban.repository.test.ts` | Ban repository unit tests |
| `tests/utils/escape-regexp.test.ts` | escapeRegExp unit tests |
| `tests/utils/has-active-ban.test.ts` | hasActiveBan unit tests |

### Modified files
| File | Changes |
|------|---------|
| `server/types/user.schema.ts` | Extend BanRecord interface, update hasActiveBan() |
| `server/middleware/01.session.ts` | Pass new ban fields (id, revokedAt, operatorId) to client |
| `server/plugins/server-startup.ts` | Call initBanMigration() in Phase 2 |
| `server/api/admin/users.get.ts` | Replace stub with paginated user list |
| `app/components/BanHistoryModal.vue` | Support revokedAt status display |
| `app/components/AdminUserManageTab.vue` | Replace stub with link to /admin/users |

---

### Task 1: Extend BanRecord type and update hasActiveBan

**Files:**
- Modify: `server/types/user.schema.ts:28-43`
- Create: `tests/utils/has-active-ban.test.ts`

- [ ] **Step 1: Write failing tests for updated hasActiveBan**

Create `tests/utils/has-active-ban.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Import after defining — file uses no external deps
let hasActiveBan: typeof import("../../server/types/user.schema").hasActiveBan;
let BanRecord: any;

import("../../server/types/user.schema").then((mod) => {
  hasActiveBan = mod.hasActiveBan;
});

describe("hasActiveBan", () => {
  const now = Date.now();
  const past = new Date(now - 86400000); // 1 day ago
  const future = new Date(now + 86400000); // 1 day from now

  it("returns false for empty array", () => {
    expect(hasActiveBan([])).toBe(false);
  });

  it("returns true for active permanent ban (no end, no revokedAt)", () => {
    expect(hasActiveBan([{ id: "1", start: past, operatorId: "op1" }])).toBe(true);
  });

  it("returns true for active timed ban (end in future, no revokedAt)", () => {
    expect(hasActiveBan([{ id: "2", start: past, end: future, operatorId: "op1" }])).toBe(true);
  });

  it("returns false for expired ban (end in past)", () => {
    expect(hasActiveBan([{ id: "3", start: new Date(now - 172800000), end: past, operatorId: "op1" }])).toBe(false);
  });

  it("returns false for revoked ban (revokedAt set)", () => {
    expect(hasActiveBan([{ id: "4", start: past, operatorId: "op1", revokedAt: new Date(now - 3600000) }])).toBe(false);
  });

  it("returns false for revoked permanent ban", () => {
    expect(hasActiveBan([{ id: "5", start: past, operatorId: "op1", revokedAt: past }])).toBe(false);
  });

  it("returns true when at least one ban is active among mixed", () => {
    expect(hasActiveBan([
      { id: "6", start: new Date(now - 172800000), end: past, operatorId: "op1" }, // expired
      { id: "7", start: past, operatorId: "op1", revokedAt: past }, // revoked
      { id: "8", start: past, operatorId: "op1" }, // active permanent
    ])).toBe(true);
  });

  it("handles legacy records without id/operatorId", () => {
    // Legacy records lack id and operatorId fields
    expect(hasActiveBan([{ start: past } as any])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk vitest run tests/utils/has-active-ban.test.ts`
Expected: FAIL — current `hasActiveBan` doesn't check `revokedAt`, and type errors due to new required fields.

- [ ] **Step 3: Update BanRecord interface and hasActiveBan**

In `server/types/user.schema.ts`, replace the `BanRecord` interface (lines 28-35) and `hasActiveBan` function (lines 40-43):

```typescript
export interface BanRecord {
  id: string;
  start: Date;
  end?: Date;
  reason?: string;
  operatorId: string;
  revokedAt?: Date;
  revokedBy?: string;
}

/**
 * Active = not revoked AND start <= now AND (no end OR end > now).
 * Tolerates legacy records missing id/operatorId.
 */
export function hasActiveBan(bans: BanRecord[]): boolean {
  if (!bans?.length) return false;
  const now = new Date();
  return bans.some(
    (ban) => !ban.revokedAt && ban.start <= now && (!ban.end || ban.end > now),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk vitest run tests/utils/has-active-ban.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add server/types/user.schema.ts tests/utils/has-active-ban.test.ts
rtk git commit -m "feat(ban): extend BanRecord with id/operatorId/revokedAt and update hasActiveBan"
```

---

### Task 2: Add escapeRegExp utility

**Files:**
- Create: `server/utils/escape-regexp.ts`
- Create: `tests/utils/escape-regexp.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/escape-regexp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { escapeRegExp } from "../../server/utils/escape-regexp";

describe("escapeRegExp", () => {
  it("escapes all special regex characters", () => {
    expect(escapeRegExp("a.b*c+d?e[f]g{h}i(j)k^l$m|n\\o")).toBe(
      "a\\.b\\*c\\+d\\?e\\[f\\]g\\{h\\}i\\(j\\)k\\^l\\$m\\|n\\\\o",
    );
  });

  it("returns empty string for empty input", () => {
    expect(escapeRegExp("")).toBe("");
  });

  it("passes through normal text unchanged", () => {
    expect(escapeRegExp("hello world")).toBe("hello world");
  });

  it("handles ReDoS attack pattern", () => {
    const malicious = "(a+)+$";
    const escaped = escapeRegExp(malicious);
    // Escaped pattern should be a safe literal match
    expect(escaped).toBe("\\(a\\+\\)\\+\\$");
    // Verify it works as a safe regex
    const re = new RegExp(escaped);
    expect(re.test("(a+)+$")).toBe(true);
    expect(re.test("aaa")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk vitest run tests/utils/escape-regexp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement escapeRegExp**

Create `server/utils/escape-regexp.ts`:

```typescript
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk vitest run tests/utils/escape-regexp.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add server/utils/escape-regexp.ts tests/utils/escape-regexp.test.ts
rtk git commit -m "feat(utils): add escapeRegExp utility for safe regex construction"
```

---

### Task 3: Add ban repository functions

**Files:**
- Create: `server/utils/ban.repository.ts`
- Create: `tests/utils/ban.repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/ban.repository.test.ts`. The repository functions operate on MongoDB collection, so we mock `getUserCollection()`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getUserCollection
const mockUpdateOne = vi.fn();
const mockFindOne = vi.fn();
const mockCollection = {
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
};

vi.mock("../../server/utils/user.repository", () => ({
  getUserCollection: () => mockCollection,
}));

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "test-uuid-1234",
});

let banRepo: typeof import("../../server/utils/ban.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  banRepo = await import("../../server/utils/ban.repository");
});

describe("addBan", () => {
  it("pushes a new ban record with generated id and operatorId", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.addBan("user-uuid", { reason: "test" }, "admin-uuid");

    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$push.bans.id).toBe("test-uuid-1234");
    expect(update.$push.bans.operatorId).toBe("admin-uuid");
    expect(update.$push.bans.reason).toBe("test");
    expect(update.$push.bans.start).toBeInstanceOf(Date);
    expect(update.$push.bans.end).toBeUndefined();
    expect(result).toEqual({ success: true, banId: "test-uuid-1234" });
  });

  it("sets end date when provided", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const end = new Date("2026-12-31T00:00:00Z");
    await banRepo.addBan("user-uuid", { end, reason: "temp" }, "admin-uuid");

    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$push.bans.end).toEqual(end);
  });

  it("returns failure when user not found", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await banRepo.addBan("nonexistent", {}, "admin-uuid");
    expect(result).toEqual({ success: false, error: "用户不存在" });
  });
});

describe("revokeBan", () => {
  it("sets revokedAt and revokedBy on matching active ban using $elemMatch", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.revokeBan("user-uuid", "ban-id", "admin-uuid");

    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    // Must use $elemMatch to ensure conditions match the SAME array element
    expect(filter.uuid).toBe("user-uuid");
    expect(filter.bans.$elemMatch.id).toBe("ban-id");
    expect(filter.bans.$elemMatch.revokedAt).toEqual({ $exists: false });
    expect(filter.bans.$elemMatch.start).toBeDefined(); // $lte check
    expect(update.$set["bans.$.revokedAt"]).toBeInstanceOf(Date);
    expect(update.$set["bans.$.revokedBy"]).toBe("admin-uuid");
    expect(result).toEqual({ success: true });
  });

  it("returns failure when ban already revoked, expired, or not found", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await banRepo.revokeBan("user-uuid", "ban-id", "admin-uuid");
    expect(result).toEqual({ success: false, error: "该封禁已被撤销、已过期或不存在" });
  });
});

describe("editBan", () => {
  it("updates end and reason on matching ban", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const end = new Date("2027-01-01T00:00:00Z");
    const result = await banRepo.editBan("user-uuid", "ban-id", { end, reason: "updated" });

    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid", "bans.id": "ban-id" });
    expect(update.$set["bans.$.end"]).toEqual(end);
    expect(update.$set["bans.$.reason"]).toBe("updated");
    expect(result).toEqual({ success: true });
  });

  it("unsets end when null (make permanent)", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.editBan("user-uuid", "ban-id", { end: null });

    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$unset["bans.$.end"]).toBe("");
    expect(result).toEqual({ success: true });
  });

  it("returns failure when ban not found", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await banRepo.editBan("user-uuid", "ban-id", { reason: "x" });
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });
});

describe("removeBan", () => {
  it("pulls ban record from array", async () => {
    mockFindOne.mockResolvedValue({ bans: [{ id: "ban-id", start: new Date(), operatorId: "op" }] });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.removeBan("user-uuid", "ban-id");

    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$pull.bans).toEqual({ id: "ban-id" });
    expect(result.success).toBe(true);
    expect(result.removed).toBeDefined();
  });

  it("returns failure when ban not found", async () => {
    mockFindOne.mockResolvedValue({ bans: [] });
    const result = await banRepo.removeBan("user-uuid", "nonexistent");
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });
});

describe("getUserBans", () => {
  it("returns bans array for user", async () => {
    const bans = [
      { id: "1", start: new Date("2026-03-01"), operatorId: "op" },
      { id: "2", start: new Date("2026-01-01"), operatorId: "op" },
    ];
    mockFindOne.mockResolvedValue({ bans });
    const result = await banRepo.getUserBans("user-uuid");
    expect(result).toEqual(bans);
    expect(mockFindOne).toHaveBeenCalledWith(
      { uuid: "user-uuid" },
      { projection: { bans: 1 } },
    );
  });

  it("returns empty array when user not found", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await banRepo.getUserBans("nonexistent");
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ban repository**

Create `server/utils/ban.repository.ts`:

```typescript
import type { BanRecord } from "~~/server/types/user.schema";

export async function addBan(
  userUuid: string,
  opts: { end?: Date; reason?: string },
  operatorUuid: string,
): Promise<{ success: true; banId: string } | { success: false; error: string }> {
  const ban: BanRecord = {
    id: crypto.randomUUID(),
    start: new Date(),
    operatorId: operatorUuid,
    ...(opts.end && { end: opts.end }),
    ...(opts.reason && { reason: opts.reason }),
  };

  const result = await getUserCollection().updateOne(
    { uuid: userUuid },
    { $push: { bans: ban } },
  );

  if (result.modifiedCount === 0) {
    return { success: false, error: "用户不存在" };
  }
  return { success: true, banId: ban.id };
}

export async function revokeBan(
  userUuid: string,
  banId: string,
  operatorUuid: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const now = new Date();
  const result = await getUserCollection().updateOne(
    {
      uuid: userUuid,
      bans: {
        $elemMatch: {
          id: banId,
          revokedAt: { $exists: false },
          start: { $lte: now },
          $or: [{ end: { $exists: false } }, { end: { $gt: now } }],
        },
      },
    },
    {
      $set: {
        "bans.$.revokedAt": now,
        "bans.$.revokedBy": operatorUuid,
      },
    },
  );

  if (result.modifiedCount === 0) {
    return { success: false, error: "该封禁已被撤销、已过期或不存在" };
  }
  return { success: true };
}

export async function editBan(
  userUuid: string,
  banId: string,
  opts: { end?: Date | null; reason?: string },
): Promise<{ success: true } | { success: false; error: string }> {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, unknown> = {};

  if (opts.end === null) {
    $unset["bans.$.end"] = "";
  } else if (opts.end !== undefined) {
    $set["bans.$.end"] = opts.end;
  }

  if (opts.reason !== undefined) {
    $set["bans.$.reason"] = opts.reason;
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;

  if (Object.keys(update).length === 0) {
    return { success: true }; // nothing to update
  }

  const result = await getUserCollection().updateOne(
    { uuid: userUuid, "bans.id": banId },
    update,
  );

  if (result.modifiedCount === 0) {
    return { success: false, error: "封禁记录不存在" };
  }
  return { success: true };
}

export async function removeBan(
  userUuid: string,
  banId: string,
): Promise<{ success: true; removed: BanRecord } | { success: false; error: string }> {
  // First fetch the ban record for audit logging
  const user = await getUserCollection().findOne(
    { uuid: userUuid },
    { projection: { bans: 1 } },
  );

  const ban = user?.bans?.find((b) => b.id === banId);
  if (!ban) {
    return { success: false, error: "封禁记录不存在" };
  }

  const result = await getUserCollection().updateOne(
    { uuid: userUuid },
    { $pull: { bans: { id: banId } } },
  );

  if (result.modifiedCount === 0) {
    return { success: false, error: "封禁记录不存在" };
  }

  return { success: true, removed: ban };
}

export async function getUserBans(userUuid: string): Promise<BanRecord[]> {
  const user = await getUserCollection().findOne(
    { uuid: userUuid },
    { projection: { bans: 1 } },
  );
  return user?.bans ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add server/utils/ban.repository.ts tests/utils/ban.repository.test.ts
rtk git commit -m "feat(ban): add ban repository with CRUD operations"
```

---

### Task 4: Add data migration for old BanRecords

**Files:**
- Create: `server/init-modules/init-ban-migration.ts`
- Modify: `server/plugins/server-startup.ts:16`

- [ ] **Step 1: Create migration init module**

Create `server/init-modules/init-ban-migration.ts`:

```typescript
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
```

- [ ] **Step 2: Register in server startup plugin**

In `server/plugins/server-startup.ts`, add `initBanMigration` to the Phase 2 `Promise.all` array (line 16). Import it and add to the parallel init:

```typescript
await Promise.all([initIndexes(), initSettings(), initKeys(), initBanMigration()]);
```

Add the import at the top (alongside other init-module imports):

```typescript
import { initBanMigration } from "../init-modules/init-ban-migration";
```

- [ ] **Step 3: Commit**

```bash
rtk git add server/init-modules/init-ban-migration.ts server/plugins/server-startup.ts
rtk git commit -m "feat(ban): add startup migration for legacy ban records"
```

---

### Task 5: Update session middleware

**Files:**
- Modify: `server/middleware/01.session.ts:9-13`

- [ ] **Step 1: Update ban serialization to include new fields**

In `server/middleware/01.session.ts`, replace the ban mapping block (lines 9-13):

```typescript
const bans = (userDoc?.bans ?? []).map((ban) => ({
  id: ban.id,
  start: ban.start.getTime(),
  end: ban.end?.getTime(),
  reason: ban.reason,
  operatorId: ban.operatorId,
  revokedAt: ban.revokedAt?.getTime(),
}));
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/middleware/01.session.ts
rtk git commit -m "feat(session): pass ban id, operatorId, and revokedAt to client"
```

---

### Task 6: Implement GET /api/admin/users

**Files:**
- Modify: `server/api/admin/users.get.ts` (replace stub)

- [ ] **Step 1: Replace the stub with full implementation**

Replace `server/api/admin/users.get.ts` entirely:

```typescript
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

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

  const now = new Date();
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
```

- [ ] **Step 2: Verify the server starts without errors**

Run: `rtk bun run build` (or `bun run dev` and check for type errors)
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
rtk git add server/api/admin/users.get.ts
rtk git commit -m "feat(admin): implement paginated user list API with search and filter"
```

---

### Task 7: Implement ban list and create APIs

**Files:**
- Create: `server/api/admin/users/[userId]/bans.get.ts`
- Create: `server/api/admin/users/[userId]/bans.post.ts`

- [ ] **Step 1: Create GET bans endpoint**

Create `server/api/admin/users/[userId]/bans.get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  if (!userId) {
    return { success: false, error: "缺少用户 ID" };
  }

  const bans = await getUserBans(userId);

  // Sort by start descending, limit 200
  const sorted = bans
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .slice(0, 200);

  return {
    success: true,
    bans: sorted.map((ban) => ({
      id: ban.id,
      start: ban.start.getTime(),
      end: ban.end?.getTime(),
      reason: ban.reason,
      operatorId: ban.operatorId,
      revokedAt: ban.revokedAt?.getTime(),
      revokedBy: ban.revokedBy,
    })),
  };
});
```

- [ ] **Step 2: Create POST bans endpoint**

Create `server/api/admin/users/[userId]/bans.post.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  if (!userId) {
    return { success: false, error: "缺少用户 ID" };
  }

  // Prevent self-ban
  if (userId === admin.userId) {
    return { success: false, error: "不能封禁自己" };
  }

  const body = (await readBody<{ end?: string; reason?: string }>(event)) ?? {};

  // Validate reason length
  if (body.reason && body.reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  // Validate and parse end date
  let endDate: Date | undefined;
  if (body.end) {
    endDate = new Date(body.end);
    if (isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    if (endDate <= new Date()) {
      return { success: false, error: "截止时间必须是未来时间" };
    }
  }

  const result = await addBan(
    userId,
    { end: endDate, reason: body.reason || undefined },
    admin.userId,
  );

  // Emit plugin hook on success
  if (result.success) {
    const target = await findUserByUuid(userId);
    if (target) {
      emitUserHook("user:banned", {
        uuid: target.uuid,
        email: target.email,
        gameId: target.gameId,
        timestamp: Date.now(),
        reason: body.reason || undefined,
        end: endDate?.getTime(),
        operator: admin.userId,
      });
    }
  }

  return result;
});
```

- [ ] **Step 3: Commit**

```bash
rtk git add server/api/admin/users/[userId]/bans.get.ts server/api/admin/users/[userId]/bans.post.ts
rtk git commit -m "feat(admin): add ban list and create ban API endpoints"
```

---

### Task 8: Implement ban edit, revoke, and delete APIs

**Files:**
- Create: `server/api/admin/users/[userId]/bans/[banId].patch.ts`
- Create: `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts`
- Create: `server/api/admin/users/[userId]/bans/[banId].delete.ts`

- [ ] **Step 1: Create PATCH endpoint (edit ban)**

Create `server/api/admin/users/[userId]/bans/[banId].patch.ts`:

```typescript
export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const body = (await readBody<{ end?: string | null; reason?: string }>(event)) ?? {};

  if (body.reason !== undefined && body.reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  let endDate: Date | null | undefined;
  if (body.end === null) {
    endDate = null; // make permanent
  } else if (body.end !== undefined) {
    endDate = new Date(body.end);
    if (isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    // No future-time check here: editing historical records may need past dates
  }

  const result = await editBan(userId, banId, {
    end: endDate,
    reason: body.reason,
  });

  return result;
});
```

- [ ] **Step 2: Create POST revoke endpoint**

Create `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await revokeBan(userId, banId, admin.userId);

  // Emit plugin hook on success
  if (result.success) {
    const target = await findUserByUuid(userId);
    if (target) {
      emitUserHook("user:unbanned", {
        uuid: target.uuid,
        email: target.email,
        gameId: target.gameId,
        timestamp: Date.now(),
        operator: admin.userId,
      });
    }
  }

  return result;
});
```

- [ ] **Step 3: Create DELETE endpoint with audit logging**

Create `server/api/admin/users/[userId]/bans/[banId].delete.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await removeBan(userId, banId);

  if (result.success) {
    // Audit log via evlog
    console.info("[ban-audit] Ban record removed", {
      operator: admin.userId,
      targetUser: userId,
      removedBan: {
        id: result.removed.id,
        start: result.removed.start,
        end: result.removed.end,
        reason: result.removed.reason,
        operatorId: result.removed.operatorId,
      },
    });
  }

  return { success: result.success, error: result.success ? undefined : result.error };
});
```

Note: If the project's evlog provides a structured logging API beyond `console.info`, use that instead. Check `server/utils/evlog*` for the actual API. The key requirement is that the deleted ban record snapshot is persisted in logs.

- [ ] **Step 4: Commit**

```bash
rtk git add server/api/admin/users/[userId]/bans/[banId].patch.ts server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts server/api/admin/users/[userId]/bans/[banId].delete.ts
rtk git commit -m "feat(admin): add ban edit, revoke, and delete API endpoints"
```

---

### Task 9: Create admin users page

**Files:**
- Create: `app/pages/admin/users.vue`

- [ ] **Step 1: Create the full page component**

Create `app/pages/admin/users.vue`:

```vue
<script setup lang="ts">
definePageMeta({ hideFooter: true });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

// Admin guard
watch(
  () => user.value,
  (u) => {
    if (!u || !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

interface UserItem {
  id: string;
  gameId: string;
  email: string;
  isAdmin: boolean;
  hasBan: boolean;
  registerAt: number;
}

const users = ref<UserItem[]>([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const filter = ref<"" | "banned" | "admin">("");

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

// Debounced search
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function onSearchInput(value: string) {
  search.value = value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    fetchUsers();
  }, 300);
}

function onFilterChange(value: string) {
  filter.value = value as typeof filter.value;
  page.value = 1;
  fetchUsers();
}

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  fetchUsers();
}

async function fetchUsers() {
  loading.value = true;
  try {
    const query: Record<string, string | number> = {
      page: page.value,
      pageSize: pageSize.value,
    };
    if (search.value) query.search = search.value;
    if (filter.value) query.filter = filter.value;

    const res = await $fetch<{
      success: boolean;
      users: UserItem[];
      total: number;
      page: number;
      pageSize: number;
    }>("/api/admin/users", { query });

    if (res.success) {
      users.value = res.users;
      total.value = res.total;
    }
  } catch {
    toast.error("加载用户列表失败");
  } finally {
    loading.value = false;
  }
}

onMounted(fetchUsers);

// Ban modal
const banModalRef = useTemplateRef<{ open: (userId: string, gameId: string) => void }>("banModalRef");

function openBanModal(userId: string) {
  const u = users.value.find((item) => item.id === userId);
  banModalRef.value?.open(userId, u?.gameId ?? "");
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Pagination display: show at most 5 page numbers around current page
const visiblePages = computed(() => {
  const pages: number[] = [];
  const total = totalPages.value;
  const current = page.value;
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});
</script>

<template>
  <div v-if="user?.isAdmin" class="flex flex-1 flex-col min-h-0 mx-0 md:mx-4">
    <div class="flex-1 border-x border-base-300 bg-base-200 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="p-4 border-b border-base-300 flex flex-col sm:flex-row gap-3 shrink-0">
        <h1 class="text-lg font-bold shrink-0">用户管理</h1>
        <div class="flex flex-1 gap-2">
          <input
            type="text"
            class="input input-sm input-bordered flex-1 min-w-0"
            placeholder="搜索用户名或邮箱..."
            :value="search"
            @input="onSearchInput(($event.target as HTMLInputElement).value)"
          >
          <select
            class="select select-sm select-bordered w-auto"
            :value="filter"
            @change="onFilterChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部状态</option>
            <option value="banned">封禁中</option>
            <option value="admin">管理员</option>
          </select>
        </div>
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        <!-- Loading -->
        <div v-if="loading" class="flex justify-center p-12">
          <span class="loading loading-spinner loading-md" />
        </div>

        <!-- Empty -->
        <div v-else-if="users.length === 0" class="flex justify-center p-12 text-base-content/40">
          暂无用户数据
        </div>

        <!-- User table -->
        <table v-else class="table table-sm w-full">
          <thead>
            <tr class="border-b border-base-300">
              <th class="font-semibold">用户名</th>
              <th class="font-semibold">邮箱</th>
              <th class="font-semibold hidden sm:table-cell">注册时间</th>
              <th class="font-semibold">状态</th>
              <th class="font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-b border-base-300/50 hover:bg-base-300/30">
              <td class="font-medium">{{ u.gameId }}</td>
              <td class="text-base-content/60 text-sm">{{ u.email }}</td>
              <td class="text-base-content/50 text-sm hidden sm:table-cell">{{ formatTime(u.registerAt) }}</td>
              <td>
                <span v-if="u.hasBan" class="badge badge-error badge-sm">封禁中</span>
                <span v-else-if="u.isAdmin" class="badge badge-info badge-sm">管理员</span>
                <span v-else class="badge badge-ghost badge-sm">正常</span>
              </td>
              <td class="text-right">
                <div class="dropdown dropdown-end">
                  <div tabindex="0" role="button" class="btn btn-ghost btn-xs">
                    <Icon name="hugeicons:more-vertical" class="text-base" />
                  </div>
                  <ul tabindex="0" class="dropdown-content z-10 menu menu-sm shadow-lg bg-base-100 border border-base-300 w-36">
                    <li><a @click="openBanModal(u.id)">封禁信息</a></li>
                  </ul>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="!loading && total > 0" class="p-3 border-t border-base-300 flex justify-between items-center text-sm shrink-0">
        <span class="text-base-content/50">共 {{ total }} 位用户</span>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-xs" :disabled="page <= 1" @click="goToPage(page - 1)">‹</button>
          <button
            v-for="p in visiblePages"
            :key="p"
            class="btn btn-xs"
            :class="p === page ? 'btn-active' : 'btn-ghost'"
            @click="goToPage(p)"
          >
            {{ p }}
          </button>
          <button class="btn btn-ghost btn-xs" :disabled="page >= totalPages" @click="goToPage(page + 1)">›</button>
        </div>
      </div>
    </div>

    <!-- Ban Modal -->
    <ClientOnly>
      <LazyAdminBanModal ref="banModalRef" @updated="fetchUsers" />
    </ClientOnly>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
rtk git add app/pages/admin/users.vue
rtk git commit -m "feat(admin): add user management page with table, search, filter, and pagination"
```

---

### Task 10: Create AdminBanModal component

**Files:**
- Create: `app/components/admin/BanModal.vue`

- [ ] **Step 1: Create the ban modal component**

Create `app/components/admin/BanModal.vue`:

```vue
<script setup lang="ts">
const emit = defineEmits<{ updated: [] }>();

const toast = useToast();
const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");

// State
const userId = ref("");
const gameId = ref("");
const bans = ref<BanItem[]>([]);
const loading = ref(false);
const actionLoading = ref<string | null>(null);

// New ban form
const newBanDuration = ref<"1d" | "7d" | "30d" | "permanent" | "custom">("7d");
const newBanCustomDate = ref("");
const newBanReason = ref("");
const creating = ref(false);

// Edit state
const editingBanId = ref<string | null>(null);
const editEnd = ref<string | null>(null);
const editEndCustom = ref("");
const editReason = ref("");
const editDuration = ref<"1d" | "7d" | "30d" | "permanent" | "custom">("custom");

// Remove confirm state
const confirmRemoveId = ref<string | null>(null);

interface BanItem {
  id: string;
  start: number;
  end?: number;
  reason?: string;
  operatorId: string;
  revokedAt?: number;
  revokedBy?: string;
}

function open(uid: string, gid: string) {
  userId.value = uid;
  gameId.value = gid;
  resetForm();
  dialogRef.value?.showModal();
  loadBans();
}

function resetForm() {
  newBanDuration.value = "7d";
  newBanCustomDate.value = "";
  newBanReason.value = "";
  editingBanId.value = null;
  confirmRemoveId.value = null;
}

defineExpose({ open });

// Helpers
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function banStatus(ban: BanItem): "active" | "revoked" | "expired" {
  if (ban.revokedAt) return "revoked";
  const now = Date.now();
  if (ban.start <= now && (!ban.end || ban.end > now)) return "active";
  return "expired";
}

function computeEndDate(duration: string): string | undefined {
  if (duration === "permanent") return undefined;
  const now = new Date();
  const ms = { "1d": 86400000, "7d": 604800000, "30d": 2592000000 }[duration];
  if (ms) return new Date(now.getTime() + ms).toISOString();
  return undefined;
}

// Load bans
async function loadBans() {
  loading.value = true;
  try {
    const res = await $fetch<{ success: boolean; bans: BanItem[] }>(
      `/api/admin/users/${userId.value}/bans`,
    );
    if (res.success) bans.value = res.bans;
  } catch {
    toast.error("加载封禁记录失败");
  } finally {
    loading.value = false;
  }
}

// Create ban
async function createBan() {
  creating.value = true;
  try {
    let end: string | undefined;
    if (newBanDuration.value === "custom") {
      if (!newBanCustomDate.value) {
        toast.error("请选择截止时间");
        return;
      }
      end = new Date(newBanCustomDate.value).toISOString();
    } else {
      end = computeEndDate(newBanDuration.value);
    }

    const res = await $fetch<{ success: boolean; error?: string }>(`/api/admin/users/${userId.value}/bans`, {
      method: "POST",
      body: { end, reason: newBanReason.value || undefined },
    });

    if (res.success) {
      toast.success("封禁成功");
      newBanReason.value = "";
      newBanDuration.value = "7d";
      newBanCustomDate.value = "";
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "封禁失败");
    }
  } catch {
    toast.error("封禁失败");
  } finally {
    creating.value = false;
  }
}

// Revoke ban
async function handleRevoke(banId: string) {
  actionLoading.value = banId;
  try {
    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/admin/users/${userId.value}/bans/${banId}/revoke`,
      { method: "POST" },
    );
    if (res.success) {
      toast.success("已撤销");
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "撤销失败");
    }
  } catch {
    toast.error("撤销失败");
  } finally {
    actionLoading.value = null;
  }
}

// Start editing
function startEdit(ban: BanItem) {
  editingBanId.value = ban.id;
  editReason.value = ban.reason ?? "";
  if (ban.end) {
    editDuration.value = "custom";
    // Format for datetime-local input
    const d = new Date(ban.end);
    editEndCustom.value = d.toISOString().slice(0, 16);
  } else {
    editDuration.value = "permanent";
    editEndCustom.value = "";
  }
}

function cancelEdit() {
  editingBanId.value = null;
}

// Save edit
async function saveEdit(banId: string) {
  actionLoading.value = banId;
  try {
    let end: string | null | undefined;
    if (editDuration.value === "permanent") {
      end = null;
    } else if (editDuration.value === "custom" && editEndCustom.value) {
      end = new Date(editEndCustom.value).toISOString();
    }

    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/admin/users/${userId.value}/bans/${banId}`,
      {
        method: "PATCH",
        body: { end, reason: editReason.value || undefined },
      },
    );

    if (res.success) {
      toast.success("已更新");
      editingBanId.value = null;
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "更新失败");
    }
  } catch {
    toast.error("更新失败");
  } finally {
    actionLoading.value = null;
  }
}

// Remove ban
async function handleRemove(banId: string) {
  if (confirmRemoveId.value !== banId) {
    confirmRemoveId.value = banId;
    return;
  }
  actionLoading.value = banId;
  try {
    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/admin/users/${userId.value}/bans/${banId}`,
      { method: "DELETE" },
    );
    if (res.success) {
      toast.success("已移除");
      confirmRemoveId.value = null;
      await loadBans();
      emit("updated");
    } else {
      toast.error(res.error ?? "移除失败");
    }
  } catch {
    toast.error("移除失败");
  } finally {
    actionLoading.value = null;
  }
}
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box max-w-xl">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">&#10005;</button>
          </form>

          <h3 class="text-lg font-bold">封禁管理 — {{ gameId }}</h3>

          <!-- New Ban Form -->
          <div class="mt-4 border border-base-300 p-4">
            <h4 class="text-sm font-semibold mb-3">新建封禁</h4>
            <div class="mb-3">
              <label class="text-xs text-base-content/50 block mb-1">封禁时长</label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="opt in [
                    { value: '1d', label: '1 天' },
                    { value: '7d', label: '7 天' },
                    { value: '30d', label: '30 天' },
                    { value: 'permanent', label: '永久' },
                    { value: 'custom', label: '自定义' },
                  ]"
                  :key="opt.value"
                  class="btn btn-xs"
                  :class="newBanDuration === opt.value ? 'btn-active' : 'btn-ghost'"
                  @click="newBanDuration = opt.value as typeof newBanDuration"
                >
                  {{ opt.label }}
                </button>
              </div>
              <input
                v-if="newBanDuration === 'custom'"
                v-model="newBanCustomDate"
                type="datetime-local"
                class="input input-sm input-bordered w-full mt-2"
              >
            </div>
            <div class="mb-3">
              <label class="text-xs text-base-content/50 block mb-1">封禁理由（可选）</label>
              <input
                v-model="newBanReason"
                type="text"
                class="input input-sm input-bordered w-full"
                placeholder="输入封禁理由..."
                maxlength="500"
              >
            </div>
            <div class="text-right">
              <button class="btn btn-sm btn-error" :disabled="creating" @click="createBan">
                <span v-if="creating" class="loading loading-spinner loading-xs" />
                确认封禁
              </button>
            </div>
          </div>

          <!-- Ban History -->
          <div class="mt-4">
            <h4 class="text-sm font-semibold mb-3">封禁历史</h4>

            <div v-if="loading" class="flex justify-center py-6">
              <span class="loading loading-spinner loading-sm" />
            </div>

            <div v-else-if="bans.length === 0" class="py-6 text-center text-sm text-base-content/40">
              暂无封禁记录
            </div>

            <div v-else class="flex flex-col gap-2 max-h-[40dvh] overflow-auto">
              <div
                v-for="ban in bans"
                :key="ban.id"
                class="border p-3"
                :class="banStatus(ban) === 'active' ? 'border-error/50 bg-error/5' : 'border-base-300 opacity-70'"
              >
                <!-- Display mode -->
                <template v-if="editingBanId !== ban.id">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <!-- Status badges -->
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span
                          v-if="banStatus(ban) === 'active'"
                          class="bg-error text-error-content px-2 py-0.5 text-[10px] font-semibold"
                        >
                          生效中
                        </span>
                        <span
                          v-else-if="banStatus(ban) === 'revoked'"
                          class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold"
                        >
                          已撤销
                        </span>
                        <span
                          v-else
                          class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold"
                        >
                          已过期
                        </span>
                        <span
                          v-if="!ban.end && banStatus(ban) !== 'revoked'"
                          class="bg-warning/20 text-warning px-2 py-0.5 text-[10px]"
                        >
                          永久
                        </span>
                      </div>

                      <!-- Time info -->
                      <div class="mt-1.5 text-xs text-base-content/50">
                        <div v-if="ban.revokedAt">
                          {{ formatTime(ban.start) }} → 撤销于 {{ formatTime(ban.revokedAt) }}
                        </div>
                        <div v-else-if="ban.end">
                          {{ formatTime(ban.start) }} ~ {{ formatTime(ban.end) }}
                        </div>
                        <div v-else>
                          {{ formatTime(ban.start) }} 起，永久
                        </div>
                      </div>

                      <!-- Reason -->
                      <div v-if="ban.reason" class="mt-1 text-xs">
                        <span class="text-base-content/40">理由：</span>{{ ban.reason }}
                      </div>

                      <!-- Operator -->
                      <div class="mt-1 text-[11px] text-base-content/30">
                        操作者：{{ ban.operatorId || '未知' }}
                        <template v-if="ban.revokedBy"> · 撤销者：{{ ban.revokedBy }}</template>
                      </div>
                    </div>

                    <!-- Action buttons -->
                    <div class="flex gap-1 shrink-0">
                      <button
                        v-if="banStatus(ban) === 'active'"
                        class="btn btn-ghost btn-xs"
                        :disabled="actionLoading === ban.id"
                        @click="handleRevoke(ban.id)"
                      >
                        撤销
                      </button>
                      <button
                        class="btn btn-ghost btn-xs"
                        :disabled="actionLoading === ban.id"
                        @click="startEdit(ban)"
                      >
                        编辑
                      </button>
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        :disabled="actionLoading === ban.id"
                        @click="handleRemove(ban.id)"
                      >
                        {{ confirmRemoveId === ban.id ? '确认？' : '移除' }}
                      </button>
                    </div>
                  </div>
                </template>

                <!-- Edit mode -->
                <template v-else>
                  <div class="flex flex-col gap-2">
                    <div>
                      <label class="text-xs text-base-content/50 block mb-1">截止时间</label>
                      <div class="flex flex-wrap gap-1.5">
                        <button
                          class="btn btn-xs"
                          :class="editDuration === 'permanent' ? 'btn-active' : 'btn-ghost'"
                          @click="editDuration = 'permanent'"
                        >
                          永久
                        </button>
                        <button
                          class="btn btn-xs"
                          :class="editDuration === 'custom' ? 'btn-active' : 'btn-ghost'"
                          @click="editDuration = 'custom'"
                        >
                          自定义
                        </button>
                      </div>
                      <input
                        v-if="editDuration === 'custom'"
                        v-model="editEndCustom"
                        type="datetime-local"
                        class="input input-sm input-bordered w-full mt-2"
                      >
                    </div>
                    <div>
                      <label class="text-xs text-base-content/50 block mb-1">理由</label>
                      <input
                        v-model="editReason"
                        type="text"
                        class="input input-sm input-bordered w-full"
                        maxlength="500"
                      >
                    </div>
                    <div class="flex justify-end gap-1">
                      <button class="btn btn-ghost btn-xs" @click="cancelEdit">取消</button>
                      <button
                        class="btn btn-primary btn-xs"
                        :disabled="actionLoading === ban.id"
                        @click="saveEdit(ban.id)"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>
</template>
```

- [ ] **Step 2: Commit**

```bash
rtk git add app/components/admin/BanModal.vue
rtk git commit -m "feat(admin): add ban detail modal with create, revoke, edit, and remove"
```

---

### Task 11: Update existing components

**Files:**
- Modify: `app/components/BanHistoryModal.vue`
- Modify: `app/components/AdminUserManageTab.vue`

- [ ] **Step 1: Update BanHistoryModal to support revokedAt**

In `app/components/BanHistoryModal.vue`, update the `ClientBanRecord` interface (lines 2-6) to add new fields:

```typescript
interface ClientBanRecord {
  id?: string;
  start: number;
  end?: number;
  reason?: string;
  operatorId?: string;
  revokedAt?: number;
}
```

Update the `isActive` function (lines 16-19) to account for revoked bans:

```typescript
function isActive(ban: ClientBanRecord): boolean {
  if (ban.revokedAt) return false;
  const now = Date.now();
  return ban.start <= now && (!ban.end || ban.end > now);
}
```

Add a `isRevoked` helper after `isPermanent`:

```typescript
function isRevoked(ban: ClientBanRecord): boolean {
  return !!ban.revokedAt;
}
```

In the template, update the status badge section (around lines 68-81) to add a "已撤销" state. Replace the `v-else` (已过期) condition block:

```vue
<span
  v-if="isActive(ban) && isPermanent(ban)"
  class="bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error"
>
  永久封禁
</span>
<span
  v-else-if="isActive(ban)"
  class="bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error"
>
  生效中
</span>
<span
  v-else-if="isRevoked(ban)"
  class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold opacity-50"
>
  已撤销
</span>
<span v-else class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold opacity-50">
  已过期
</span>
```

- [ ] **Step 2: Update AdminUserManageTab with link**

Replace `app/components/AdminUserManageTab.vue` content:

```vue
<template>
  <div class="flex flex-col items-center justify-center py-16 gap-3 text-base-content/40">
    <p>用户管理已移至独立页面</p>
    <NuxtLink to="/admin/users" class="btn btn-sm btn-ghost">
      前往用户管理
      <Icon name="hugeicons:arrow-right-01" class="text-base" />
    </NuxtLink>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
rtk git add app/components/BanHistoryModal.vue app/components/AdminUserManageTab.vue
rtk git commit -m "feat(ban): update BanHistoryModal for revokedAt and redirect AdminUserManageTab"
```

---

### Task 12: Run full test suite and verify build

- [ ] **Step 1: Run all tests**

Run: `rtk vitest run`
Expected: All tests pass, including new tests from Tasks 1-3.

- [ ] **Step 2: Verify production build**

Run: `rtk bun run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Run linter**

Run: `rtk bun run lint`
Expected: No lint errors in new/modified files.

- [ ] **Step 4: Final commit if any fixes needed**

If any test/build/lint issues were found and fixed:

```bash
rtk git add -A
rtk git commit -m "fix: resolve test/build/lint issues in user management feature"
```
