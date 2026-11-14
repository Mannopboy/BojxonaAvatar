import { describe, expect, it } from "vitest";
import { WAKE_PARAMS, concat, createWakeVad } from "./wakeVad";

const BLOCK_S = 0.085;
const block = (v = 1) => new Int16Array(1360).fill(v); // ~85 ms @ 16 kHz
/** rms ketma-ketligini vad ga beradi; har bloklarning qiymati — tartib raqami (qaysi bloklar kirganini tekshirish uchun). Qaytaradi: [natija, indeks]. */
function run(rmsSeq: number[]) {
  const vad = createWakeVad();
  const outs: { at: number; pcm: Int16Array }[] = [];
  rmsSeq.forEach((rms, i) => {
    const r = vad.push(rms, BLOCK_S, block(i + 1));
    if (r) outs.push({ at: i, pcm: r });
  });
  return { outs, vad };
}
const rep = (rms: number, n: number) => Array(n).fill(rms);
const SPEECH = 0.08;
const SIL = 0.002;

describe("kutish rejimi: gap ajratish", () => {
  it("jimlik va past shovqin — hech narsa", () => {
    const { outs, vad } = run([...rep(SIL, 100), ...rep(0.02, 50)]); // 0.02 < startRms (0.03)
    expect(outs).toHaveLength(0);
    expect(vad.recording).toBe(false);
  });

  it("bitta baland blok (chertish) gap emas", () => {
    const { outs } = run([...rep(SIL, 20), SPEECH, ...rep(SIL, 40)]);
    expect(outs).toHaveLength(0);
  });

  it("oddiy gap: boshlanadi, 0.8 s jimlikdan keyin butun gap qaytadi", () => {
    const { outs } = run([...rep(SIL, 20), ...rep(SPEECH, 18), ...rep(SIL, 12)]); // ~1.5 s gap, so'ng 1 s jimlik
    expect(outs).toHaveLength(1);
    // gap ~18 ovozli blok + jimlik bloklari (hang) + pre-roll; hammasi 85 ms bloklardan iborat
    const blocks = outs[0].pcm.length / 1360;
    expect(blocks).toBeGreaterThanOrEqual(18 + 9);
    expect(blocks).toBeLessThanOrEqual(18 + 4 + 2 + 11);
  });

  it("gap boshi kesilmaydi: pre-roll bloklari qo'shiladi", () => {
    const { outs } = run([...rep(SIL, 20), ...rep(SPEECH, 12), ...rep(SIL, 12)]);
    const first = outs[0].pcm[0];
    // 21-blokdan (indeks 20) gap boshlanadi; startBlocks=2 + preRoll=4 → yozuv indeksi 20-4 = 16 dan, ya'ni qiymat ≥ 17 dan boshlanadi
    expect(first).toBeGreaterThanOrEqual(15);
    expect(first).toBeLessThanOrEqual(19);
  });

  it("gap ichidagi qisqa pauza (0.4 s) gapni uzmaydi", () => {
    const { outs } = run([...rep(SPEECH, 10), ...rep(SIL, 4), ...rep(SPEECH, 10), ...rep(SIL, 12)]);
    expect(outs).toHaveLength(1);
    expect(outs[0].pcm.length / 1360).toBeGreaterThanOrEqual(24);
  });

  it("ovozli vaqt minVoicedS dan kam bo'lsa tashlanadi", () => {
    // 2 blok (0.17 s) baland → boshlanadi, keyin jimlik: ovozli vaqt ~0.17 < 0.4
    const { outs } = run([...rep(SIL, 10), SPEECH, SPEECH, ...rep(SIL, 15)]);
    expect(outs).toHaveLength(0);
  });

  it("uzoq gap maxS da kesiladi va natija qaytadi", () => {
    const { outs } = run(rep(SPEECH, 140)); // 11.9 s uzluksiz ovoz
    expect(outs.length).toBeGreaterThanOrEqual(1);
    expect(outs[0].pcm.length / 1360 * BLOCK_S).toBeLessThanOrEqual(WAKE_PARAMS.maxS + 0.5);
  });

  it("natijadan keyin yangi gapni yana ushlaydi", () => {
    const { outs } = run([...rep(SPEECH, 12), ...rep(SIL, 15), ...rep(SIL, 20), ...rep(SPEECH, 12), ...rep(SIL, 15)]);
    expect(outs).toHaveLength(2);
  });

  it("concat bo'laklarni ketma-ket birlashtiradi", () => {
    expect(Array.from(concat([Int16Array.of(1, 2), Int16Array.of(3), new Int16Array(0), Int16Array.of(4, 5)]))).toEqual([1, 2, 3, 4, 5]);
  });
});
