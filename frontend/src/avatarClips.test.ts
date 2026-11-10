import { describe, expect, it } from "vitest";
import { ASSET_V, GREETING_SPEECH_START_S, SPEAKING_VARIANTS, assetUrl, isHoldTime, nextExitDelay, pickTransition, pickVariant, planExit } from "./avatarClips";

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

  it("har variantda o'tish oralig'i yetarli: eng uzog'i bilan 2.0 s kutiladi (haqiqiy yopiq lablarsiz o'tishdan kutish yaxshi; real klipda o'lchangan 1.67 s; ovoz tugashi oldindan ma'lum bo'lsa tezlik sozlanadi)", () => {
    for (const v of SPEAKING_VARIANTS) {
      let worst = 0;
      for (let t = 0; t < v.duration; t += 0.01) worst = Math.max(worst, nextExitDelay(v.exits, t, v.duration));
      expect(worst, v.file).toBeLessThanOrEqual(2.0);
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

describe("salom", () => {
  it("og'iz boshlanadigan payt: manfiy emas va oqilona (salom videosi ~6-9 s)", () => {
    expect(GREETING_SPEECH_START_S).toBeGreaterThanOrEqual(0);
    expect(GREETING_SPEECH_START_S).toBeLessThan(3);
  });
});

describe("planExit (ovoz tugashiga to'g'rilash)", () => {
  const holds = [0.05, 1.1, 2.1, 3.1] as const;

  it("ovoz tugashiga mos yopiq kadrni tanlaydi (tezlik 0.7..1.4 ichida)", () => {
    const p = planExit(holds, 0.3, 1.0, 5); // 1.1 (dt 0.8 -> tezlik 0.8) yaroqli; 2.1 (dt 1.8) yaroqsiz
    expect(p).not.toBeNull();
    expect(p!.target).toBe(1.1);
    expect(p!.rate).toBeGreaterThanOrEqual(0.7);
    expect(p!.rate).toBeLessThanOrEqual(1.4);
  });

  it("tezligi 1 ga eng yaqin kadrni afzal ko'radi", () => {
    const p = planExit(holds, 1.3, 1.8, 5); // 2.1 (dt .8 -> .44 yaroqsiz), 3.1 (dt 1.8 -> 1.0)
    expect(p!.target).toBe(3.1);
    expect(p!.rate).toBeCloseTo(1, 1);
  });

  it("mos kadr yo'q / ovoz tugagan bo'lsa — null", () => {
    expect(planExit(holds, 1.3, 0.3, 5)).toBeNull();
    expect(planExit(holds, 0.3, 0, 5)).toBeNull();
    expect(planExit([], 0.3, 1, 5)).toBeNull();
  });

  it("klip tashqarisidagi kadrni tanlamaydi", () => {
    expect(planExit([5.5], 4.0, 1.5, 5)).toBeNull();
  });
});

describe("isHoldTime", () => {
  it("ushlab turish kadriga yaqin (±0.04 s) bo'lsa true", () => {
    expect(isHoldTime([1.0, 2.0], 1.03)).toBe(true);
    expect(isHoldTime([1.0, 2.0], 1.2)).toBe(false);
    expect(isHoldTime([], 1.0)).toBe(false);
  });
});

describe("pickTransition (kadr-mos almashinuv)", () => {
  it("noma'lum juftlik — null", () => {
    expect(pickTransition(99, 98, 1, 0.4, 1.6)).toBeNull();
  });

  it("topilsa — so'ralgan oraliqda, A va B boshqa variant", () => {
    const n = SPEAKING_VARIANTS.length;
    let found = 0;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (a === b) continue;
        const tr = pickTransition(a, b, 1.0, 0.45, 1.6);
        if (!tr) continue;
        found++;
        expect(tr.t).toBeGreaterThanOrEqual(1.45 - 1e-9);
        expect(tr.t).toBeLessThanOrEqual(2.6 + 1e-9);
        expect(tr.u).toBeGreaterThanOrEqual(0);
        expect(tr.u).toBeLessThan(SPEAKING_VARIANTS[b].duration);
        expect(tr.cost).toBeLessThanOrEqual(4.6);
      }
    }
    if (n > 1) expect(found).toBeGreaterThan(0); // hech bo'lmasa ba'zi juftliklarda mos (yopiq-og'iz) nuqta bor
  });
});
