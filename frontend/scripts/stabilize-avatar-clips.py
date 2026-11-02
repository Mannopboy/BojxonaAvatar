#!/usr/bin/env python3
"""Xom avatar kliplarini bitta "qotirilgan" holatga keltiradi: kliplar orasidagi almashish bitta 3D model kabi sezilmasin.

AI video xizmati har klipni alohida yaratadi: bosh va tana sekin siljiydi (kutish klipida gapirishdagidan ~2 baravar ko'p),
rang berilishi (ayniqsa yuz yorqinligi) klipdan klipga farq qiladi. Kliplar almashganda bu "sakrash" va rang o'zgarishi
bo'lib ko'rinadi. Bu vosita har kadrni asl start kadrga (reference) moslaydi:

  1. HOLAT: har kadr uchun bosh (furajkadan iyakkacha) va tananing (ko'krak) siljishi reference'ga nisbatan optik oqimning
     MEDIANASI bilan o'lchanadi (og'iz/ko'z kabi kichik mahalliy o'zgarish medianaga ta'sir qilmaydi), vaqt bo'yicha tekislanadi
     va bekor qilinadi. Qancha harakat QOLISHI bosh uchun `--keep`, tana uchun `--body-keep` bilan beriladi (0 = qotgan,
     1 = o'zgarishsiz). Ko'z qisish va og'iz harakati saqlanadi.
  2. RANG: start/oxirgi kadrlar (holati asl kadrga teng) asl kadr bilan solishtirilib, sekin o'zgaradigan rang-yorqinlik
     xaritasi (yuz yorqinroq, ko'ylak ko'kroq...) topiladi va butun klipga qo'llanadi. Tafsilotlar o'zgarmaydi.
  3. STATIK TANA: bo'yindan pastdagi tana kliplarda start kadrning o'zi bilan almashtiriladi (idle, speaking — butun klip
     bo'yicha; greeting — faqat boshi va oxirida). Kiyim teksturasi klipdan klipga farq qilmaydi, almashishda faqat bosh
     (og'iz, ko'z) o'zgaradi. `--no-static-body` bilan o'chiriladi.

Natija `<chiqish>/<nom>_raw.mp4` (deyarli yo'qotishsiz) — keyin `npm run process:avatar` shu papkada ishlaydi.

  python scripts/stabilize-avatar-clips.py <xom-papka> <reference.png> [chiqish-papka] [--keep=idle=0.12,...] [--body-keep=idle=0.03,...] [--only=speaking] [--dry] [--no-static-body]

Kerak: python3, numpy, opencv-python; ffmpeg (PATH'da yoki FFMPEG_PATH). Kadr o'lchami 720x1280 deb olinadi.
"""
import os
import shutil
import subprocess
import sys
from collections import deque

import cv2
import numpy as np

FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"
W, H, SC = 720, 1280, 0.5          # kadr; ECC kichraytirilgan kadrda hisoblanadi
# Qolgan harakat ulushi (0 = qotgan, 1 = o'zgarishsiz). Bosh ham, tana ham deyarli qotiriladi — kliplar almashganda 1–2 px
# siljish ham "sakrash" bo'lib ko'rinadi (furajka chetida ikki konturga o'xshaydi); faqat og'iz va ko'z o'zgaradi.
# Salomda qo'l harakati saqlanishi kerak.
KEEP = {"idle": 0.05, "speaking": 0.10, "greeting": 0.50}
BODY_KEEP = {"idle": 0.03, "speaking": 0.03, "greeting": 0.40}
# Bo'yindan pastdagi TANA hamma holatda BIR XIL statik rasm (start kadr): har klip alohida AI render qilingani uchun kiyim
# teksturasi klipdan klipga ozgina farq qiladi va almashishda mayda miltillash bo'lib ko'rinadi (ayniqsa katta ekranda).
# Faqat bosh (og'iz, ko'z) videodan olinadi. "full" — har kadrda; "edges" — klipning boshi/oxirida (salomda qo'l harakati
# saqlanadi, lekin kutishga ulanadigan joyda tana piksel-piksel bir xil); None — o'chirilgan.
STATIC_BODY = {"idle": "full", "speaking": "full", "greeting": "edges"}
EDGE_FRAMES = 10
HEAD_BOX = (0.045, 0.19, 0.40, 0.60)   # (qator0, qator1, ustun0, ustun1) kadr ulushida: furajkadan iyakkacha (og'iz medianaga ta'sir qilmaydi)
BODY_BOX = (0.27, 0.50, 0.38, 0.62)    # ko'krak: tugmalar, yoqa, galstuk (qo'llar YO'Q — salomda qo'l harakatlanadi)
NECK = (0.17, 0.25)                    # bosh siljishi shu oraliqda tana siljishiga o'tadi
LIMIT_PX, LIMIT_RAD = 15.0, 0.04       # AI klipdagi haqiqiy siljish bundan kichik; kattasi — ECC xatosi
SIGMA_T = 1.2                          # siljish parametrlarini vaqt bo'yicha tekislash (kadr)
SIGMA_COLOR = 25                       # rang xaritasi qanchalik "sekin" (px): tafsilot emas, yorug'lik
EDGE = 6                               # rang o'lchanadigan boshi/oxiri kadrlar soni (holati asl kadrga teng)


def probe_fps(path):
    info = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    import re
    m = re.search(r", ([\d.]+) fps", info)
    return float(m.group(1)) if m else 24.0


def read_frames(path):
    """BT.709 bilan BGR kadrlar (brauzer va process-avatar-clips.mjs bilan bir xil rang matritsasi)."""
    p = subprocess.Popen(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-vf",
         "scale=in_range=tv:in_color_matrix=bt709:out_range=pc,format=bgr24", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    p.stdout.close()
    p.wait()


class Writer:
    def __init__(self, path, fps):
        self.p = subprocess.Popen(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
             "-r", str(fps), "-i", "-", "-vf", "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p",
             "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
             "-c:v", "libx264", "-preset", "medium", "-crf", "8", "-an", "-y", path],
            stdin=subprocess.PIPE)

    def write(self, frame):
        self.p.stdin.write(np.ascontiguousarray(frame).tobytes())

    def close(self):
        self.p.stdin.close()
        self.p.wait()


def gray_small(bgr):
    return cv2.resize(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), None, fx=SC, fy=SC, interpolation=cv2.INTER_AREA)


def box_mask(box, ref_g):
    """Quti ichidagi TEKSTURALI piksellar (tekis joyda optik oqim ma'nosiz)."""
    h, w = ref_g.shape
    m = np.zeros((h, w), bool)
    m[int(h * box[0]):int(h * box[1]), int(w * box[2]):int(w * box[3])] = True
    grad = np.hypot(cv2.Sobel(ref_g, cv2.CV_32F, 1, 0), cv2.Sobel(ref_g, cv2.CV_32F, 0, 1))
    return m & (grad > 12)


def center(box):
    """Quti markazi, to'liq o'lchamda (x, y)."""
    return np.array([(box[2] + box[3]) / 2 * W, (box[0] + box[1]) / 2 * H], np.float64)


def estimate(ref_g, frame_g, mask, c):
    """(theta, dx, dy) yoki None. Siljish — reference'dan kadrgacha optik oqimning MEDIANASI mask ichida (to'liq o'lchamda px):
    og'iz/ko'z kabi kichik mahalliy o'zgarish medianaga ta'sir qilmaydi. Burilish hisobga olinmaydi (theta = 0)."""
    if mask.sum() < 30:
        return None
    flow = cv2.calcOpticalFlowFarneback(ref_g, frame_g, None, 0.5, 4, 25, 4, 5, 1.1, 0)
    d = np.median(flow[mask], axis=0) / SC
    return 0.0, float(d[0]), float(d[1])


def clean(series, name):
    """ECC ba'zan noto'g'ri yechimga yaqinlashadi (masalan qo'l furajkani to'sganda): bunday kadrlarni rad etib, qo'shnilaridan
    interpolyatsiya qiladi. Rad etiladi: yaqinlashmagan, jismonan mumkin bo'lmagan (> LIMIT) yoki qo'shnilar medianasidan uzoq."""
    a = np.array([(np.nan,) * 3 if s is None else s for s in series], np.float64)
    n = len(a)
    bad = np.isnan(a).any(1) | (np.abs(a[:, 0]) > LIMIT_RAD) | (np.abs(a[:, 1:]) > LIMIT_PX).any(1)
    ok = np.where(bad[:, None], np.nan, a)
    med = np.full_like(a, np.nan)
    for i in range(n):
        win = ok[max(0, i - 5):i + 6]
        if (~np.isnan(win[:, 0])).any():
            med[i] = np.nanmedian(win, axis=0)
    bad |= np.isnan(med).any(1) | (np.abs(a[:, 0] - med[:, 0]) > 0.015) | (np.abs(a[:, 1:] - med[:, 1:]) > 5).any(1)
    idx = np.arange(n)
    if bad.all():
        a[:] = 0.0
    else:
        for j in range(3):
            a[bad, j] = np.interp(idx[bad], idx[~bad], a[~bad, j])
    print(f"  {name}: {int(bad.sum())}/{n} kadr rad etildi (interpolyatsiya)")
    return a


def smooth(series):
    a = np.asarray(series, np.float64)  # (n, 3)
    k = np.exp(-0.5 * (np.arange(-4, 5) / SIGMA_T) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((4, 4), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, j], k, mode="valid") for j in range(a.shape[1])], axis=1)


def matrix(params, keep, c):
    """Bekor qilish matritsasi (cv2.WARP_INVERSE_MAP bilan): burilish quti markazi atrofida, keep ulushidagi harakat qoladi."""
    th, dx, dy = params
    r = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    a = np.concatenate([r, (np.array([dx, dy]) + c - r @ c)[:, None]], axis=1).astype(np.float32)
    i = np.eye(2, 3, dtype=np.float32)
    return i + (1.0 - keep) * (a - i)


def align(frame, head_m, body_m, weight):
    kw = dict(dsize=(W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    head = cv2.warpAffine(frame, head_m, **kw).astype(np.float32)
    body = cv2.warpAffine(frame, body_m, **kw).astype(np.float32)
    return head * weight + body * (1.0 - weight)


def stabilize(src, dst, ref, keep, body_keep, static_mode, dry=False):
    fps = probe_fps(src)
    ref_g = gray_small(ref)
    hm, bm = box_mask(HEAD_BOX, ref_g), box_mask(BODY_BOX, ref_g)
    hc, bc = center(HEAD_BOX), center(BODY_BOX)
    weight = np.clip((NECK[1] - np.arange(H) / H) / (NECK[1] - NECK[0]), 0, 1).astype(np.float32)[:, None, None]

    # 1-o'tish: har kadr uchun bosh va tana siljishi; boshi/oxiri kadrlar rang o'lchash uchun saqlanadi
    head_p, body_p = [], []
    first, last = [], deque(maxlen=EDGE)
    for i, f in enumerate(read_frames(src)):
        g = gray_small(f)
        for series, mask, c in ((head_p, hm, hc), (body_p, bm, bc)):
            series.append(estimate(ref_g, g, mask, c))
        if i < EDGE:
            first.append(f.copy())
        last.append(f.copy())
    n = len(head_p)
    head_p, body_p = clean(head_p, "bosh"), clean(body_p, "tana")
    head_s, body_s = smooth(head_p), smooth(body_p)
    drift = lambda s: np.abs(np.asarray(s)[:, 1:]).max()
    print(f"  {n} kadr; eng katta siljish (px) bosh {drift(head_p):.1f}, tana {drift(body_p):.1f}; harakat qoladi: bosh {keep:.0%}, tana {body_keep:.0%}")

    if dry:
        return
    # Rang xaritasi: holati asl kadrga teng kadrlar (boshi + oxiri) o'rtachasi → asl kadr
    edge = first + list(last)
    idx = list(range(EDGE)) + list(range(n - len(last), n))
    aligned = [align(f, matrix(head_s[k], keep, hc), matrix(body_s[k], body_keep, bc), weight) for f, k in zip(edge, idx)]
    mean = np.mean(aligned, axis=0)
    low = lambda a: cv2.GaussianBlur(a.astype(np.float32), (0, 0), SIGMA_COLOR)
    gain = np.clip(low(ref) / np.maximum(low(mean), 1.0), 0.75, 1.35)
    fig = cv2.GaussianBlur((ref.mean(2) > 35).astype(np.float32), (0, 0), 6)[..., None]
    gain = 1.0 + fig * (gain - 1.0)  # faqat figura ustida
    print("  rang kuchaytirish (B,G,R) figura bo'yicha:", np.round((gain * fig).sum((0, 1)) / fig.sum(), 3))

    # 2-o'tish: moslash + rang (+ statik tana) → yozish
    still = ref.astype(np.float32)
    w = Writer(dst, fps)
    for k, f in enumerate(read_frames(src)):
        out = align(f, matrix(head_s[k], keep, hc), matrix(body_s[k], body_keep, bc), weight) * gain
        if static_mode:
            fixed = out * weight + still * (1.0 - weight)  # bosh videodan, bo'yindan pasti — start kadrdan
            if static_mode == "edges":
                t = float(np.clip(1.0 - min(k, n - 1 - k) / EDGE_FRAMES, 0.0, 1.0))
                t = t * t * (3.0 - 2.0 * t)  # klipning chetida 1, ichida 0
                out = t * fixed + (1.0 - t) * out
            else:
                out = fixed
        w.write(np.clip(out + 0.5, 0, 255).astype(np.uint8))
    w.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep, body_keep, only = dict(KEEP), dict(BODY_KEEP), set(KEEP)
    for a in sys.argv[1:]:
        if a.startswith("--keep=") or a.startswith("--body-keep="):
            target = keep if a.startswith("--keep=") else body_keep
            for kv in a.split("=", 1)[1].split(","):
                name, val = kv.split("=")
                target[name] = float(val)
        elif a.startswith("--only="):
            only = set(a[7:].split(","))
    dry = "--dry" in sys.argv  # faqat siljishni o'lchaydi (yozmaydi)
    if len(args) < 2:
        sys.exit(__doc__)
    raw, ref_path = args[0], args[1]
    out = args[2] if len(args) > 2 else os.path.join(raw, "stabilized")
    os.makedirs(out, exist_ok=True)
    ref = cv2.resize(cv2.imread(ref_path), (W, H), interpolation=cv2.INTER_AREA)
    for name in KEEP:
        if name not in only:
            continue
        src = os.path.join(raw, f"{name}_raw.mp4")
        if not os.path.exists(src):
            print(f"o'tkazildi (yo'q): {src}")
            continue
        print(f"{name}:")
        stabilize(src, os.path.join(out, f"{name}_raw.mp4"), ref, keep[name], body_keep[name],
                  None if "--no-static-body" in sys.argv else STATIC_BODY[name], dry)


if __name__ == "__main__":
    main()
