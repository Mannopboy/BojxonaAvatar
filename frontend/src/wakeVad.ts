// Kutish rejimi (standby) uchun mahalliy ovoz aniqlash: yo'lovchi avatar oldiga kelib gapirsa, BIRINCHI gap (salom yoki savol) ajratib olinadi va backendga yuboriladi.
// Server resursi sarflanmaydi (WebSocket ochilmaydi) — shovqinni ham backend LLM filtrlaydi (kind='other' → e'tiborsiz).
// Sof holat mashinasi (DOM yo'q) — testlanadi (wakeVad.test.ts). Mikrofon bilan ulash: wakeListener.ts.

export interface WakeVadParams {
  startRms: number; // shundan baland blok — ovoz boshlandi deb sanaladi (qurilma shovqin bostirgichi yoqilgan)
  startBlocks: number; // ketma-ket shuncha blok baland bo'lsa gap boshlandi (bitta chertish/shovqin gap emas)
  contRms: number; // gap davomida shundan baland bo'lsa — hali gapirilyapti
  hangS: number; // shuncha jim bo'lsa gap tugadi
  minVoicedS: number; // gapda eng kami shuncha ovozli vaqt bo'lmasa — tashlanadi
  maxS: number; // eng uzun gap (uzoq shovqin/suhbat cheksiz yig'ilmasin)
  preRollBlocks: number; // gap boshlanishidan oldingi bloklar (so'z boshi kesilmasin)
}

export const WAKE_PARAMS: WakeVadParams = { startRms: 0.03, startBlocks: 2, contRms: 0.012, hangS: 0.8, minVoicedS: 0.4, maxS: 8, preRollBlocks: 4 };

export function createWakeVad(p: WakeVadParams = WAKE_PARAMS) {
  let pre: Int16Array[] = [];
  let rec: Int16Array[] | null = null;
  let loud = 0;
  let voiced = 0;
  let silence = 0;
  let dur = 0;

  const reset = () => {
    pre = [];
    rec = null;
    loud = 0;
    voiced = 0;
    silence = 0;
    dur = 0;
  };

  return {
    /** Bitta blok: rms (0..1), blok uzunligi (s), 16 kHz PCM16. Gap tugasa — butun gap (Int16Array), aks holda null. */
    push(rms: number, blockS: number, pcm: Int16Array): Int16Array | null {
      if (!rec) {
        pre.push(pcm);
        if (pre.length > p.preRollBlocks + p.startBlocks) pre.shift();
        loud = rms > p.startRms ? loud + 1 : 0;
        if (loud >= p.startBlocks) {
          rec = pre.slice();
          pre = [];
          voiced = loud * blockS;
          silence = 0;
          dur = rec.length * blockS;
        }
        return null;
      }
      rec.push(pcm);
      dur += blockS;
      if (rms > p.contRms) {
        voiced += blockS;
        silence = 0;
      } else silence += blockS;
      if (silence < p.hangS && dur < p.maxS) return null;
      const out = voiced >= p.minVoicedS ? concat(rec) : null;
      reset();
      return out;
    },
    /** Yozilayotgan gap bormi (UI/test uchun). */
    get recording() {
      return rec !== null;
    },
    reset,
  };
}

export function concat(chunks: Int16Array[]): Int16Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
