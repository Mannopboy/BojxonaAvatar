import { describe, expect, it } from "vitest";
import { FRAME_H, FRAME_W } from "./avatarClips";
import { DEFAULT_VIEW, PAN_STEP, STORAGE_KEY, ZMAX, ZMIN, ZOOM_STEP, applyAction, clampView, isTypingTarget, keyAction, panLimit, panView, parseView, serializeView, viewTransform, zoomView } from "./avatarView";

describe("surish", () => {
  it("har bosishda rig balandligining 2% i, to'rt yo'nalish", () => {
    expect(panView(DEFAULT_VIEW, 1, 0)).toEqual({ x: PAN_STEP, y: 0, zoom: 1 });
    expect(panView(DEFAULT_VIEW, -1, 0)).toEqual({ x: -PAN_STEP, y: 0, zoom: 1 });
    expect(panView(DEFAULT_VIEW, 0, -1)).toEqual({ x: 0, y: -PAN_STEP, zoom: 1 });
    expect(panView(DEFAULT_VIEW, 0, 1)).toEqual({ x: 0, y: PAN_STEP, zoom: 1 });
  });
  it("10 marta o'ngga, 10 marta chapga — aynan 0 ga qaytadi (suzuvchi nuqta xatosi yig'ilmaydi)", () => {
    let v = { ...DEFAULT_VIEW };
    for (let i = 0; i < 10; i++) v = panView(v, 1, 0);
    for (let i = 0; i < 10; i++) v = panView(v, -1, 0);
    expect(v.x).toBe(0);
  });
  it("chegaradan chiqmaydi: |x|, |y| <= 0.5 + zoom/2", () => {
    let v = { ...DEFAULT_VIEW };
    for (let i = 0; i < 500; i++) v = panView(panView(v, 1, 0), 0, -1);
    expect(v.x).toBe(panLimit(1));
    expect(v.y).toBe(-panLimit(1));
  });
});

describe("zoom", () => {
  it("har bosishda ×(1 ± 0.08)", () => {
    expect(zoomView(DEFAULT_VIEW, 1).zoom).toBeCloseTo(1 + ZOOM_STEP, 4);
    expect(zoomView(DEFAULT_VIEW, -1).zoom).toBeCloseTo(1 - ZOOM_STEP, 4);
  });
  it("min/max da to'xtaydi", () => {
    let v = { ...DEFAULT_VIEW };
    for (let i = 0; i < 100; i++) v = zoomView(v, 1);
    expect(v.zoom).toBe(ZMAX);
    for (let i = 0; i < 100; i++) v = zoomView(v, -1);
    expect(v.zoom).toBe(ZMIN);
  });
  it("uzoqlashtirganda surish chegarasi torayadi — avatar chegaradan tashqarida qolib ketmaydi", () => {
    let v = { x: 1.7, y: -1.7, zoom: ZMAX };
    for (let i = 0; i < 100; i++) v = zoomView(v, -1);
    expect(v.zoom).toBe(ZMIN);
    expect(Math.abs(v.x)).toBeLessThanOrEqual(panLimit(ZMIN));
    expect(Math.abs(v.y)).toBeLessThanOrEqual(panLimit(ZMIN));
  });
  it("clampView: zoom va surishni chegaraga keltiradi", () => {
    expect(clampView({ x: 99, y: -99, zoom: 99 })).toEqual({ x: panLimit(ZMAX), y: -panLimit(ZMAX), zoom: ZMAX });
    expect(clampView({ x: 0, y: 0, zoom: 0 }).zoom).toBe(ZMIN);
  });
});

describe("saqlangan qiymatni o'qish", () => {
  const d = DEFAULT_VIEW;
  it("yo'q / bo'sh / buzuq JSON → default", () => {
    for (const raw of [null, undefined, "", "abc", "{", "null", "[]", "42", '"x"', "NaN"]) expect(parseView(raw)).toEqual(d);
  });
  it("versiya mos emas yoki maydon son emas → default", () => {
    expect(parseView('{"v":2,"x":0,"y":0,"zoom":1}')).toEqual(d);
    expect(parseView('{"x":0,"y":0,"zoom":1}')).toEqual(d);
    expect(parseView('{"v":1,"x":"abc","y":0,"zoom":1}')).toEqual(d);
    expect(parseView('{"v":1,"x":0,"y":null,"zoom":1}')).toEqual(d);
    expect(parseView('{"v":1,"x":0,"y":0}')).toEqual(d);
  });
  it("cheksiz / chegaradan tashqari qiymat → default (yarim tuzatilmaydi)", () => {
    expect(parseView('{"v":1,"x":1e999,"y":0,"zoom":1}')).toEqual(d);
    expect(parseView('{"v":1,"x":0,"y":0,"zoom":0.1}')).toEqual(d);
    expect(parseView('{"v":1,"x":0,"y":0,"zoom":9}')).toEqual(d);
    expect(parseView('{"v":1,"x":3,"y":0,"zoom":1}')).toEqual(d);
  });
  it("to'g'ri qiymat saqlash → o'qish aylanasidan o'zgarmay o'tadi", () => {
    const v = { x: -0.14, y: 0.22, zoom: 1.2597 };
    expect(parseView(serializeView(v))).toEqual(v);
    expect(JSON.parse(serializeView(v))).toEqual({ v: 1, ...v });
  });
  it("kalit — spec bo'yicha", () => {
    expect(STORAGE_KEY).toBe("bojxona.avatarView.v1");
  });
});

describe("CSS transform", () => {
  it("default — hozirgi joylashuv bilan bir xil (markaz, masshtab 1)", () => {
    expect(viewTransform(DEFAULT_VIEW)).toBe("translate(calc(-50% + 0%), calc(-50% + 0%)) scale(1)");
  });
  it("X rig balandligi ulushida: kenglik foiziga FRAME_H/FRAME_W ga ko'paytirib o'tkaziladi", () => {
    const t = viewTransform({ x: 0.1, y: -0.05, zoom: 1.5 });
    expect(t).toContain(`calc(-50% + ${Math.round(0.1 * (FRAME_H / FRAME_W) * 100 * 10000) / 10000}%)`);
    expect(t).toContain("calc(-50% + -5%)");
    expect(t).toContain("scale(1.5)");
  });
});

describe("klavishlar", () => {
  it("strelkalar — surish", () => {
    expect(keyAction({ key: "ArrowLeft" })).toEqual({ kind: "pan", dx: -1, dy: 0 });
    expect(keyAction({ key: "ArrowRight" })).toEqual({ kind: "pan", dx: 1, dy: 0 });
    expect(keyAction({ key: "ArrowUp" })).toEqual({ kind: "pan", dx: 0, dy: -1 });
    expect(keyAction({ key: "ArrowDown" })).toEqual({ kind: "pan", dx: 0, dy: 1 });
  });
  it("+ = Numpad+ — yaqinlashtirish, − _ Numpad− — uzoqlashtirish", () => {
    for (const e of [{ key: "+" }, { key: "=" }, { key: "+", shiftKey: true }, { key: "Add", code: "NumpadAdd" }]) expect(keyAction(e)).toEqual({ kind: "zoom", dir: 1 });
    for (const e of [{ key: "-" }, { key: "_" }, { key: "Subtract", code: "NumpadSubtract" }]) expect(keyAction(e)).toEqual({ kind: "zoom", dir: -1 });
  });
  it("Ctrl / Cmd / Alt bilan ushlanmaydi (brauzer zoomi, orqaga/oldinga)", () => {
    expect(keyAction({ key: "+", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "-", metaKey: true })).toBeNull();
    expect(keyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
  });
  it("boshqa klavish yo'q: burish (W/S/A/D), R, bo'sh joy, Enter", () => {
    for (const key of ["w", "a", "s", "d", "r", "R", " ", "Enter", "Escape", "Tab", "0"]) expect(keyAction({ key })).toBeNull();
  });
  it("matn kiritishda ushlanmaydi", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
  it("applyAction: klavishdan holatga", () => {
    const a = keyAction({ key: "ArrowRight" })!;
    expect(applyAction(DEFAULT_VIEW, a).x).toBe(PAN_STEP);
    expect(applyAction(DEFAULT_VIEW, keyAction({ key: "=" })!).zoom).toBeCloseTo(1.08, 4);
  });
});
