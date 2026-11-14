import { describe, expect, it } from "vitest";
import { FINISH_GRACE_MS, FINISH_MAX_MS, createIdleTimer } from "./idleTimer";

/** soxta vaqt: har 500 ms da step; busyAt(t) — shu paytda band (avatar gapiryapti). Qaytaradi: [birinchi 'finish' vaqti, 'stop' vaqti]. */
function run(endSec: number, until: number, busyAt: (t: number) => boolean = () => false, touches: number[] = []) {
  const t = createIdleTimer();
  t.start(0);
  let finishAt: number | null = null;
  let stopAt: number | null = null;
  for (let now = 500; now <= until; now += 500) {
    if (touches.includes(now)) t.touch(now);
    const r = t.step(now, endSec, busyAt(now));
    if (r === "finish" && finishAt === null) finishAt = now;
    if (r === "stop") {
      stopAt = now;
      break;
    }
  }
  return { finishAt, stopAt };
}

describe("suhbatni tugatish taymeri", () => {
  it("jimlikda endSec dan keyin yakunlashni boshlaydi, +1.2 s dan keyin to'xtatadi", () => {
    const { finishAt, stopAt } = run(10, 60_000);
    expect(finishAt).toBe(10_000);
    expect(stopAt).toBe(10_000 + 1500); // 500 ms qadam: 1.2 s dan keyingi birinchi qadam
    expect(stopAt! - finishAt!).toBeGreaterThanOrEqual(FINISH_GRACE_MS);
  });

  it("endSec = 0 — taymer o'chiq: hech qachon tugatmaydi", () => {
    const { finishAt, stopAt } = run(0, 600_000);
    expect(finishAt).toBeNull();
    expect(stopAt).toBeNull();
  });

  it("avatar gapirayotganda jimlik sanalmaydi (gapirish tugagach qaytadan sanaladi)", () => {
    // avatar 0..20 s gapiradi, endSec = 10: yakunlash 20 + 10 = 30 s da
    const { finishAt } = run(10, 120_000, (t) => t <= 20_000);
    expect(finishAt).toBeGreaterThanOrEqual(30_000);
    expect(finishAt).toBeLessThanOrEqual(30_500);
  });

  it("yo'lovchi gapirsa (touch) sanoq qayta boshlanadi", () => {
    const { finishAt } = run(10, 120_000, () => false, [8_000]);
    expect(finishAt).toBe(18_000);
  });

  it("yakunlash davomida javob aytilayotgan bo'lsa — tugaguncha kutiladi, so'ng +1.2 s", () => {
    const t = createIdleTimer();
    t.start(0);
    expect(t.step(10_000, 10, false)).toBe("finish");
    expect(t.step(10_500, 10, true)).toBe("none"); // javob boshlandi
    expect(t.step(14_000, 10, true)).toBe("none");
    expect(t.step(15_000, 10, false)).toBe("none"); // javob tugadi, 1.2 s kutiladi
    expect(t.step(15_500, 10, false)).toBe("none");
    expect(t.step(16_300, 10, false)).toBe("stop");
  });

  it("yakunlash eng ko'pi bilan 12 s (qotib qolmasin)", () => {
    const t = createIdleTimer();
    t.start(0);
    expect(t.step(10_000, 10, false)).toBe("finish");
    for (let now = 10_500; now < 10_000 + FINISH_MAX_MS; now += 500) expect(t.step(now, 10, true)).toBe("none");
    expect(t.step(10_000 + FINISH_MAX_MS, 10, true)).toBe("stop");
  });

  it("yakunlash boshlangach touch e'tiborsiz (mikrofon yopiq), sozlama o'zgarsa ham to'xtamaydi", () => {
    const t = createIdleTimer();
    t.start(0);
    expect(t.step(10_000, 10, false)).toBe("finish");
    t.touch(10_100);
    expect(t.finishing).toBe(true);
    expect(t.step(11_500, 180, false)).toBe("stop");
  });

  it("sozlama yangi qiymat bilan darhol kuchga kiradi: qisqartirilsa (jimlik allaqachon uzoq bo'lsa) darrov yakunlaydi", () => {
    const t = createIdleTimer();
    t.start(0);
    expect(t.step(15_000, 60, false)).toBe("none");
    expect(t.step(15_500, 10, false)).toBe("finish");
  });

  it("qayta start() holatni tozalaydi", () => {
    const t = createIdleTimer();
    t.start(0);
    expect(t.step(10_000, 10, false)).toBe("finish");
    t.start(20_000);
    expect(t.finishing).toBe(false);
    expect(t.step(25_000, 10, false)).toBe("none");
  });
});
