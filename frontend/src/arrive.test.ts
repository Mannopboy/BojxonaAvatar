import { describe, expect, it } from "vitest";
import { ARRIVE_FALLBACK_S, ARRIVE_GUARD_MS, ARRIVE_START_TIMEOUT_MS, arriveEnabled, gateRemainingS } from "./arrive";

describe("arriveEnabled", () => {
  it("standart: yoqilgan", () => {
    expect(arriveEnabled("")).toBe(true);
    expect(arriveEnabled("?wake=1")).toBe(true);
    expect(arriveEnabled("?manual=1&x=2")).toBe(true);
  });
  it("?arrive=0 — o'chiq; boshqa qiymatlar yoqilgan", () => {
    expect(arriveEnabled("?arrive=0")).toBe(false);
    expect(arriveEnabled("?manual=1&arrive=0")).toBe(false);
    expect(arriveEnabled("?arrive=1")).toBe(true);
    expect(arriveEnabled("?arrive=")).toBe(true);
  });
});

describe("gateRemainingS", () => {
  it("to'siq yo'q (0) — kutish yo'q", () => {
    expect(gateRemainingS(0, 5000)).toBe(0);
    expect(gateRemainingS(-1, 5000)).toBe(0);
  });
  it("kelajakdagi payt — qolgan soniya", () => {
    expect(gateRemainingS(6000, 2500)).toBeCloseTo(3.5, 9);
    expect(gateRemainingS(1000.5, 1000)).toBeCloseTo(0.0005, 9);
  });
  it("o'tib ketgan payt — 0 (manfiy emas)", () => {
    expect(gateRemainingS(1000, 4000)).toBe(0);
    expect(gateRemainingS(1000, 1000)).toBe(0);
  });
});

describe("yurib kelish doimiylari", () => {
  it("klip davomiyligi ~4 s dan oshmaydi, oyna va taymaut mantiqiy", () => {
    expect(ARRIVE_FALLBACK_S).toBeGreaterThan(3);
    expect(ARRIVE_FALLBACK_S).toBeLessThanOrEqual(4.2);
    expect(ARRIVE_GUARD_MS).toBeGreaterThan(0);
    expect(ARRIVE_GUARD_MS).toBeLessThan(500);
    expect(ARRIVE_START_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });
});
