// Avatar qatlamlari (rig) joylashuvi va boshning tabiiy harakati.
//
// Avatar BIR kadrli video emas, qatlamlar: qimirlamaydigan tana (base.jpg) + alohida BOSH qatlami (head.webp: furajka, soch,
// yuz, quloq) + yuz videolari (idle/speaking: faqat yuz qirqimi). Bosh pivot (bo'yin tagi) atrofida yengil aylantirilib siljitiladi,
// yuz videolari bosh bilan birga yuradi. Geometriya `scripts/build-avatar-clips.py` dagi HEAD_RECT/PIVOT/FACE_RECT bilan bir xil
// (public/avatar/rig.json ni avatarRig.test.ts solishtiradi).

/**
 * Avatar fayllari manzili. nginx /avatar/ ni keshlaydi: fayl nomi o'zgarmay mazmuni o'zgarsa (idle.mp4 avval to'liq kadr edi, endi
 * yuz qirqimi), kesh eski faylni yangi kod bilan aralashtirib yuborardi. Avatar fayllari qayta tayyorlanganda ASSET_V ni oshiring.
 */
export const ASSET_V = "3";
export const assetUrl = (file: string) => `/avatar/${file}?v=${ASSET_V}`;

export const FRAME_W = 1080;
export const FRAME_H = 1920;
export const HEAD_RECT = [340, 60, 740, 380] as const; // bosh qatlami (x0, y0, x1, y1), kadr pikselida
export const PIVOT = [540, 362] as const; // boshning burilish markazi (bo'yin tagi)
export const FACE_RECT = [420, 190, 660, 366] as const; // yuz videolari

/** Kadr pikselidan kadrga nisbatan foiz (CSS left/top/width/height uchun). */
export const pct = (v: number, total: number) => `${(v / total) * 100}%`;

export interface Pose {
  /** kadr pikselida (1080 kenglikda) siljish */
  dx: number;
  dy: number;
  /** burilish, daraja (soat mili bo'ylab +) */
  rot: number;
}

/**
 * Boshning tabiiy harakati. Bir-biriga karrali bo'lmagan davrli sinuslar yig'indisi: takrorlanish sezilmaydi, har doim silliq.
 *  - tinch holat: sekin, juda kichik tebranish (nafas, tik turgan odamning mayda siljishi);
 *  - gapirganda (speech 0..1): tezroq va kattaroq irg'ash, ozgina yon tomonga og'ish.
 * t — soniya, speech — gapirish zo'ri (0..1), calm — umumiy ko'paytirgich (salom paytida 0).
 */
export function headPose(t: number, speech: number, calm = 1): Pose {
  const s = Math.min(1, Math.max(0, speech));
  const rot = calm * (0.28 * Math.sin(0.89 * t + 0.6) + 0.16 * Math.sin(1.57 * t + 2.1) + s * (0.85 * Math.sin(3.9 * t + 1.3) + 0.45 * Math.sin(6.7 * t + 0.4)));
  const dx = calm * (1.1 * Math.sin(0.74 * t + 1.0) + s * 1.6 * Math.sin(3.1 * t + 2.2));
  const dy = calm * (0.6 * Math.sin(1.31 * t) + s * 1.5 * Math.sin(4.4 * t + 0.3));
  return { dx, dy, rot };
}

/**
 * Bir qutbli past chastotali filtr: qiymat `target` ga sekin yaqinlashadi. Ko'tarilganda `up`, tushganda `down` soniya
 * vaqt doimiysi bilan. dt — oldingi chaqiriqdan beri soniya.
 */
export function follow(value: number, target: number, dt: number, up: number, down: number): number {
  const tau = target > value ? up : down;
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}
