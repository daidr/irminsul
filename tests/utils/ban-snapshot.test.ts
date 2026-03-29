import { describe, it, expect } from "vitest";
import { toBanSnapshot } from "../../server/utils/ban-snapshot";

describe("toBanSnapshot", () => {
  it("converts all fields from BanRecord to BanSnapshot", () => {
    const ban = {
      id: "ban-1",
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-06-01T00:00:00Z"),
      reason: "违规行为",
      operatorId: "admin-1",
      revokedAt: new Date("2026-04-01T00:00:00Z"),
      revokedBy: "admin-2",
    };

    const snapshot = toBanSnapshot(ban);

    expect(snapshot).toEqual({
      start: new Date("2026-03-01T00:00:00Z").getTime(),
      end: new Date("2026-06-01T00:00:00Z").getTime(),
      reason: "违规行为",
      revokedAt: new Date("2026-04-01T00:00:00Z").getTime(),
      revokedBy: "admin-2",
    });
  });

  it("omits optional fields when not present", () => {
    const ban = {
      id: "ban-2",
      start: new Date("2026-03-01T00:00:00Z"),
      operatorId: "admin-1",
    };

    const snapshot = toBanSnapshot(ban);

    expect(snapshot).toEqual({
      start: new Date("2026-03-01T00:00:00Z").getTime(),
    });
    expect(snapshot).not.toHaveProperty("end");
    expect(snapshot).not.toHaveProperty("reason");
    expect(snapshot).not.toHaveProperty("revokedAt");
    expect(snapshot).not.toHaveProperty("revokedBy");
  });

  it("preserves empty string reason", () => {
    const ban = {
      id: "ban-3",
      start: new Date("2026-03-01T00:00:00Z"),
      reason: "",
      operatorId: "admin-1",
    };

    const snapshot = toBanSnapshot(ban);

    expect(snapshot).toHaveProperty("reason", "");
  });
});
