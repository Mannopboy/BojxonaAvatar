import { describe, expect, it } from "vitest";
import { ASSET_V, SPEAKING_VARIANTS, assetUrl, nextExitDelay, pickVariant } from "./avatarClips";

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
    expect(nextExitDelay(exits, 5.5, 6)).toBeCloseTo(1.5);
    expect(nextExitDelay(exits, 13.5, 6)).toBe(0);
  });

  it("noma'lum davomiylik yoki oraliqsiz — kutmaydi", () => {
    expect(nextExitDelay(exits, 3, NaN)).toBe(0);
    expect(nextExitDelay([], 3, 6)).toBe(0);
  });
});

describe("pickVariant", () => {
  it("oldingisidan farqli tanlaydi va hammasini qamrab oladi", () => {
    const seen = new Set<number>();
    for (let avoid = 0; avoid < 5; avoid++) {
      for (let k = 0; k <= 100; k++) {
        const i = pickVariant(5, avoid, () => k / 100.0001);
        expect(i).not.toBe(avoid);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(5);
        seen.add(i);
      }
    }
    expect(seen.size).toBe(5);
  });

  it("bitta variant bo'lsa — doim 0; avoid yo'q bo'lsa — cheklovsiz", () => {
    expect(pickVariant(1, 0)).toBe(0);
    expect(pickVariant(3, -1, () => 0.99)).toBe(2);
    expect(pickVariant(3, -1, () => 0)).toBe(0);
  });
});

describe("haqiqiy gapirish variantlari", () => {
  it("kamida bitta variant bor, fayl nomlari noyob", () => {
    expect(SPEAKING_VARIANTS.length).toBeGreaterThan(0);
    expect(new Set(SPEAKING_VARIANTS.map((v) => v.file)).size).toBe(SPEAKING_VARIANTS.length);
  });

  it("har variantda o'tish oralig'i yetarli: eng uzog'i bilan 1.6 s kutiladi (yopiq lablarsiz o'tishdan kutish yaxshi; real klipda o'lchangan 1.46 s)", () => {
    for (const v of SPEAKING_VARIANTS) {
      let worst = 0;
      for (let t = 0; t < v.duration; t += 0.01) worst = Math.max(worst, nextExitDelay(v.exits, t, v.duration));
      expect(worst, v.file).toBeLessThanOrEqual(1.6);
    }
  });

  it("oraliqlar variant ichida va tartiblangan", () => {
    for (const v of SPEAKING_VARIANTS) {
      let prevEnd = -1;
      for (const [a, b] of v.exits) {
        expect(a).toBeGreaterThanOrEqual(prevEnd);
        expect(b).toBeGreaterThan(a);
        expect(b).toBeLessThanOrEqual(v.duration + 1e-6);
        prevEnd = b;
      }
    }
  });
});

describe("fayl manzili", () => {
  it("versiya bilan", () => {
    expect(assetUrl("idle.mp4")).toBe(`/avatar/idle.mp4?v=${ASSET_V}`);
  });
});
