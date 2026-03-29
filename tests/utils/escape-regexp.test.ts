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
    expect(escaped).toBe("\\(a\\+\\)\\+\\$");
    const re = new RegExp(escaped);
    expect(re.test("(a+)+$")).toBe(true);
    expect(re.test("aaa")).toBe(false);
  });
});
