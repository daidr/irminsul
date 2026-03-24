import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../../server/utils/plugin/condition";

describe("evaluateCondition", () => {
  const config = { provider: "axiom", batchSize: 100, retryEnabled: true, name: "https://example.com" };

  describe("bare value (eq shorthand)", () => {
    it("matches equal value", () => {
      expect(evaluateCondition({ provider: "axiom" }, config)).toBe(true);
    });
    it("rejects unequal value", () => {
      expect(evaluateCondition({ provider: "custom" }, config)).toBe(false);
    });
  });

  describe("operators", () => {
    it("eq", () => expect(evaluateCondition({ provider: { eq: "axiom" } }, config)).toBe(true));
    it("neq", () => expect(evaluateCondition({ provider: { neq: "custom" } }, config)).toBe(true));
    it("in", () => expect(evaluateCondition({ provider: { in: ["axiom", "betterstack"] } }, config)).toBe(true));
    it("nin", () => expect(evaluateCondition({ provider: { nin: ["custom"] } }, config)).toBe(true));
    it("gt", () => expect(evaluateCondition({ batchSize: { gt: 50 } }, config)).toBe(true));
    it("gte", () => expect(evaluateCondition({ batchSize: { gte: 100 } }, config)).toBe(true));
    it("lt", () => expect(evaluateCondition({ batchSize: { lt: 200 } }, config)).toBe(true));
    it("lte", () => expect(evaluateCondition({ batchSize: { lte: 100 } }, config)).toBe(true));
    it("truthy true", () => expect(evaluateCondition({ retryEnabled: { truthy: true } }, config)).toBe(true));
    it("truthy false", () => expect(evaluateCondition({ retryEnabled: { truthy: false } }, config)).toBe(false));
    it("regex match", () => expect(evaluateCondition({ name: { regex: "^https?://" } }, config)).toBe(true));
    it("regex no match", () => expect(evaluateCondition({ name: { regex: "^ftp://" } }, config)).toBe(false));
  });

  describe("implicit AND (multiple fields)", () => {
    it("all match", () => {
      expect(evaluateCondition({ provider: "axiom", batchSize: { gt: 50 } }, config)).toBe(true);
    });
    it("one fails", () => {
      expect(evaluateCondition({ provider: "axiom", batchSize: { gt: 200 } }, config)).toBe(false);
    });
  });

  describe("$or", () => {
    it("one matches", () => {
      expect(evaluateCondition({ $or: [{ provider: "custom" }, { provider: "axiom" }] }, config)).toBe(true);
    });
    it("none match", () => {
      expect(evaluateCondition({ $or: [{ provider: "custom" }, { provider: "betterstack" }] }, config)).toBe(false);
    });
  });

  describe("$and", () => {
    it("all match", () => {
      expect(evaluateCondition({ $and: [{ provider: "axiom" }, { batchSize: { gte: 100 } }] }, config)).toBe(true);
    });
    it("one fails", () => {
      expect(evaluateCondition({ $and: [{ provider: "axiom" }, { batchSize: { gt: 200 } }] }, config)).toBe(false);
    });
  });

  describe("$not", () => {
    it("negates true to false", () => {
      expect(evaluateCondition({ $not: { provider: "axiom" } }, config)).toBe(false);
    });
    it("negates false to true", () => {
      expect(evaluateCondition({ $not: { provider: "custom" } }, config)).toBe(true);
    });
  });

  describe("nested", () => {
    it("$or with implicit AND branches", () => {
      expect(evaluateCondition({
        $or: [
          { provider: "axiom", batchSize: { gt: 50 } },
          { provider: "betterstack" },
        ],
      }, config)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("missing config key returns false", () => {
      expect(evaluateCondition({ unknownKey: "value" }, config)).toBe(false);
    });
    it("empty condition object returns true (vacuous truth)", () => {
      expect(evaluateCondition({}, config)).toBe(true);
    });
  });
});
