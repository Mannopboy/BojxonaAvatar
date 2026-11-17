import { describe, expect, it } from "vitest";
import { ARRIVE_FALLBACK_S, ARRIVE_FILE, ARRIVE_GUARD_MS, ARRIVE_START_TIMEOUT_MS, FAR_LOOK, arriveEnabled, farStyle, gateRemainingS } from "./arrive";

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

describe("yaqinlashish klipi doimiylari (approach.json)", () => {
  it("klip qisqa (1–2.5 s): oldinga 1–2 qadam; oyna va taymaut mantiqiy", () => {
    expect(ARRIVE_FILE).toBe("approach.mp4");
    expect(ARRIVE_FALLBACK_S).toBeGreaterThan(1);
    expect(ARRIVE_FALLBACK_S).toBeLessThanOrEqual(2.5);
    expect(ARRIVE_GUARD_MS).toBeGreaterThan(0);
    expect(ARRIVE_GUARD_MS).toBeLessThan(500);
    expect(ARRIVE_START_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe("kutish ko'rinishi (FAR_LOOK)", () => {
  it("avatar yo'q bo'lib qolmaydi: biroz kichikroq (0.6–0.95) va xira (0.2–0.8), kadr ichida", () => {
    expect(FAR_LOOK.scale).toBeGreaterThan(0.6);
    expect(FAR_LOOK.scale).toBeLessThan(0.95);
    expect(FAR_LOOK.brightness).toBeGreaterThan(0.2);
    expect(FAR_LOOK.brightness).toBeLessThan(0.8);
    // kichraygan kadr (0..scale) siljish bilan kadr chegarasidan chiqmaydi
    expect(FAR_LOOK.dxPct).toBeGreaterThanOrEqual(0);
    expect(FAR_LOOK.dyPct).toBeGreaterThanOrEqual(0);
    expect(FAR_LOOK.dxPct + FAR_LOOK.scale * 100).toBeLessThanOrEqual(100.01);
    expect(FAR_LOOK.dyPct + FAR_LOOK.scale * 100).toBeLessThanOrEqual(100.01);
  });
  it("farStyle: CSS qatorlari (transform-origin 0 0 uchun)", () => {
    const s = farStyle({ scale: 0.8, dxPct: 10, dyPct: 12.5, brightness: 0.4 });
    expect(s.transform).toBe("translate(10%, 12.5%) scale(0.8)");
    expect(s.filter).toBe("brightness(0.4)");
    expect(farStyle().transform).toContain(String(FAR_LOOK.scale));
  });
});
