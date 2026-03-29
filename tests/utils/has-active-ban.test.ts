import { describe, it, expect } from "vitest";
import { hasActiveBan } from "../../server/types/user.schema";

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
