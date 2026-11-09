import { describe, expect, it } from "vitest";
import rigRaw from "../public/avatar/rig.json?raw";
import { FACE_RECT, FRAME_H, FRAME_W, HEAD_RECT, PIVOT, follow, headPose } from "./avatarRig";

describe("headPose", () => {
  const samples = (speech: number, calm = 1) => Array.from({ length: 6000 }, (_, i) => headPose(i / 60, speech, calm));

  it("tinch holatda harakat juda kichik (qotib turmaydi, lekin sakramaydi)", () => {
    const s = samples(0);
    const maxRot = Math.max(...s.map((p) => Math.abs(p.rot)));
    expect(maxRot).toBeGreaterThan(0.1); // jonli
    expect(maxRot).toBeLessThan(0.5);
    expect(Math.max(...s.map((p) => Math.abs(p.dx)))).toBeLessThan(2.5);
  });

  it("gapirganda harakat kattaroq, lekin tabiiy chegarada (burilish < 2°, siljish < 6 px)", () => {
    const quiet = Math.max(...samples(0).map((p) => Math.abs(p.rot)));
    const talk = samples(1);
    const maxRot = Math.max(...talk.map((p) => Math.abs(p.rot)));
    expect(maxRot).toBeGreaterThan(quiet);
    expect(maxRot).toBeLessThan(2);
    expect(Math.max(...talk.map((p) => Math.hypot(p.dx, p.dy)))).toBeLessThan(6);
  });

  it("har doim silliq: kadrdan kadrga (60 Hz) sakrash yo'q", () => {
    const s = samples(1);
    for (let i = 1; i < s.length; i++) {
      expect(Math.abs(s[i].rot - s[i - 1].rot)).toBeLessThan(0.15); // daraja/kadr (≈ 9°/s dan sekin)
      expect(Math.hypot(s[i].dx - s[i - 1].dx, s[i].dy - s[i - 1].dy)).toBeLessThan(0.3); // px/kadr
    }
  });

  it("calm = 0 bo'lsa bosh aniq o'z joyida (salom paytida qatlamlarga tenglik)", () => {
    for (const p of samples(1, 0)) {
      expect(Math.abs(p.dx)).toBe(0);
      expect(Math.abs(p.dy)).toBe(0);
      expect(Math.abs(p.rot)).toBe(0);
    }
  });
});

describe("follow", () => {
  it("nishonga silliq yaqinlashadi va ortiq ketmaydi", () => {
    let v = 0;
    for (let i = 0; i < 600; i++) {
      const next = follow(v, 1, 1 / 60, 0.15, 0.45);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBeGreaterThan(0.99);
  });

  it("ko'tarilish va tushish turli tezlikda", () => {
    const up = follow(0, 1, 0.1, 0.1, 1.0);
    const down = follow(1, 0, 0.1, 0.1, 1.0);
    expect(up).toBeGreaterThan(1 - down); // tez ko'tariladi (up=0.1 s), sekin tushadi (down=1 s)
  });
});

describe("rig geometriyasi", () => {
  it("avatarRig.ts public/avatar/rig.json (build-avatar-clips.py natijasi) bilan bir xil", () => {
    const json = JSON.parse(rigRaw);
    expect(json.frame).toEqual([FRAME_W, FRAME_H]);
    expect(json.head).toEqual([...HEAD_RECT]);
    expect(json.pivot).toEqual([...PIVOT]);
    expect(json.face).toEqual([...FACE_RECT]);
  });

  it("yuz qirqimi bosh qatlami ichida, pivot esa bosh qatlami ichida", () => {
    const [hx0, hy0, hx1, hy1] = HEAD_RECT;
    const [fx0, fy0, fx1, fy1] = FACE_RECT;
    expect(fx0).toBeGreaterThanOrEqual(hx0);
    expect(fy0).toBeGreaterThanOrEqual(hy0);
    expect(fx1).toBeLessThanOrEqual(hx1);
    expect(fy1).toBeLessThanOrEqual(hy1);
    expect(PIVOT[0]).toBeGreaterThan(hx0);
    expect(PIVOT[0]).toBeLessThan(hx1);
    expect(PIVOT[1]).toBeGreaterThan(hy0);
    expect(PIVOT[1]).toBeLessThan(hy1);
  });
});
