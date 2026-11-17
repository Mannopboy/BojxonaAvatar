"""arrive.mp4 — avatar uzoqdan yurib keladi va uy kadrida to'xtaydi (kiosk kutish ekranidan keyin, salomdan oldin).

  python build_arrive.py idle=gen/idle_a.mp4:24:120 raw=<xom_arrive.mp4> [out=<papka>] [greeting=<greeting.mp4>] [fade=10] [trim=3] [blend=8]

Xom klip: Higgsfield, start_image = uzoqdagi kichik xodim (qora fonda), end_image = uy kadri, ovozsiz (work/arrive/YARATISH.md).
Qayta ishlash (answers/greeting bilan bir xil zanjir, faqat yurish qismi bosh qulflashsiz):
  1. Klip oxiridagi qimirlamaydigan kadrlar (uy pozasi) bo'yicha BITTA afin moslash (align.py) -> oxirgi kadr kutish klipining uy kadriga ustma-ust.
  2. Yorqinlik (gistogramma) va tiniqlik oxirgi kadrlar bo'yicha kutish klipiga moslanadi, butun klipga bir xil qo'llanadi.
  3. Oxirgi `trim` kadr olib tashlanadi (davomiylik <= 4 s); `greeting` berilsa oxirgi `blend` kadr uning birinchi kadriga silliq aralashadi
     (tikuvda sakrash yo'q); birinchi `fade` kadrda qoradan xira-kirish (birinchi kadr aniq qora).
  4. x264, 24 fps, 720x1280, ovozsiz. Tekshiruv: tikuv joyi (oxirgi kadr -> greeting birinchi kadri) farqi va bosh/tana siljishi.
Natija: <out>/arrive.mp4 + <out>/arrive_report.json
"""
import json, os, sys
import cv2
import numpy as np
import align as A
import exits as E
import build_assets as B

HOLD = 14   # moslash/o'lchash uchun oxirgi qimirlamaydigan kadrlar


def tone_lut(frames, ref_frames):
    """build_assets.tone_match bilan bir xil gistogramma moslash, lekin LUT qaytaradi (oxirgi kadrlardan olinib butun klipga qo'llanadi)."""
    def luma(fr):
        ys = np.concatenate([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[::2, ::2].ravel() for f in fr])
        return ys[ys > 20]
    a, b = luma(frames), luma(ref_frames[::4])
    ca = np.cumsum(np.bincount(a, minlength=256)) / len(a)
    cb = np.cumsum(np.bincount(b, minlength=256)) / len(b)
    lut = np.zeros(256, np.uint8)
    for v in range(256):
        lut[v] = int(np.searchsorted(cb, ca[v]).clip(0, 255)) if v > 20 else v
    for v in range(14, 31):
        t = (v - 14) / 16.0
        lut[v] = int(round((1 - t) * v + t * lut[v]))
    return lut


def apply_lut(frames, lut):
    out = []
    for f in frames:
        ycc = cv2.cvtColor(f, cv2.COLOR_BGR2YCrCb)
        ycc[..., 0] = cv2.LUT(ycc[..., 0], lut)
        out.append(cv2.cvtColor(ycc, cv2.COLOR_YCrCb2BGR))
    return out


def sharp_amount(frames, ref_frames):
    """build_assets.sharp_match bilan bir xil tanlov (uch hudud bo'yicha eng katta og'ish minimal), lekin miqdorni qaytaradi."""
    ref = {k: B._lapvar(ref_frames, b) for k, b in B.REGIONS.items()}
    blur = lambda f: cv2.GaussianBlur(f, (0, 0), 1.0)
    base = [f.astype(np.float32) for f in frames]
    soft = [blur(f).astype(np.float32) for f in frames]
    best = (9e9, 0.0, None)
    for amt in np.linspace(0.0, 0.5, 11):
        test = [np.clip(f + amt * (f - sb), 0, 255).astype(np.uint8) for f, sb in zip(base, soft)]
        dev = {k: B._lapvar(test, b) / ref[k] - 1 for k, b in B.REGIONS.items()}
        worst = max(abs(v) for v in dev.values())
        if worst < best[0]:
            best = (worst, float(amt), dev)
    return best[1], best[2]


def unsharp(frames, amt):
    if amt <= 0:
        return frames
    blur = lambda f: cv2.GaussianBlur(f, (0, 0), 1.0).astype(np.float32)
    return [np.clip(f.astype(np.float32) + amt * (f.astype(np.float32) - blur(f)), 0, 255).astype(np.uint8) for f in frames]


def fade_in(frames, n):
    out = []
    for i, f in enumerate(frames):
        if i < n:
            t = i / float(n)
            g = t * t * (3 - 2 * t)                     # smoothstep: kadr 0 = aniq qora
            f = np.clip(f.astype(np.float32) * g, 0, 255).astype(np.uint8)
        out.append(f)
    return out


def seam(last, nxt_frames):
    """Oxirgi kadr -> keyingi klip (greeting) birinchi kadri: hududlar bo'yicha siljish (px) va kulrang farq; asos — keyingi klipning o'z qo'shni kadrlari farqi."""
    g_last = A.gray(last)
    g_next = [A.gray(f) for f in nxt_frames]
    res = {"mean_abs_diff": round(float(np.abs(g_last.astype(np.float32) - g_next[0].astype(np.float32)).mean()), 3)}
    offs = {}
    for k, b in A.REG.items():
        dx, dy, mv = A.region_offset(g_next[0], g_last, b)
        offs[k] = [round(dx, 2), round(dy, 2), round(mv, 3)]
    res["region_offset_px(dx,dy,corr)"] = offs
    res["max_offset_px"] = round(max(float(np.hypot(v[0], v[1])) for v in offs.values()), 2)
    base = [float(np.abs(g_next[i].astype(np.float32) - g_next[i + 1].astype(np.float32)).mean()) for i in range(min(8, len(g_next) - 1))]
    res["next_clip_adjacent_diff_first8"] = [round(x, 3) for x in base]
    return res


def main():
    kv = dict(a.split("=", 1) for a in sys.argv[1:])
    pth, s, e = kv["idle"].rsplit(":", 2)
    out = kv.get("out", B.OUT)
    os.makedirs(out, exist_ok=True)
    fade_n, trim = int(kv.get("fade", 10)), int(kv.get("trim", 3))

    ctx = E.prepare(pth, int(s), int(e))
    idle_frames = B.load(pth, int(s), int(e))
    raw = B.load(kv["raw"])
    n = len(raw)
    picks = list(range(n - HOLD, n))
    g0 = [A.gray(f) for f in raw]
    p = A.fit(ctx["home"], ctx["ref"], g0, picks)
    print("afin moslash:", {k: round(v, 4) for k, v in p.items()})
    aff = [A.warp(f, p) for f in raw]

    rel, pose, md, ok = E.measure(ctx, [A.gray(f) for f in aff[-HOLD:]])
    print("oxirgi %d kadr: bosh o'rni (px) %s" % (HOLD, [round(float(x), 2) for x in pose]))

    tail = aff[-HOLD:]
    lut = tone_lut(tail, idle_frames)
    fr = apply_lut(aff, lut)
    amt, dev = sharp_amount(apply_lut(tail, lut), idle_frames)
    print("tiniqlik: unsharp %.2f; og'ish %s" % (amt, {k: "%+.0f%%" % (v * 100) for k, v in dev.items()}))
    fr = unsharp(fr, amt)
    if trim:
        fr = fr[:-trim]
    blend_n = int(kv.get("blend", 8)) if "greeting" in kv else 0
    if blend_n:
        # oxirgi `blend` kadr greeting birinchi kadriga silliq aralashadi: tikuv joyida bosh/tana sakramaydi (AI kadr va uy kadri tonlari 1-2 daraja farq qiladi)
        g_first = B.load(kv["greeting"], 0, 0)[0]
        for j in range(blend_n):
            t = (j + 1) / float(blend_n)
            a = t * t * (3 - 2 * t)
            i = len(fr) - blend_n + j
            fr[i] = np.clip(fr[i].astype(np.float32) * (1 - a) + g_first.astype(np.float32) * a, 0, 255).astype(np.uint8)
    fr = fade_in(fr, fade_n)

    dst = os.path.join(out, "arrive.mp4")
    B.encode(fr, dst, crf="18")
    size = os.path.getsize(dst)
    if size > 1_700_000:
        B.encode(fr, dst, crf="21")
        size = os.path.getsize(dst)

    # tekshiruv: kodlangan faylni qayta o'qib, tikuv joyini o'lchash
    dec = B.load(dst)
    rep = {"frames": len(dec), "duration_s": round(len(dec) / 24.0, 3), "bytes": size, "size": "%dx%d" % (dec[0].shape[1], dec[0].shape[0]),
           "first_frame_max_pixel": int(A.gray(dec[0]).max()), "fade_frames": fade_n, "trimmed_tail_frames": trim}
    _, pose2, md2, _ = E.measure(ctx, [A.gray(f) for f in dec[-6:]])
    rep["last6_head_pose_px"] = [round(float(x), 2) for x in pose2]
    rep["last_frame_vs_idle_home_mean_abs_diff"] = round(float(np.abs(A.gray(dec[-1]).astype(np.float32) - ctx["home"].astype(np.float32)).mean()), 3)
    if "greeting" in kv:
        nxt = B.load(kv["greeting"], 0, 12)
        rep["seam_to_greeting"] = seam(dec[-1], nxt)
    with open(os.path.join(out, "arrive_report.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1, ensure_ascii=False)
    print(json.dumps(rep, indent=1, ensure_ascii=False))
    print("yozildi:", dst)


if __name__ == "__main__":
    main()
