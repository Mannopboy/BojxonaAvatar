// Yozib olish sahnasi va avatar o'rtasidagi umumiy holat (React'dan tashqarida — kadrma-kadr boshqarish uchun).
import type { ClipSpec } from "./timeline";

export const control: {
  spec: ClipSpec | null;
  /** Salute klipining davomiyligi (s) — model yuklangach to'ldiriladi */
  saluteDuration: number;
  /** model yuklangan va sahna tayyor */
  ready: boolean;
  /** og'iz yumshatish holati — klip boshida 0 ga tushiriladi */
  smooth: number;
  /** R3F `advance(t)` — frameloop="never" rejimida bitta kadrni t (soniya) vaqtida render qiladi */
  advance: ((t: number) => void) | null;
  canvas: HTMLCanvasElement | null;
  /** diagnostika: oxirgi kadrdagi qiymatlar va topilgan morphlar */
  debug: Record<string, unknown>;
} = {
  debug: {},
  spec: null,
  saluteDuration: 0,
  ready: false,
  smooth: 0,
  advance: null,
  canvas: null,
};
