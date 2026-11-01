import { describe, expect, it } from "vitest";
import { FPS, SALUTE_FADE_IN, SALUTE_FADE_OUT, blinkValue, buildSpec, mouthLevel, saluteState } from "./timeline";

const SALUTE = 4.0; // modeldagi Salute klipi davomiyligi (s)
const levels = (name: "greeting" | "speaking" | "idle") => {
  const s = buildSpec(name, SALUTE);
  return { s, v: Array.from({ length: s.frames }, (_, i) => mouthLevel(s, i / FPS)) };
};

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

  it("speaking UZLUKSIZ gapiradi: videoda jumla pauzasi yo'q (jim paytni sayt idle bilan almashtiradi)", () => {
    const { s, v } = levels("speaking");
    expect(s.loop).toBe(true);
    expect(Math.max(...v)).toBeGreaterThan(0.3);
    expect(Math.max(...v)).toBeLessThanOrEqual(0.8);
    expect(v.filter((x) => x > 0.05).length / v.length).toBeGreaterThan(0.85); // deyarli doim og'iz harakatda
    // eng uzun jim stretch so'zlar orasidagi qisqa tushishdan oshmasin
    let run = 0, longest = 0;
    for (const x of v) { run = x <= 0.05 ? run + 1 : 0; longest = Math.max(longest, run); }
    expect(longest / FPS).toBeLessThan(0.25);
  });

  it("loop davriy: t va t+davr bir xil (takrorlanganda og'iz sakramaydi)", () => {
    for (const name of ["speaking", "idle"] as const) {
      const s = buildSpec(name, SALUTE);
      for (const t of [0, 0.37, 1.2, 4.0]) {
        expect(mouthLevel(s, t + s.duration)).toBeCloseTo(mouthLevel(s, t), 10);
        expect(blinkValue(s, t + s.duration)).toBeCloseTo(blinkValue(s, t), 10);
      }
    }
  });

  it("idle jim: og'iz doim yopiq", () => {
    expect(levels("idle").v.every((x) => x === 0)).toBe(true);
  });

  it("ko'z pirpirash klip ichida tugaydi (chok orqali o'tmaydi) va to'liq yumiladi", () => {
    for (const name of ["greeting", "speaking", "idle"] as const) {
      const s = buildSpec(name, SALUTE);
      for (const b of s.blinks) expect(b + 0.18).toBeLessThan(s.duration);
      expect(blinkValue(s, 0)).toBe(0);
      if (s.blinks.length) expect(blinkValue(s, s.blinks[0] + 0.08)).toBeCloseTo(1, 5);
    }
  });

  it("nafas fazasi: idle 1 davr, speaking 2 davr (loop uzunligi ≈ k·2π/1.4)", () => {
    const period = (2 * Math.PI) / 1.4;
    expect(Math.abs(buildSpec("idle", SALUTE).duration - period)).toBeLessThan(0.05);
    expect(Math.abs(buildSpec("speaking", SALUTE).duration - 2 * period)).toBeLessThan(0.05);
  });
});

describe("greeting — salom (haqiqiy Gemini ovozi bo'yicha)", () => {
  it("bir marta ijro etiladi; uzunligi Salute klipi + qisqa dum (kadrga yaxlitlangan)", () => {
    const { s } = levels("greeting");
    expect(s.loop).toBe(false);
    expect(s.duration).toBeGreaterThanOrEqual(SALUTE);
    expect(s.duration).toBeLessThan(SALUTE + 0.5);
  });

  it("og'iz haqiqiy ovoz egri chizig'idan: ovoz boshlanishidan oldin yopiq, keyin gapiradi, jumla orasida pauza bor", () => {
    const { s, v } = levels("greeting");
    expect(s.envelope).not.toBeNull();
    expect(mouthLevel(s, 0)).toBe(0);
    expect(Math.max(...v)).toBeGreaterThan(0.5);
    // «Assalomu alaykum» dan keyingi haqiqiy pauza (~2.0–2.3 s): og'iz shu paytda jim bo'lishi kerak
    const pause = v.slice(Math.round(2.08 * FPS), Math.round(2.28 * FPS));
    expect(Math.max(...pause)).toBeLessThan(0.1);
  });

  it("Salute vazni: 0 → 1 (fadeIn) → 1 → 0 (klip oxirida idle pozasi), vaqt klip oxirida qotadi", () => {
    expect(saluteState(0, SALUTE)).toEqual({ time: 0, weight: 0 });
    expect(saluteState(SALUTE_FADE_IN, SALUTE).weight).toBeCloseTo(1, 10);
    expect(saluteState(SALUTE - SALUTE_FADE_OUT, SALUTE).weight).toBeCloseTo(1, 10);
    expect(saluteState(SALUTE, SALUTE)).toEqual({ time: SALUTE, weight: 0 });
    expect(saluteState(100, SALUTE)).toEqual({ time: SALUTE, weight: 0 });
  });

  it("klip oxirida qo'l tushgan (idle/speaking boshiga ulanadi)", () => {
    const { s } = levels("greeting");
    expect(saluteState(s.duration - 1 / FPS, SALUTE).weight).toBe(0);
  });
});
