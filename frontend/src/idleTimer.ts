// Suhbatni tugatish taymeri (jimlik): hech kim gapirmagan vaqt endSec soniyaga yetsa suhbat CHIROYLI tugaydi — mikrofon yopiladi, javob (bo'lsa) oxirigacha aytiladi,
// keyin sessiya yopilib salom kutish rejimiga qaytiladi (AI maslahatchidagi beginGracefulFinish / finishAfterSpeech usuli; u yerda yakunlashni kamera boshlaydi,
// bu yerda kamera yo'q — jimlik taymeri). Sof holat mashinasi (DOM yo'q) — soxta vaqt bilan testlanadi (idleTimer.test.ts).
// Spec: vault «08 - Frontend (Web) / 03 - Suhbatni tugatish taymeri» (Q3 = A: taymer jimlikni sanaydi).

export const FINISH_GRACE_MS = 1200; // javob tugagach qo'shimcha kutish
export const FINISH_MAX_MS = 12000; // yakunlash eng ko'pi bilan shuncha davom etadi (qotib qolmasin)

export type IdleStep = "none" | "finish" | "stop";

export function createIdleTimer() {
  let last = 0;
  let finishing = false;
  let finishAt = 0;
  let quietSince: number | null = null;

  return {
    /** Suhbat boshlandi (yoki qayta boshlandi). */
    start(now: number) {
      last = now;
      finishing = false;
      quietSince = null;
    },
    /** Hodisa: yo'lovchi gapirdi yoki taymer sozlamasi o'zgardi — jimlik sanog'i qayta boshlanadi (yakunlash boshlangan bo'lsa — e'tiborsiz). */
    touch(now: number) {
      if (!finishing) last = now;
    },
    get finishing() {
      return finishing;
    },
    /**
     * Har ~0.5 s da chaqiriladi. busy — avatar gapiryapti / javob yo'lda (jimlik sanalmaydi). endSec — joriy sozlama (0 = o'chiq).
     * 'finish' — yakunlashni boshlang (mikrofonni yoping); 'stop' — endi sessiyani to'xtating; 'none' — hech narsa.
     */
    step(now: number, endSec: number, busy: boolean): IdleStep {
      if (!finishing) {
        if (busy) {
          last = now;
          return "none";
        }
        if (endSec > 0 && now - last >= endSec * 1000) {
          finishing = true;
          finishAt = now;
          quietSince = now;
          return "finish";
        }
        return "none";
      }
      if (busy) quietSince = null;
      else if (quietSince === null) quietSince = now;
      if ((quietSince !== null && now - quietSince >= FINISH_GRACE_MS) || now - finishAt >= FINISH_MAX_MS) return "stop";
      return "none";
    },
  };
}
