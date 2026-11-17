// Suhbat boshlanishi (web): avatar kutishda umuman yo'q bo'lib qolmaydi — BIROZ UZOQROQDA va XIRA turadi (jonli kutish videosi, CSS: kichikroq masshtab + pasaytirilgan yorqinlik);
// suhbat boshlanganda (salom tasdiqlangach) 1-2 qadam OLDINGA YURIB uy pozasiga keladi va unga YORUG'LIK TUSHADI (approach.mp4, ~1,4 s), so'ng salom (greeting).
// Klip yuklanmasa yoki ijro etilmasa — avatar CSS bilan silliq yaqinlashadi (oyoqsiz) va salom odatdagidek boshlanadi. `?arrive=0` — o'chirish (avatar doim uy pozasida, to'liq yorug').
//
// Tartib: salom tasdiqlandi -> klip o'ynaydi; shu vaqt ichida salom videosi, javob klipi va HAMMA ovoz kutadi (liveAudio holdUntil), tugagach salom videosi boshlanadi.
// Klipning birinchi kadri kutish ko'rinishiga, oxirgi kadri salom videosining birinchi kadriga aynan teng (tools/avatar-build/build_approach.py): almashuv sezilmaydi.
// Kiosk Windows ilovasi alohida klipdan (arrive.mp4: qora fondan uzoqdan yurib keladi) foydalanadi — u o'zgarmagan.
import approach from "./approach.json";

export const ARRIVE_FILE: string = approach.file;
/** Klip davomiyligi (soniya): metadata yuklanguncha taxmin; haqiqiysi video.duration. */
export const ARRIVE_FALLBACK_S: number = approach.duration;
/** start() dan klipning birinchi kadri chizilguncha taxminiy kechikish (ms): to'siq shu qadar kengroq qo'yiladi, birinchi kadrdan keyin aniqlashtiriladi. */
export const ARRIVE_GUARD_MS = 150;
/** Klip ijro etilmasa shuncha ms dan keyin tashlab, eski tartibga qaytiladi. */
export const ARRIVE_START_TIMEOUT_MS = 1500;

/**
 * KUTISH KO'RINISHI: jonli kutish videosi klipning birinchi kadriga mos keladi — masshtab `scale`, joyi (kadr o'lchamining foizi) dxPct/dyPct, yorqinlik `brightness`.
 * CSS: transform-origin 0 0; transform = translate(dxPct%, dyPct%) scale(scale); filter = brightness(brightness). Qiymatlar build_approach.py dan (approach.json).
 */
export interface FarLook {
  scale: number;
  dxPct: number;
  dyPct: number;
  brightness: number;
}
export const FAR_LOOK: FarLook = approach.far;

/** Kutish ko'rinishi uchun inline uslub (React style). */
export const farStyle = (f: FarLook = FAR_LOOK): { transform: string; filter: string } => ({
  transform: `translate(${f.dxPct}%, ${f.dyPct}%) scale(${f.scale})`,
  filter: `brightness(${f.brightness})`,
});

/** Yurib kelish yoqilganmi (standart: ha; `?arrive=0` — yo'q). */
export const arriveEnabled = (search: string = typeof location === "undefined" ? "" : location.search): boolean => new URLSearchParams(search).get("arrive") !== "0";

/** Yurib kelish to'sig'i: shu payt (performance.now, ms) gacha salom videosi va ovoz kutadi; 0 — to'siq yo'q. */
export interface ArriveGate {
  endsAt: number;
}

/** To'siq tugashigacha qolgan soniya (kamida 0). */
export const gateRemainingS = (endsAtMs: number, nowMs: number): number => (endsAtMs > 0 ? Math.max(0, (endsAtMs - nowMs) / 1000) : 0);
