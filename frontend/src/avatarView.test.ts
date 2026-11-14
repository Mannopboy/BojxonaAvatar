import { describe, expect, it } from "vitest";
import { FRAME_H, FRAME_W } from "./avatarClips";
import { DEFAULT_VIEW, END_DEFAULT, END_MAX, END_MIN, END_STEP, PAN_STEP, STORAGE_KEY, ZMAX, ZMIN, ZOOM_STEP, applyAction, clampView, endLabel, endView, isTypingTarget, keyAction, panLimit, panView, parseView, serializeView, viewTransform, zoomView } from "./avatarView";

describe("surish", () => {
  it("har bosishda rig balandligining 2% i, to'rt yo'nalish", () => {
    expect(panView(DEFAULT_VIEW, 1, 0)).toEqual({ ...DEFAULT_VIEW, x: PAN_STEP });
    expect(panView(DEFAULT_VIEW, -1, 0)).toEqual({ ...DEFAULT_VIEW, x: -PAN_STEP });
    expect(panView(DEFAULT_VIEW, 0, -1)).toEqual({ ...DEFAULT_VIEW, y: -PAN_STEP });
    expect(panView(DEFAULT_VIEW, 0, 1)).toEqual({ ...DEFAULT_VIEW, y: PAN_STEP });
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
  it("surish va zoom suhbat taymerini o'zgartirmaydi", () => {
    const v = { ...DEFAULT_VIEW, endSec: 75 };
    expect(panView(v, 1, 1).endSec).toBe(75);
    expect(zoomView(v, 1).endSec).toBe(75);
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
    let v = { ...DEFAULT_VIEW, x: 1.7, y: -1.7, zoom: ZMAX };
    for (let i = 0; i < 100; i++) v = zoomView(v, -1);
    expect(v.zoom).toBe(ZMIN);
    expect(Math.abs(v.x)).toBeLessThanOrEqual(panLimit(ZMIN));
    expect(Math.abs(v.y)).toBeLessThanOrEqual(panLimit(ZMIN));
  });
  it("clampView: zoom, surish va taymerni chegaraga keltiradi", () => {
    expect(clampView({ x: 99, y: -99, zoom: 99, endSec: 999 })).toEqual({ x: panLimit(ZMAX), y: -panLimit(ZMAX), zoom: ZMAX, endSec: END_MAX });
    expect(clampView({ x: 0, y: 0, zoom: 0, endSec: 3 }).zoom).toBe(ZMIN);
    expect(clampView({ ...DEFAULT_VIEW, endSec: 3 }).endSec).toBe(END_MIN);
    expect(clampView({ ...DEFAULT_VIEW, endSec: 0 }).endSec).toBe(0);
    expect(clampView({ ...DEFAULT_VIEW, endSec: -5 }).endSec).toBe(0);
  });
});

describe("suhbat taymeri sozlamasi", () => {
  it("standart 30 s", () => {
    expect(DEFAULT_VIEW.endSec).toBe(END_DEFAULT);
    expect(END_DEFAULT).toBe(30);
  });
  it("] +5 s, [ −5 s", () => {
    expect(endView(DEFAULT_VIEW, 1).endSec).toBe(30 + END_STEP);
    expect(endView(DEFAULT_VIEW, -1).endSec).toBe(30 - END_STEP);
  });
  it("chegara 10…180: 180 dan oshmaydi", () => {
    let v = { ...DEFAULT_VIEW };
    for (let i = 0; i < 100; i++) v = endView(v, 1);
    expect(v.endSec).toBe(END_MAX);
  });
  it("[ ni 10 da bosish → 0 (o'chiq), ] ni 0 da bosish → 10; 0 da [ hech narsani o'zgartirmaydi", () => {
    let v = { ...DEFAULT_VIEW, endSec: END_MIN };
    v = endView(v, -1);
    expect(v.endSec).toBe(0);
    expect(endView(v, -1).endSec).toBe(0);
    expect(endView(v, 1).endSec).toBe(END_MIN);
  });
  it("30 dan [ bilan pastga: 25, 20, 15, 10, o'chiq", () => {
    let v = { ...DEFAULT_VIEW };
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      v = endView(v, -1);
      seen.push(v.endSec);
    }
    expect(seen).toEqual([25, 20, 15, 10, 0]);
  });
  it("panel yozuvi", () => {
    expect(endLabel(30)).toBe("30 s");
    expect(endLabel(0)).toBe("o'chiq");
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
  it("eski yozuv (endSec yo'q) — surish/zoom saqlanadi, taymer 30", () => {
    expect(parseView('{"v":1,"x":0.1,"y":-0.2,"zoom":1.3}')).toEqual({ x: 0.1, y: -0.2, zoom: 1.3, endSec: 30 });
  });
  it("endSec: 0 (o'chiq) va 10…180 qabul qilinadi; boshqasi → butun yozuv default", () => {
    expect(parseView('{"v":1,"x":0,"y":0,"zoom":1,"endSec":0}').endSec).toBe(0);
    expect(parseView('{"v":1,"x":0,"y":0,"zoom":1,"endSec":10}').endSec).toBe(10);
    expect(parseView('{"v":1,"x":0,"y":0,"zoom":1,"endSec":180}').endSec).toBe(180);
    for (const bad of ['"abc"', "null", "5", "9", "181", "-1", "1e999", "[]"]) expect(parseView(`{"v":1,"x":0.1,"y":0,"zoom":1,"endSec":${bad}}`)).toEqual(d);
  });
  it("to'g'ri qiymat saqlash → o'qish aylanasidan o'zgarmay o'tadi", () => {
    const v = { x: -0.14, y: 0.22, zoom: 1.2597, endSec: 45 };
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
    const t = viewTransform({ x: 0.1, y: -0.05, zoom: 1.5, endSec: 30 });
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
  it("[ ] — suhbat taymeri (jismoniy tugma bo'yicha ham: o'zbekcha/ruscha tartibda harf chiqadi)", () => {
    expect(keyAction({ key: "[" })).toEqual({ kind: "end", dir: -1 });
    expect(keyAction({ key: "]" })).toEqual({ kind: "end", dir: 1 });
    expect(keyAction({ key: "х", code: "BracketLeft" })).toEqual({ kind: "end", dir: -1 });
    expect(keyAction({ key: "ъ", code: "BracketRight" })).toEqual({ kind: "end", dir: 1 });
  });
  it("Ctrl / Cmd / Alt bilan ushlanmaydi (brauzer zoomi, orqaga/oldinga)", () => {
    expect(keyAction({ key: "+", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "-", metaKey: true })).toBeNull();
    expect(keyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(keyAction({ key: "[", ctrlKey: true })).toBeNull();
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
    expect(applyAction(DEFAULT_VIEW, keyAction({ key: "ArrowRight" })!).x).toBe(PAN_STEP);
    expect(applyAction(DEFAULT_VIEW, keyAction({ key: "=" })!).zoom).toBeCloseTo(1.08, 4);
    expect(applyAction(DEFAULT_VIEW, keyAction({ key: "]" })!).endSec).toBe(35);
  });
});
