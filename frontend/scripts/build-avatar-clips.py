#!/usr/bin/env python3
"""Xom (AI) avatar kliplaridan saytdagi kliplarni yig'adi: almashishlar bitta 3D model kabi sezilmasin.

AI video xizmati har klipni alohida yaratadi va har kadrni qayta chizadi: bosh va tana sekin siljiydi, rang farq qiladi,
kiyim va soch teksturasi "titraydi", furajka qiyshayadi (asl kadrda tekis!), qora soch fon bilan qo'shilib ketadi.
Kliplar almashganda bu sakrash, miltillash va xiralik bo'lib ko'rinadi. Bu vosita har kadrni ASL start kadrga (reference)
tayanib yig'adi:

  1. HOLAT: har kadr uchun bosh (furajkadan iyakkacha) va tananing (ko'krak) siljishi reference'ga nisbatan optik oqimning
     MEDIANASI bilan o'lchanadi (og'iz/ko'z kabi kichik mahalliy o'zgarish medianaga ta'sir qilmaydi), vaqt bo'yicha tekislanadi
     va bekor qilinadi (`--keep` bosh uchun, `--body-keep` tana uchun: qancha harakat QOLISHI; 0 = qotgan, 1 = o'zgarishsiz).
  2. RANG: start/oxirgi kadrlar (holati asl kadrga teng) asl kadr bilan solishtirilib, sekin o'zgaradigan rang-yorqinlik
     xaritasi topiladi va butun klipga qo'llanadi. Tafsilotlar o'zgarmaydi.
  3. MONTAJ: tana, furajka, soch, quloq — hamma kadrda ASL KADRNING o'zi (qimirlamaydi, o'tkir, AI titrog'i yo'q);
     videodan faqat YUZ ellipsi (ko'z, qosh, og'iz, iyak) olinadi. Greeting'da qo'shimcha: asl kadrdan sezilarli farq
     qiladigan joy (ko'tarilgan qo'l) ham videodan olinadi. Natijada kliplar orasida farq faqat yuzda bo'ladi.
  4. KONTUR VA FON: odam konturi (make-avatar-matte.py, soch bilan) bo'yicha fon sayt foni (#05070d) ga almashtiriladi.
     Fon boshning orqasida sal yoritilgan (--glow): qop-qora soch sof qora fonda ko'rinmay qolardi ("kal" ko'rinish).

Natija `<chiqish>/<nom>_raw.mp4` (1080x1920, deyarli yo'qotishsiz, fon tayyor) — keyin `npm run process:avatar -- <papka> --no-key`.

  python scripts/build-avatar-clips.py <xom-papka> <start-kadr.png> <kontur.png> [chiqish-papka]
         [--keep=idle=0.05,...] [--body-keep=idle=0.03,...] [--glow=14,15,18] [--only=speaking] [--dry]

Kerak: python3, numpy, opencv-python; ffmpeg (PATH'da yoki FFMPEG_PATH). Xom klip o'lchami 720x1280 deb olinadi.
"""
import os
import re
import shutil
import subprocess
import sys
from collections import deque

import cv2
import numpy as np

FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"
W, H, SC = 720, 1280, 0.5          # xom klip; siljish hisoblari kichraytirilgan (SC) kadrda
OW, OH = 1080, 1920                # chiqish
# Qolgan harakat ulushi (0 = qotgan, 1 = o'zgarishsiz). Bosh va tana deyarli qotiriladi: kliplar almashganda 1–2 px siljish
# ham "sakrash" bo'lib ko'rinadi. Salomda qo'l ko'tarilishi uchun biroz harakat qolishi kerak.
KEEP = {"idle": 0.05, "speaking": 0.10, "greeting": 0.15}
BODY_KEEP = {"idle": 0.03, "speaking": 0.03, "greeting": 0.15}
ARM = {"greeting"}                     # asl kadrdan farq qiladigan joy (qo'l) videodan olinadigan kliplar
HEAD_BOX = (0.045, 0.19, 0.40, 0.60)   # (qator0, qator1, ustun0, ustun1) kadr ulushida: furajkadan iyakkacha (og'iz medianaga ta'sir qilmaydi)
BODY_BOX = (0.27, 0.50, 0.38, 0.62)    # ko'krak: tugmalar, yoqa, galstuk (qo'llar YO'Q — salomda qo'l harakatlanadi)
NECK = (0.17, 0.25)                    # bosh siljishi shu oraliqda tana siljishiga o'tadi
LIMIT_PX, LIMIT_RAD = 15.0, 0.04       # AI klipdagi haqiqiy siljish bundan kichik; kattasi — o'lchash xatosi
SIGMA_T = 1.2                          # siljish parametrlarini vaqt bo'yicha tekislash (kadr)
SIGMA_COLOR = 25                       # rang xaritasi qanchalik "sekin" (px): tafsilot emas, yorug'lik
EDGE = 6                               # rang o'lchanadigan boshi/oxiri kadrlar soni (holati asl kadrga teng)
# Yuz ellipsi (kadr ulushida): qoshdan iyakkacha + og'iz ochilganda iyak tushadigan joy. Furajka, soch, quloq — ASL kadrdan.
FACE = dict(cx=0.50, cy=0.150, rx=0.066, ry_up=0.036, ry_dn=0.055)
DETAIL_SIGMA = 2.5                     # "past chastota" chegarasi (px, chiqish o'lchamida): shundan mayda tafsilot asl kadrdan
BG = (5, 7, 13)                        # styles.css :root --bg (RGB)
GLOW = dict(cx=0.50, cy=0.125, sx=0.13, sy=0.075, add=(14, 15, 18))  # boshning orqasidagi yengil yorug'lik (RGB qo'shimcha)


def probe_fps(path):
    info = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
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
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{OW}x{OH}",
             "-r", str(fps), "-i", "-", "-vf", "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p",
             "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
             "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-an", "-y", path],
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
    """Quti markazi, xom klip o'lchamida (x, y)."""
    return np.array([(box[2] + box[3]) / 2 * W, (box[0] + box[1]) / 2 * H], np.float64)


def estimate(ref_g, frame_g, mask, c):
    """(theta, dx, dy) yoki None. Siljish — reference'dan kadrgacha optik oqimning MEDIANASI mask ichida (xom o'lchamda px):
    og'iz/ko'z kabi kichik mahalliy o'zgarish medianaga ta'sir qilmaydi. Burilish hisobga olinmaydi (theta = 0)."""
    if mask.sum() < 30:
        return None
    flow = cv2.calcOpticalFlowFarneback(ref_g, frame_g, None, 0.5, 4, 25, 4, 5, 1.1, 0)
    d = np.median(flow[mask], axis=0) / SC
    return 0.0, float(d[0]), float(d[1])


def clean(series, name):
    """Optik oqim ba'zan noto'g'ri natija beradi (masalan qo'l furajkani to'sganda): bunday kadrlarni rad etib, qo'shnilaridan
    interpolyatsiya qiladi. Rad etiladi: hisoblanmagan, jismonan mumkin bo'lmagan (> LIMIT) yoki qo'shnilar medianasidan uzoq."""
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


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def face_mask():
    """Yuz ellipsi, yumshoq chetli: 1 = videodan, 0 = asl kadrdan. (OH, OW, 1)."""
    yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
    u = (xx / OW - FACE["cx"]) / FACE["rx"]
    dy = yy / OH - FACE["cy"]
    v = np.where(dy < 0, dy / FACE["ry_up"], dy / FACE["ry_dn"])
    return (1.0 - smoothstep(0.85, 1.2, np.sqrt(u * u + v * v)))[..., None].astype(np.float32)


def exclude_collar(face, still):
    """Oq yoqa asl kadrdan qolsin: videodagi yoqa chizig'i bir necha px siljigan, ellipsga kirsa pushti yo'l bo'lib ko'rinadi."""
    lum = still.mean(2)
    chroma = still.max(2) - still.min(2)
    rows = (np.arange(OH) / OH)[:, None]
    shirt = ((lum > 165) & (chroma < 24) & (rows > 0.182) & (rows < 0.26)).astype(np.uint8)
    shirt = cv2.GaussianBlur(cv2.dilate(shirt, np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 3)[..., None]
    return face * (1.0 - np.clip(shirt, 0.0, 1.0))


def backdrop(add):
    """Sayt foni + boshning orqasida yengil yorug'lik (BGR, float32). Hamma kliplarda bir xil."""
    yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
    g = np.exp(-(((xx / OW - GLOW["cx"]) / GLOW["sx"]) ** 2 + ((yy / OH - GLOW["cy"]) / GLOW["sy"]) ** 2) / 2)[..., None]
    img = np.array(BG[::-1], np.float32) + g * np.array(add[::-1], np.float32)
    rng = np.random.default_rng(7)  # qat'iy urug': fon hamma kliplarda piksel-piksel bir xil
    return img + (rng.random((OH, OW, 1), dtype=np.float32) - 0.5) * 1.6  # ~±0.8 daraja: gradient halqalari sezilmasin


def key_abs(img):
    """Kadrning o'z rangidan fon belgisi: to'q VA rangsiz piksellar fon (faqat harakatlanuvchi qo'l uchun; soch uchun kontur)."""
    lum = img.mean(2)
    chroma = img.max(2) - img.min(2)
    return np.maximum(smoothstep(30, 44, lum), smoothstep(7, 13, chroma))[..., None]


def build(src, dst, ref, still, matte, bg, face, keep, body_keep, arm, dry=False):
    fps = probe_fps(src)
    still_lo = cv2.GaussianBlur(still, (0, 0), DETAIL_SIGMA)
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

    # 2-o'tish: moslash + rang → montaj (asl kadr + yuz [+ qo'l]) → kontur bo'yicha fon → yozish
    w = Writer(dst, fps)
    for k, f in enumerate(read_frames(src)):
        al = align(f, matrix(head_s[k], keep, hc), matrix(body_s[k], body_keep, bc), weight) * gain
        up = cv2.resize(al, (OW, OH), interpolation=cv2.INTER_CUBIC)
        # Yuz o'tkirligi: 720p video 1080p ga kattalashganda xira. Past chastotalar (shakl, rang) videodan; mayda tafsilot (teri,
        # kiprik, lab chizig'i) harakatsiz joylarda asl kadrdan, faqat harakatlanayotgan joylarda (ko'z, qosh, og'iz) videodan.
        lo_v, lo_s = cv2.GaussianBlur(up, (0, 0), DETAIL_SIGMA), still_lo
        motion = smoothstep(10, 22, cv2.GaussianBlur(np.abs(up - still).max(2), (0, 0), 4))[..., None]
        up = lo_v + (still - lo_s) * (1.0 - motion) + (up - lo_v) * 1.3 * motion
        up = np.clip(up, 0, 255)
        if arm:
            d = cv2.GaussianBlur(np.abs(up - still).max(2), (0, 0), 3)
            a = cv2.GaussianBlur(cv2.dilate(smoothstep(12, 22, d), np.ones((9, 9), np.uint8)), (0, 0), 5)[..., None]
            a = np.clip(a * 1.8, 0.0, 1.0) * (1.0 - face)         # qat'iyroq (yeng izi qolmasin); yuz ellipsidan tashqarida
            dyn = np.maximum(face, a)
            cut = matte * (1.0 - a) + key_abs(up) * a             # qo'l konturi kadrning o'z rangidan
        else:
            dyn, cut = face, matte
        fg = still * (1.0 - dyn) + up * dyn
        w.write(np.clip(cut * fg + (1.0 - cut) * bg + 0.5, 0, 255).astype(np.uint8))
    w.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep, body_keep, only, glow = dict(KEEP), dict(BODY_KEEP), set(KEEP), GLOW["add"]
    for a in sys.argv[1:]:
        if a.startswith("--keep=") or a.startswith("--body-keep="):
            target = keep if a.startswith("--keep=") else body_keep
            for kv in a.split("=", 1)[1].split(","):
                name, val = kv.split("=")
                target[name] = float(val)
        elif a.startswith("--only="):
            only = set(a[7:].split(","))
        elif a.startswith("--glow="):
            glow = tuple(float(x) for x in a[7:].split(","))
    dry = "--dry" in sys.argv  # faqat siljishni o'lchaydi (yozmaydi)
    if len(args) < 3:
        sys.exit(__doc__)
    raw, ref_path, matte_path = args[:3]
    out = args[3] if len(args) > 3 else os.path.join(raw, "built")
    os.makedirs(out, exist_ok=True)
    full = cv2.imread(ref_path)
    ref = cv2.resize(full, (W, H), interpolation=cv2.INTER_AREA)                       # siljishni o'lchash uchun
    still = cv2.resize(full, (OW, OH), interpolation=cv2.INTER_AREA).astype(np.float32)  # montaj uchun (chiqish o'lchamida)
    matte = cv2.resize(cv2.imread(matte_path, 0), (OW, OH), interpolation=cv2.INTER_AREA).astype(np.float32)[..., None] / 255.0
    bg = backdrop(glow)
    face = exclude_collar(face_mask(), still)
    for name in KEEP:
        if name not in only:
            continue
        src = os.path.join(raw, f"{name}_raw.mp4")
        if not os.path.exists(src):
            print(f"o'tkazildi (yo'q): {src}")
            continue
        print(f"{name}:")
        build(src, os.path.join(out, f"{name}_raw.mp4"), ref, still, matte, bg, face, keep[name], body_keep[name], name in ARM, dry)


if __name__ == "__main__":
    main()
