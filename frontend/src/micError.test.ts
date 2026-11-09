import { describe, expect, it } from "vitest";
import { micErrorMessage } from "./micError";

const err = (name: string, message = "xom brauzer xabari") => Object.assign(new Error(message), { name });

describe("micErrorMessage", () => {
  it("Firefox: mikrofon yo'q (NotFoundError) — xom xabar ko'rinmaydi", () => {
    const m = micErrorMessage(err("NotFoundError", "The object can not be found here."));
    expect(m).toContain("Mikrofon topilmadi");
    expect(m).not.toContain("object can not");
  });

  it("ruxsat berilmagan", () => {
    expect(micErrorMessage(err("NotAllowedError"))).toContain("ruxsat");
    expect(micErrorMessage(err("PermissionDeniedError"))).toContain("ruxsat");
  });

  it("mikrofon band", () => {
    expect(micErrorMessage(err("NotReadableError"))).toContain("band");
  });

  it("mediaDevices yo'q (TypeError) — HTTPS haqida", () => {
    expect(micErrorMessage(new TypeError("navigator.mediaDevices is undefined"))).toContain("HTTPS");
  });

  it("noma'lum xato va bo'sh qiymatlarda ham o'zbekcha xabar qaytaradi", () => {
    for (const v of [err("BoshqaXato"), null, undefined, "matn", 42]) {
      expect(micErrorMessage(v)).toContain("Mikrofon ochilmadi");
    }
  });
});
