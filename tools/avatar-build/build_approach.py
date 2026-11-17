"""approach.mp4 — WEB uchun: kutishda avatar ko'rinib turadi (biroz uzoqroqda va xira), suhbat boshlanganda 1-2 qadam oldinga yurib uy pozasiga keladi va yorug'lik tushadi.

  python build_approach.py idle=gen/idle_a.mp4:24:120 raw=<xom_arrive.mp4> site_idle=<frontend/public/avatar/idle.mp4> greeting=<frontend/public/avatar/greeting.mp4> \
         [out=<papka>] [scale=0.82] [dim=0.40] [light=1.1] [xf=5] [trim=3] [blend=8]

Xom material — arrive.mp4 uchun yaratilgan Higgsfield klipi (work/arrive/YARATISH.md): xodim uzoqdan yurib keladi. Bu skript uning OXIRGI qismini oladi:
xodim bo'yi uy kadridagining `scale` ulushiga (standart 0.82) yetgan kadrdan boshlab oxirigacha (~1.5 s) — ya'ni «ozgina uzoqroqdan oldinga yurib keladi».
  1. build_arrive.py zanjiri: oxirgi qimirlamaydigan kadrlar bo'yicha afin moslash, yorqinlik/tiniqlik kutish klipiga, oxirgi `blend` kadr greeting birinchi kadriga aralashadi.
  2. KUTISH KO'RINISHI (veb pleyerda CSS): kutish videosi (idle) shu klipning birinchi kadriga mos masshtab/joyda va `dim` yorqinlikda turadi: transform = translate(dx%, dy%) scale(s),
     filter = brightness(dim). Klipning birinchi kadri aynan shu ko'rinishdagi kutish kadri (almashuv sezilmaydi); birinchi `xf` kadrda yurish kadriga o'tadi.
  3. Yorug'lik: yorqinlik `dim` dan 1.0 gacha `light` soniyada ravon ko'tariladi («yorug'lik tushadi»).
Natija: <out>/approach.mp4, <out>/approach.json (+ frontend/src/approach.json ga ko'chiriladi: file, duration, far{scale,dxPct,dyPct,brightness}), <out>/approach_sheet.png.
"""
import json, os, sys
import cv2
import numpy as np
import align as A
import exits as E
import build_assets as B
import build_arrive as R

THR = 14


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def bbox(f):
    g = A.gray(f)
    ys, xs = np.where(g > THR)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def main():
    kv = dict(a.split("=", 1) for a in sys.argv[1:])
    pth, s, e = kv["idle"].rsplit(":", 2)
    out = kv.get("out", B.OUT)
    os.makedirs(out, exist_ok=True)
    S0, DIM, LIGHT_S = float(kv.get("scale", 0.82)), float(kv.get("dim", 0.40)), float(kv.get("light", 1.1))
    xf, trim, blend_n = int(kv.get("xf", 3)), int(kv.get("trim", 3)), int(kv.get("blend", 8))

    ctx = E.prepare(pth, int(s), int(e))
    idle_ref = B.load(pth, int(s), int(e))
    raw = B.load(kv["raw"])
    n = len(raw)
    g0 = [A.gray(f) for f in raw]
    p = A.fit(ctx["home"], ctx["ref"], g0, list(range(n - R.HOLD, n)))
    aff = [A.warp(f, p) for f in raw]
    tail = aff[-R.HOLD:]
    lut = R.tone_lut(tail, idle_ref)
    fr = R.apply_lut(aff, lut)
    amt, _dev = R.sharp_amount(R.apply_lut(tail, lut), idle_ref)
    fr = R.unsharp(fr, amt)
    if trim:
        fr = fr[:-trim]

    # uy kadridagi xodim chegarasi (kutish videosi, saytdagi haqiqiy fayl) va yurish kadrlari bo'yi
    site_idle = B.load(kv["site_idle"])
    hx0, hy0, hx1, hy1 = bbox(site_idle[0])
    H_home, xc_home = hy1 - hy0, (hx0 + hx1) / 2.0
    hs = [bbox(f)[3] - bbox(f)[1] for f in fr]
    k_t = next(i for i, h in enumerate(hs) if h >= S0 * H_home)
    h, w = fr[0].shape[:2]

    def align(k):
        """kutish kadrini (uy kadri) yurish kadri k ga bo'yi/tagi bo'yicha moslaydigan afin: p' = sc*p + d."""
        x0, y0, x1, y1 = bbox(fr[k])
        sc = (y1 - y0) / float(H_home)
        return sc, (x0 + x1) / 2.0 - sc * xc_home, y1 - sc * hy1

    # yurish boshlanadigan kadr: maqsadli masshtab atrofidan KUTISH KADRIGA eng o'xshash holatdagi (qo'l/oyoq) kadr — aralashishda «ikkilanish» bo'lmasin
    g_idle0 = A.gray(site_idle[0]).astype(np.float32)
    best = None
    for k in range(max(0, k_t - 6), min(len(fr) - 1, k_t + 6) + 1):
        sc_k, dx_k, dy_k = align(k)
        Mk = np.float32([[sc_k, 0, dx_k], [0, sc_k, dy_k]])
        gi = cv2.warpAffine(g_idle0, Mk, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)
        err = float(np.abs(gi - A.gray(fr[k]).astype(np.float32)).mean())
        if best is None or err < best[0]:
            best = (err, k)
    k0 = best[1]
    seg = fr[k0:]
    sc, dx, dy = align(k0)
    M = np.float32([[sc, 0, dx], [0, sc, dy]])
    print("boshlang'ich kadr tanlovi: maqsad k=%d, tanlandi k0=%d (kutish kadriga farq %.2f)" % (k_t, k0, best[0]))
    print("kutish ko'rinishi: masshtab %.3f  dx %.1f px  dy %.1f px  yorqinlik %.2f | yurish kadri k0=%d (bo'yi %d / %d), segment %d kadr = %.2f s" % (sc, dx, dy, DIM, k0, hs[k0], H_home, len(seg), len(seg) / 24.0))

    standby = lambda f: np.clip(cv2.warpAffine(f, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0).astype(np.float32) * DIM, 0, 255)
    light_n = max(1, int(round(LIGHT_S * 24)))
    frames = []
    for i, f in enumerate(seg):
        gain = DIM + (1.0 - DIM) * smooth(i / float(light_n))
        walk = np.clip(f.astype(np.float32) * gain, 0, 255)
        if i < xf:
            a = smooth(i / float(xf))
            st = standby(site_idle[i % len(site_idle)])
            walk = (1 - a) * st + a * walk
        frames.append(np.clip(walk, 0, 255).astype(np.uint8))

    if blend_n and "greeting" in kv:
        g_first = B.load(kv["greeting"], 0, 0)[0].astype(np.float32)
        for j in range(blend_n):
            a = smooth((j + 1) / float(blend_n))
            i = len(frames) - blend_n + j
            frames[i] = np.clip(frames[i].astype(np.float32) * (1 - a) + g_first * a, 0, 255).astype(np.uint8)

    dst = os.path.join(out, "approach.mp4")
    B.encode(frames, dst, crf="18")
    dec = B.load(dst)
    rep = {
        "file": "approach.mp4", "duration": round(len(dec) / 24.0, 3), "frames": len(dec), "bytes": os.path.getsize(dst),
        "far": {"scale": round(sc, 5), "dxPct": round(dx / w * 100, 4), "dyPct": round(dy / h * 100, 4), "brightness": DIM},
    }
    # tekshiruv: birinchi kadr = kutish ko'rinishi; oxirgi kadr = greeting birinchi kadri
    st0 = standby(site_idle[0]).astype(np.float32)
    rep["first_frame_vs_standby_mean_abs_diff"] = round(float(np.abs(A.gray(dec[0]).astype(np.float32) - A.gray(st0.astype(np.uint8)).astype(np.float32)).mean()), 3)
    if "greeting" in kv:
        nxt = B.load(kv["greeting"], 0, 12)
        rep["seam_to_greeting"] = R.seam(dec[-1], nxt)
    with open(os.path.join(out, "approach.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1, ensure_ascii=False)
    idx = sorted(set([0, 3, 6, 10, 15, 20, 26, len(dec) - 1]))
    tiles = []
    for i in idx:
        t = cv2.resize(dec[i], (270, 480))
        cv2.putText(t, str(i), (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        tiles.append(t)
    while len(tiles) % 4:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[k:k + 4]) for k in range(0, len(tiles), 4)]
    cv2.imwrite(os.path.join(out, "approach_sheet.png"), np.vstack(rows))
    print(json.dumps(rep, indent=1, ensure_ascii=False))
    print("yozildi:", dst)


if __name__ == "__main__":
    main()
