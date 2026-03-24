import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../server/utils/plugin/ring-buffer";

describe("RingBuffer", () => {
  it("stores items up to capacity", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.size).toBe(3);
  });

  it("overwrites oldest when full", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.toArray()).toEqual([2, 3, 4]);
    expect(buf.size).toBe(3);
  });

  it("returns items in insertion order", () => {
    const buf = new RingBuffer<number>(5);
    for (let i = 0; i < 8; i++) buf.push(i);
    expect(buf.toArray()).toEqual([3, 4, 5, 6, 7]);
  });

  it("clear resets the buffer", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.toArray()).toEqual([]);
    expect(buf.size).toBe(0);
  });

  it("handles capacity of 1", () => {
    const buf = new RingBuffer<number>(1);
    buf.push(1);
    buf.push(2);
    expect(buf.toArray()).toEqual([2]);
  });

  it("filter returns matching items", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.filter((n) => n % 2 === 0)).toEqual([2, 4]);
  });
});
