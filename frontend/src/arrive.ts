// Kirib kelish klipi (arrive.mp4): suhbat boshlanganda avatar qora fondan uzoqdan yurib keladi va uy pozasida to'xtaydi, so'ng salom (greeting).
// Kutish rejimida (suhbat yo'q) avatar KO'RINMAYDI — qora ekran (aks holda yurib kelish "sakrab" chiqardi). Klip yuklanmasa yoki ijro etilmasa — eski tartib:
// avatar kutish holatida ko'rinib turadi. `?arrive=0` — o'chirish (sinov / eski ko'rinish).
//
// Tartib: start() -> klip o'ynaydi (~3,9 s); shu vaqt ichida salom videosi, javob klipi va HAMMA ovoz kutadi (liveAudio holdUntil), tugagach salom videosi boshlanadi.
// Klipning oxirgi kadri salom videosining birinchi kadriga aynan teng (tools/avatar-build/build_arrive.py), shuning uchun almashuv sezilmaydi.

export const ARRIVE_FILE = "arrive.mp4";
/** Klip davomiyligi (soniya): metadata yuklanguncha taxmin; haqiqiysi video.duration. */
export const ARRIVE_FALLBACK_S = 3.92;
/** start() dan klipning birinchi kadri chizilguncha taxminiy kechikish (ms): to'siq shu qadar kengroq qo'yiladi, birinchi kadrdan keyin aniqlashtiriladi. */
export const ARRIVE_GUARD_MS = 150;
/** Klip ijro etilmasa shuncha ms dan keyin tashlab, eski tartibga qaytiladi. */
export const ARRIVE_START_TIMEOUT_MS = 1500;

/** Yurib kelish yoqilganmi (standart: ha; `?arrive=0` — yo'q). */
export const arriveEnabled = (search: string = typeof location === "undefined" ? "" : location.search): boolean => new URLSearchParams(search).get("arrive") !== "0";

/** Yurib kelish to'sig'i: shu payt (performance.now, ms) gacha salom videosi va ovoz kutadi; 0 — to'siq yo'q. */
export interface ArriveGate {
  endsAt: number;
}

/** To'siq tugashigacha qolgan soniya (kamida 0). */
export const gateRemainingS = (endsAtMs: number, nowMs: number): number => (endsAtMs > 0 ? Math.max(0, (endsAtMs - nowMs) / 1000) : 0);
