import { describe, expect, it } from "vitest";
import { ASSET_V, SPEAKING_EXITS, assetUrl, nextExitDelay } from "./avatarClips";

describe("nextExitDelay", () => {
  const exits = [
    [1, 2],
    [4, 5],
  ] as const;

  it("o'tish oralig'ida turgan bo'lsa — kutmaydi", () => {
    expect(nextExitDelay(exits, 1, 6)).toBe(0);
    expect(nextExitDelay(exits, 1.5, 6)).toBe(0);
    expect(nextExitDelay(exits, 4.9, 6)).toBe(0);
  });

  it("oraliqdan oldin — keyingi oraliq boshigacha", () => {
    expect(nextExitDelay(exits, 0.25, 6)).toBeCloseTo(0.75);
    expect(nextExitDelay(exits, 2, 6)).toBeCloseTo(2);
  });

  it("klip oxirida — takrorlanib, birinchi oraliq boshigacha", () => {
    expect(nextExitDelay(exits, 5.5, 6)).toBeCloseTo(1.5); // 0.5 s klip oxirigacha + 1 s
    expect(nextExitDelay(exits, 13.5, 6)).toBe(0); // 13.5 % 6 = 1.5 — birinchi oraliq ichida
  });

  it("noma'lum davomiylik yoki oraliqsiz — kutmaydi", () => {
    expect(nextExitDelay(exits, 3, NaN)).toBe(0);
    expect(nextExitDelay([], 3, 6)).toBe(0);
  });
});

describe("haqiqiy gapirish klipi", () => {
  const DURATION = 161 / 24; // speaking.mp4: xom 37–197 kadrlar, 24 kadr/s

  it("o'tish oralig'i yetarli: eng uzog'i bilan 1 s kutiladi (gapirish tugagach og'iz uzoq harakatlanmasin)", () => {
    let worst = 0;
    for (let t = 0; t < DURATION; t += 0.01) worst = Math.max(worst, nextExitDelay(SPEAKING_EXITS, t, DURATION));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("oraliqlar klip ichida va tartiblangan", () => {
    let prevEnd = -1;
    for (const [a, b] of SPEAKING_EXITS) {
      expect(a).toBeGreaterThanOrEqual(prevEnd);
      expect(b).toBeGreaterThan(a);
      expect(b).toBeLessThanOrEqual(DURATION + 1e-6);
      prevEnd = b;
    }
  });
});

describe("fayl manzili", () => {
  it("versiya bilan", () => {
    expect(assetUrl("idle.mp4")).toBe(`/avatar/idle.mp4?v=${ASSET_V}`);
  });
});
