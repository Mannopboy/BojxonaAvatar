// Operator sozlamalari (klaviatura bilan, faqat shular): avatarni 4 yo'nalishga surish, zoom va suhbatni tugatish taymeri. Usul «AI maslahatchi» kiosk ilovasidagidek:
// faqat klaviatura, holat avtomatik saqlanadi (400 ms debounce), ochilganda birinchi kadrdan oldin tiklanadi, o'ng chetdagi panelda ko'rinadi.
// Spec: Obsidian vault «BojxonaAvatar / 08 - Frontend (Web) / 01 - Avatar surish va zoom», «03 - Suhbatni tugatish taymeri».
//
// X, Y — rig BALANDLIGINING ulushi (px emas): ekran o'lchami o'zgarsa yoki galogramma aylantirilsa ham nisbat buzilmaydi. Zoom — ko'paytiruvchi.
import { FRAME_H, FRAME_W } from "./avatarClips";

export interface AvatarView {
  x: number; // o'ngga +, chapga −  (rig balandligi ulushida)
  y: number; // pastga +, tepaga −
  zoom: number; // 1 = asl o'lcham
  endSec: number; // suhbatni tugatish taymeri: hech kim gapirmagan soniyalar (0 = o'chiq, faqat «Tugatish» tugmasi)
}

export const PAN_STEP = 0.02; // har bosishda rig balandligining 2%
export const ZOOM_STEP = 0.08; // har bosishda 8%
export const ZMIN = 0.4;
export const ZMAX = 2.5;
export const END_DEFAULT = 30;
export const END_MIN = 10;
export const END_MAX = 180;
export const END_STEP = 5;
export const DEFAULT_VIEW: AvatarView = { x: 0, y: 0, zoom: 1, endSec: END_DEFAULT };
export const STORAGE_KEY = "bojxona.avatarView.v1";
export const SAVE_DEBOUNCE_MS = 400;

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Surish chegarasi: avatar ekrandan butunlay chiqib ketmasin (rig ulushida). */
export const panLimit = (zoom: number) => 0.5 + zoom / 2;

/** Taymer qiymatini chegaraga keltiradi: 0 (o'chiq) yoki [END_MIN, END_MAX]. */
const clampEnd = (s: number) => (s <= 0 ? 0 : Math.round(clamp(s, END_MIN, END_MAX)));

/** Qiymatlarni chegaraga keltiradi (zoom [ZMIN, ZMAX], surish ±panLimit, taymer 0 yoki 10…180). */
export function clampView(v: AvatarView): AvatarView {
  const zoom = round4(clamp(v.zoom, ZMIN, ZMAX));
  const lim = panLimit(zoom);
  return { x: round4(clamp(v.x, -lim, lim)), y: round4(clamp(v.y, -lim, lim)), zoom, endSec: clampEnd(v.endSec) };
}

/** Surish: dx/dy ∈ {-1, 0, 1} (chap/o'ng, tepa/past) — har bosishda PAN_STEP. */
export function panView(v: AvatarView, dx: number, dy: number): AvatarView {
  return clampView({ ...v, x: v.x + dx * PAN_STEP, y: v.y + dy * PAN_STEP });
}

/** Zoom: dir = +1 yaqinlashtirish, −1 uzoqlashtirish (har bosishda ×(1 ± ZOOM_STEP)); zoom kichrayganda surish chegarasi ham toraygani uchun qayta tekshiriladi. */
export function zoomView(v: AvatarView, dir: 1 | -1): AvatarView {
  return clampView({ ...v, zoom: v.zoom * (1 + dir * ZOOM_STEP) });
}

/**
 * Suhbat taymeri: `]` +5 s, `[` −5 s; 10…180 s. Chegarada `[` bosilsa 10 → 0 (o'chiq), `]` bosilsa 0 → 10 (spec).
 */
export function endView(v: AvatarView, dir: 1 | -1): AvatarView {
  let e = v.endSec;
  if (dir > 0) e = e <= 0 ? END_MIN : Math.min(END_MAX, e + END_STEP);
  else e = e <= END_MIN ? 0 : e - END_STEP;
  return { ...v, endSec: e };
}

/** Panelda ko'rinadigan taymer qiymati. */
export const endLabel = (sec: number) => (sec <= 0 ? "o'chiq" : `${sec} s`);

/**
 * Saqlangan qiymatni o'qiydi va tekshiradi: JSON, v === 1, son va isFinite, chegaralar ichida — aks holda DEFAULT_VIEW
 * (buzuq qiymat yarim-yarmiga tuzatilmaydi: noma'lum holatdan asl joyga qaytish xavfsizroq). `endSec` yo'q (eski yozuv) → 30.
 */
export function parseView(raw: string | null | undefined): AvatarView {
  if (!raw) return { ...DEFAULT_VIEW };
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || o.v !== 1) return { ...DEFAULT_VIEW };
    const { x, y, zoom } = o;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return { ...DEFAULT_VIEW };
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return { ...DEFAULT_VIEW };
    if (zoom < ZMIN || zoom > ZMAX) return { ...DEFAULT_VIEW };
    const lim = panLimit(zoom);
    if (Math.abs(x) > lim || Math.abs(y) > lim) return { ...DEFAULT_VIEW };
    let endSec = END_DEFAULT;
    if (o.endSec !== undefined) {
      const e = o.endSec;
      if (typeof e !== "number" || !Number.isFinite(e) || !(e === 0 || (e >= END_MIN && e <= END_MAX))) return { ...DEFAULT_VIEW };
      endSec = e;
    }
    return { x, y, zoom, endSec };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

export const serializeView = (v: AvatarView): string => JSON.stringify({ v: 1, x: v.x, y: v.y, zoom: v.zoom, endSec: v.endSec });

/**
 * CSS transform: rig `left/top: 50%` bilan joylashgan, shuning uchun markazga -50%. translate foizi elementning O'Z o'lchamiga nisbatan
 * (X — kengligiga, Y — balandligiga); X rig BALANDLIGI ulushida saqlangani uchun kenglik ulushiga FRAME_H/FRAME_W ga ko'paytirib o'tkaziladi (nisbat doim 9:16).
 */
export function viewTransform(v: AvatarView): string {
  const px = round4(v.x * (FRAME_H / FRAME_W) * 100);
  const py = round4(v.y * 100);
  return `translate(calc(-50% + ${px}%), calc(-50% + ${py}%)) scale(${v.zoom})`;
}

export type ViewAction = { kind: "pan"; dx: number; dy: number } | { kind: "zoom"; dir: 1 | -1 } | { kind: "end"; dir: 1 | -1 };

/** Klavishni amalga aylantiradi; boshqa klavish, Ctrl/Cmd/Alt (brauzer zoomi, orqaga/oldinga) — null. Spec: boshqa klavish YO'Q. */
export function keyAction(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ViewAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case "ArrowLeft":
      return { kind: "pan", dx: -1, dy: 0 };
    case "ArrowRight":
      return { kind: "pan", dx: 1, dy: 0 };
    case "ArrowUp":
      return { kind: "pan", dx: 0, dy: -1 };
    case "ArrowDown":
      return { kind: "pan", dx: 0, dy: 1 };
    case "+":
    case "=":
      return { kind: "zoom", dir: 1 };
    case "-":
    case "_":
      return { kind: "zoom", dir: -1 };
    case "[":
      return { kind: "end", dir: -1 };
    case "]":
      return { kind: "end", dir: 1 };
  }
  if (e.code === "NumpadAdd") return { kind: "zoom", dir: 1 };
  if (e.code === "NumpadSubtract") return { kind: "zoom", dir: -1 };
  // o'zbekcha/ruscha klaviatura tartibida `[` `]` harf chiqaradi (х ъ) — jismoniy tugma bo'yicha ham ishlaydi
  if (e.code === "BracketLeft") return { kind: "end", dir: -1 };
  if (e.code === "BracketRight") return { kind: "end", dir: 1 };
  return null;
}

/** Fokus matn kiritishda bo'lsa klavishlar ushlanmaydi. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

export function applyAction(v: AvatarView, a: ViewAction): AvatarView {
  if (a.kind === "pan") return panView(v, a.dx, a.dy);
  if (a.kind === "zoom") return zoomView(v, a.dir);
  return endView(v, a.dir);
}
