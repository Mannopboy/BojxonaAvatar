import { describe, expect, it } from "vitest";
import { FPS, SALUTE_FADE_OUT, SALUTE_HOLD, blinkValue, buildSpec, mouthLevel, saluteState } from "./timeline";

const SALUTE = 4.0; // modeldagi Salute klipi davomiyligi (s)

describe("timeline — deterministik va takrorlanishga tayyor", () => {
  it("bir xil kirishga bir xil natija (seedli)", () => {
    expect(buildSpec("speaking", SALUTE)).toEqual(buildSpec("speaking", SALUTE));
    expect(buildSpec("greeting", SALUTE)).toEqual(buildSpec("greeting", SALUTE));
  });

  it("kadrlar soni = uzunlik × FPS (butun)", () => {
    for (const name of ["greeting", "speaking", "idle"] as const) {
      const s = buildSpec(name, SALUTE);
      expect(Number.isInteger(s.frames)).toBe(true);
      expect(s.frames).toBe(Math.round(s.duration * FPS));
    }
  });

  it("takrorlanadigan klipning boshi va oxirida og'iz yopiq (loop chokida sakrash bo'lmasin)", () => {
    for (const name of ["speaking", "idle"] as const) {
      const s = buildSpec(name, SALUTE);
      expect(s.loop).toBe(true);
      expect(mouthLevel(s, 0)).toBe(0);
      expect(mouthLevel(s, s.duration - 1 / FPS)).toBe(0);
    }
  });

  it("speaking haqiqatan gapiradi, idle esa jim", () => {
    const sp = buildSpec("speaking", SALUTE);
    const levels = Array.from({ length: sp.frames }, (_, i) => mouthLevel(sp, i / FPS));
    expect(Math.max(...levels)).toBeGreaterThan(0.3);
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.8);
    const idle = buildSpec("idle", SALUTE);
    expect(Array.from({ length: idle.frames }, (_, i) => mouthLevel(idle, i / FPS)).every((v) => v === 0)).toBe(true);
  });

  it("ko'z pirpirash klip ichida tugaydi (chok orqali o'tmaydi) va to'liq yumiladi", () => {
    for (const name of ["greeting", "speaking", "idle"] as const) {
      const s = buildSpec(name, SALUTE);
      for (const b of s.blinks) expect(b + 0.18).toBeLessThan(s.duration);
      expect(blinkValue(s, 0)).toBe(0);
      expect(blinkValue(s, s.duration - 1 / FPS)).toBe(0);
      if (s.blinks.length) expect(blinkValue(s, s.blinks[0] + 0.08)).toBeCloseTo(1, 5);
    }
  });

  it("nafas fazasi: idle 1 davr, speaking 2 davr (loop uzunligi ≈ k·2π/1.4)", () => {
    const period = (2 * Math.PI) / 1.4;
    const idle = buildSpec("idle", SALUTE);
    const speaking = buildSpec("speaking", SALUTE);
    expect(Math.abs(idle.duration - period)).toBeLessThan(0.05);
    expect(Math.abs(speaking.duration - 2 * period)).toBeLessThan(0.05);
  });
});

describe("greeting — salom", () => {
  it("salom klipi uzunligi: Salute + ushlab turish + fadeOut + dum, kadrga yaxlitlangan", () => {
    const g = buildSpec("greeting", SALUTE);
    expect(g.loop).toBe(false);
    expect(g.duration).toBeGreaterThanOrEqual(SALUTE + SALUTE_HOLD + SALUTE_FADE_OUT);
    expect(g.duration).toBeLessThan(SALUTE + SALUTE_HOLD + SALUTE_FADE_OUT + 0.5);
  });

  it("oxirida og'iz yopiq va qo'l tushgan (idle/speaking boshiga ulanadi)", () => {
    const g = buildSpec("greeting", SALUTE);
    expect(mouthLevel(g, g.duration - 1 / FPS)).toBe(0);
    expect(saluteState(g.duration - 1 / FPS, SALUTE).weight).toBe(0);
  });

  it("Salute vazni: 0 → 1 (fadeIn) → ushlab turish → 0 (fadeOut), vaqt klip oxirida qotadi", () => {
    expect(saluteState(0, SALUTE)).toEqual({ time: 0, weight: 0 });
    expect(saluteState(0.2, SALUTE).weight).toBe(1);
    expect(saluteState(SALUTE + SALUTE_HOLD, SALUTE)).toEqual({ time: SALUTE, weight: 1 });
    expect(saluteState(SALUTE + SALUTE_HOLD + SALUTE_FADE_OUT, SALUTE).weight).toBe(0);
    expect(saluteState(100, SALUTE).time).toBe(SALUTE);
  });
});
