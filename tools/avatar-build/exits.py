"""Klip tahlili: moslash (align.py) + chiqish nuqtalari (og'iz yopiq VA bosh uy o'rnida).

  python exits.py <idle.mp4> <idle_s> <idle_e> <clip.mp4> [<clip2.mp4> ...]   -> oxirgi qatorda JSON
"""
import json, sys
import cv2
import numpy as np
import align as A

MOUTH = (196, 236, 324, 396)
POSE_MAX = 2.5       # bosh o'rni kutish o'rnidan shuncha px dan kam farq qilsin
MOUTH_K = 1.45       # yopiq og'iz chegarasi = kutish klipi og'iz farqining p99 × MOUTH_K (kadrlarga qarab sozlangan: yopiq lablar <= ~11.5, tishlar ko'ringanda >= 12)


def load(path, lo=0, hi=None):
    c = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = c.read()
        if not ok:
            break
        out.append(f)
    return out[lo:(hi + 1 if hi is not None else None)], (c.get(5) or 24.0)


def mouth_patch(g, off):
    # kadrni bosh siljishiga teskari suradi (har kadrda kichik siljish), keyin og'iz hududini oladi
    m = np.float32([[1, 0, -off[0]], [0, 1, -off[1]]])
    s = cv2.warpAffine(g, m, (g.shape[1], g.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    y0, y1, x0, x1 = MOUTH
    return cv2.GaussianBlur(s[y0:y1, x0:x1].astype(np.float32), (0, 0), 1.5)


def main():
    idle_path, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    idle, _ = load(idle_path, s, e)
    ig = [A.gray(f) for f in idle]
    home = A.home_from_idle(ig)
    ref = {k: tuple(np.mean([A.region_offset(home, g, b) for g in ig[::4]], axis=0)) for k, b in A.REG.items()}
    cap = A.REG["cap"]
    cap_ref = np.array(ref["cap"][:2])
    io = [A.region_offset(home, g, cap)[:2] for g in ig]
    hm = np.mean([mouth_patch(g, o) for g, o in zip(ig, io)], axis=0)
    idle_md = np.array([np.abs(mouth_patch(g, o) - hm).mean() for g, o in zip(ig, io)])
    thr = float(np.percentile(idle_md, 99) * MOUTH_K)
    print(f"[uy] kutish: og'iz farqi p99 {np.percentile(idle_md, 99):.2f} -> yopiq chegara {thr:.2f}", file=sys.stderr)
    result = []
    for path in sys.argv[4:]:
        fr, fps = load(path)
        n = len(fr)
        g0 = [A.gray(f) for f in fr]
        p = A.fit(home, ref, g0, [0, n - 1])
        g = [A.gray(A.warp(f, p)) for f in fr]
        off = [A.region_offset(home, x, cap)[:2] for x in g]
        pose = np.array([np.hypot(*(np.array(o) - cap_ref)) for o in off])
        md = np.array([np.abs(mouth_patch(x, o) - hm).mean() for x, o in zip(g, off)])
        ok = (pose <= POSE_MAX) & (md <= thr)
        iv, a = [], None
        for i, v in enumerate(list(ok) + [False]):
            if v and a is None:
                a = i
            if not v and a is not None:
                iv.append([round(a / fps, 3), round(i / fps, 3)])
                a = None
        gaps, last = [], 0.0
        for a_, b_ in iv:
            gaps.append(a_ - last)
            last = b_
        gaps.append(n / fps - last)
        res_end = {k: tuple(round(v - ref[k][j], 1) for j, v in enumerate(A.region_offset(home, g[-1], b)[:2])) for k, b in A.REG.items()}
        print(f"{path}: {n} kadr, {n / fps:.2f} s | moslash ax={p['ax']:.2f} ay={p['ay']:.2f} by={p['by']:.4f} | uy kadriga mos: {int(ok.sum())}/{n} | bosh o'rni boshida {pose[0]:.2f}, oxirida {pose[-1]:.2f} px | og'iz boshida {md[0]:.1f}, oxirida {md[-1]:.1f} | eng uzun kutish {max(gaps):.2f} s | oraliqlar {len(iv)} | oxiri (qoldiq px) {res_end}", file=sys.stderr)
        result.append({"file": path.replace("\\", "/").split("/")[-1], "duration": round(n / fps, 3), "align": p, "exits": iv, "maxWait": round(max(gaps), 2), "poseStart": round(float(pose[0]), 2), "poseEnd": round(float(pose[-1]), 2), "mouthStart": round(float(md[0]), 1), "mouthEnd": round(float(md[-1]), 1), "thr": round(thr, 2), "ok": [int(v) for v in ok], "md": [round(float(v), 1) for v in md], "pose": [round(float(v), 2) for v in pose]})
    print(json.dumps(result))


main()
