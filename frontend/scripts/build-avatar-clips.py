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
  3. MONTAJ: tana, furajka, soch, quloq — hamma kadrda ASL KADRNING o'zi (o'tkir, AI titrog'i yo'q); videodan faqat YUZ olinadi.
     Yuz markazi (qosh, ko'z, burun, og'iz) har doim videodan; yonoq/jag' chizig'i halqasida — faqat video asl kadrdan (past
     chastotada) FARQ QILGAN joyda (chok ko'rinmasin); sirg'alar — doim asl kadrdan. Mayda tafsilotni asl kadrdan videoga
     qo'yish SIRG'ALANGAN qosh/sirg'a ustiga "ikkinchi qosh" bo'lib tushardi — shuning uchun qilinmaydi.
     Greeting'da qo'shimcha: asl kadrdan sezilarli farq qiladigan joy (ko'tarilgan qo'l) ham videodan olinadi — FAQAT qo'l hududida
     (ARM_X/ARM_Y), tana qotirilgan (BODY_KEEP=0): aks holda galstuk, yoqa va yelka "ikki qatlam" bo'lib ko'rinadi.
     Yuz ifodasi pastki yuzda DAMP ulushiga yumshatiladi (AI ifodasi ortiqcha), yuz klipi kadrlari SMOOTH bilan vaqt bo'yicha silliqlanadi.
  4. KONTUR VA FON: odam konturi (make-avatar-matte.py, soch bilan) bo'yicha fon sayt foni (#05070d) ga almashtiriladi.
     Fon boshning orqasida sal yoritilgan (--glow): qop-qora soch sof qora fonda ko'rinmay qolardi ("kal" ko'rinish).
  5. QATLAMLAR (rig): sayt avatarni bitta video emas, qatlamlar qilib ko'rsatadi — base.png (boshsiz tana), head.png (alfa kanalli
     bosh) va yuz qirqimlari (idle, speaking). Pleyer boshni bo'yin tagi atrofida yengil aylantiradi, yuz videolari bosh bilan
     birga yuradi, kliplar almashganda faqat yuz qirqimi xira-o'tadi. Salom — to'liq kadr (qo'l va tana ham harakatlanadi),
     boshi/oxiri statik kadrga tenglashtiriladi.

Natija `<chiqish>/`: base.png, head.png, rig.json (joylashuv; src/avatarRig.ts bilan bir xil bo'lishi shart), idle_raw.mp4 va
speaking_raw.mp4 (yuz qirqimi, FACE_RECT), greeting_raw.mp4 (1080x1920, fon tayyor) — keyin `npm run process:avatar -- <papka>`.

  python scripts/build-avatar-clips.py <xom-papka> <start-kadr.png> <kontur.png> [chiqish-papka]
         [--keep=idle=0.05,...] [--body-keep=idle=0.03,...] [--glow=14,15,18] [--only=speaking] [--dry]
         [--seq=idle:0-28,27-1,0-28,29-32,76-96] [--limit=160]
  --seq=<klip>:a-b,c-d   yuz klipi kadrlari tartibi (a>b bo'lsa teskari): loop choki va ko'z yumilishini tuzatish uchun
  --limit=N              faqat birinchi N kadr (yuz qirqimini tez ko'zdan kechirish uchun)

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
# Salomda ham tana qotiriladi (0): qolgan 15% harakat galstuk, yoqa va yelkani asl kadrdan siljitib, qo'l maskasiga tushib,
# "ikki galstuk" (xira ikki qatlam) bergan. Qo'l tanaga bog'liq qolishi uchun uning o'zi ham shu moslash bilan siljiydi.
BODY_KEEP = {"idle": 0.03, "speaking": 0.03, "greeting": 0.0}
ARM = {"greeting"}                     # asl kadrdan farq qiladigan joy (qo'l) videodan olinadigan kliplar
HEAD_BOX = (0.045, 0.19, 0.40, 0.60)   # (qator0, qator1, ustun0, ustun1) kadr ulushida: furajkadan iyakkacha (og'iz medianaga ta'sir qilmaydi)
BODY_BOX = (0.27, 0.50, 0.38, 0.62)    # ko'krak: tugmalar, yoqa, galstuk (qo'llar YO'Q — salomda qo'l harakatlanadi)
NECK = (0.17, 0.25)                    # bosh siljishi shu oraliqda tana siljishiga o'tadi
LIMIT_PX, LIMIT_RAD = 15.0, 0.04       # AI klipdagi haqiqiy siljish bundan kichik; kattasi — o'lchash xatosi
SIGMA_T = 1.2                          # siljish parametrlarini vaqt bo'yicha tekislash (kadr)
SIGMA_COLOR = 25                       # rang xaritasi qanchalik "sekin" (px): tafsilot emas, yorug'lik
EDGE = 6                               # rang o'lchanadigan boshi/oxiri kadrlar soni (holati asl kadrga teng)
# Yuz ellipsi (kadr ulushida): qoshdan iyakkacha + og'iz ochilganda iyak tushadigan joy. Furajka, soch, quloq — ASL kadrdan.
FACE = dict(cx=0.50, cy=0.150, rx=0.070, ry_up=0.038, ry_dn=0.055)  # farq maskasi bilan ko'paytiriladi
# Yuz ikki zonada (ellips radiusi ulushida): MARKAZ (qosh, ko'z, burun, og'iz) — har doim to'liq videodan; HALQA (yonoq, jag' chizig'i) —
# faqat video asl kadrdan farq qilgan joyda (chok ko'rinmasin). Markazda ham farq maskasi ishlatilsa, ikki rasm kesishgan joyda
# farq nolga teng bo'lib, aralashma xira "ikki qosh" beradi.
FACE_CORE = (0.80, 1.05)
FACE_RING = (1.05, 1.45)
EARRINGS = ((471, 305), (613, 300))    # sirg'alar (chiqish pikselida): doim asl kadrdan — video ularni siljitib "ikkita sirg'a" qilardi
EAR_R = (14, 26)                       # sirg'a atrofi: ichkarida video yo'q, tashqarida yumshoq o'tadi
DIFF = (4.0, 12.0)                     # video asl kadrdan shuncha (rang darajasi, past chastotada) farq qilsa — videodan olinadi
DIFF_SIGMA = 3.0                       # farq o'lchanadigan xiralik (px, chiqish o'lchamida): mayda tafsilot (kiprik) farqi sanalmaydi
SHARP = 0.6                            # videodan olingan yuz o'tkirlanishi (720p → 1080p kattalashganda xira)
BG = (5, 7, 13)                        # styles.css :root --bg (RGB)
GLOW = dict(cx=0.50, cy=0.125, sx=0.13, sy=0.075, add=(14, 15, 18))  # boshning orqasidagi yengil yorug'lik (RGB qo'shimcha)

# --- QATLAMLAR (rig): chiqish 1080x1920 kadrida piksel (x0, y0, x1, y1) ---
# Sayt avatarni BIR kadrli video emas, qatlamlar qilib ko'rsatadi: qimirlamaydigan tana (base) + alohida BOSH qatlami (head,
# furajka/soch/yuz/quloq) + yuz videolari (idle/speaking: faqat yuz qirqimi). Bosh sayt tomonida yengil aylantirilib siljitiladi
# (nafas, bosh irg'ashi), yuz videolari esa bosh BILAN BIRGA yuradi — yuz "yopishtirilgan niqob" bo'lib ko'rinmaydi, kliplar
# almashganda esa faqat yuz qirqimi o'zgaradi (tana, furajka va soch qatlami hech qachon almashmaydi).
HEAD_RECT = (340, 60, 740, 380)        # bosh qatlami (alfa kanalli rasm)
CUT = (356, 366)                       # shu oraliqda (bo'yin terisi) bosh qatlami tanaga o'tadi (alfa 1 → 0)
PIVOT = (540, 362)                     # boshning burilish markazi (bo'yin tagi)
FACE_RECT = (420, 190, 660, 366)       # yuz videolari (idle, speaking): faqat shu qirqim yoziladi
CROPS = {"idle": FACE_RECT, "speaking": FACE_RECT}   # greeting — to'liq kadr (qo'l va tana ham harakatlanadi)
START_BLEND, END_BLEND = 12, 6         # to'liq kadrli klipning boshi/oxiri shuncha kadr ichida statik kadrga tenglashtiriladi (boshi uzoqroq:
                                       # AI salomning birinchi soniyasidayoq og'zini keng ochadi — yuz bir zumda tabassumga sakramasin)
# Salom maskasi FAQAT qo'l uchun: o'ngda (tana, galstuk, yelka) va pastda (son) video ishlatilmaydi — u yerda asl kadr.
ARM_X = (470, 520)                     # shu x dan o'ngda qo'l yo'q (barmoq uchlari furajka chetigacha, x≈480 gacha boradi)
ARM_Y = (1100, 1200)                   # shu y dan pastda qo'l yo'q
ARM_THR = (24, 44)                     # qo'l farqi chegarasi (rang darajasi): avval 12–22 edi — tananing mayda siljishi ham qo'l bo'lib tushardi
# Yuz ifodasi pastki yuzda (burun, og'iz, jag') yumshatiladi: AI ifodasi ortiqcha (lablar cho'chchayadi, keng tabassum). Videoning
# asl kadrdan optik oqimi beta ulushiga kamaytiriladi; ko'z va qosh (DAMP_ROWS dan yuqorisi) tegilmaydi — pirpirash saqlanadi.
DAMP = {"speaking": 0.5, "greeting": 0.5}
DAMP_ROWS = (272, 296)                 # chiqish pikselida: bu qatordan yuqorisi — ko'z/qosh (to'liq videodan), pastdan to'liq yumshatish
DAMP_SIGMA = 5.0
SMOOTH = (0.2, 0.6, 0.2)               # yuz klipi kadrlari vaqt bo'yicha silliqlanadi (AI har kadrni qayta chizadi: teri va lab titraydi)
LIMIT = 0                              # --limit=N: faqat birinchi N kadr (tez sinash uchun)


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
    count = 0
    while not (LIMIT and count >= LIMIT):
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        count += 1
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    p.stdout.close()
    p.kill() if LIMIT else p.wait()


class Writer:
    def __init__(self, path, fps, size=(OW, OH)):
        self.p = subprocess.Popen(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{size[0]}x{size[1]}",
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
    """Yuz zonalari (OH, OW, 2): [..., 0] — MARKAZ (har doim videodan), [..., 1] — HALQA (farq maskasi bilan). Yig'indi 1 gacha."""
    yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
    u = (xx / OW - FACE["cx"]) / FACE["rx"]
    dy = yy / OH - FACE["cy"]
    v = np.where(dy < 0, dy / FACE["ry_up"], dy / FACE["ry_dn"])
    r = np.sqrt(u * u + v * v)
    inner = smoothstep(FACE_CORE[0], FACE_CORE[1], r)
    core = 1.0 - inner
    ring = inner * (1.0 - smoothstep(FACE_RING[0], FACE_RING[1], r))
    keep_out = np.ones_like(r)
    for ex, ey in EARRINGS:
        keep_out *= smoothstep(EAR_R[0], EAR_R[1], np.hypot(xx - ex, yy - ey))
    return np.stack([core * keep_out, ring * keep_out], axis=-1).astype(np.float32)


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


def damp_face(up, still, beta):
    """Yuz qirqimida videoning asl kadrdan optik oqimini `beta` ulushiga kamaytirib, ifodani yumshatadi (faqat DAMP_ROWS dan pastda)."""
    x0, y0, x1, y1 = FACE_RECT
    gray = lambda a: cv2.GaussianBlur(cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY), (0, 0), 1.2)
    crop = up[y0:y1, x0:x1]
    flow = cv2.calcOpticalFlowFarneback(gray(still[y0:y1, x0:x1]), gray(crop), None, 0.5, 3, 21, 3, 5, 1.1, 0)
    flow = cv2.GaussianBlur(flow, (0, 0), DAMP_SIGMA)
    yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0].astype(np.float32)
    wy = smoothstep(DAMP_ROWS[0], DAMP_ROWS[1], yy + y0)
    warped = cv2.remap(crop, xx + beta * wy * flow[..., 0], yy + beta * wy * flow[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    out = up.copy()
    out[y0:y1, x0:x1] = warped
    return out


def temporal_smooth(frames, w=SMOOTH):
    """Aylanma (loop) klip kadrlarini [w0, w1, w2] og'irliklar bilan vaqt bo'yicha silliqlaydi."""
    n = len(frames)
    f = [x.astype(np.float32) for x in frames]
    return [np.clip(w[0] * f[(i - 1) % n] + w[1] * f[i] + w[2] * f[(i + 1) % n] + 0.5, 0, 255).astype(np.uint8) for i in range(n)]


def head_mask():
    """Bosh qatlamining (OH, OW, 1) maskasi: CUT[0] dan yuqorisi 1 (bosh), CUT[1] dan pastki 0 (tana); oraliq — bo'yin terisi."""
    rows = np.arange(OH, dtype=np.float32)
    m = 1.0 - smoothstep(CUT[0], CUT[1], rows)
    return np.broadcast_to(m[:, None, None], (OH, OW, 1)).astype(np.float32)


def write_rig(out, still, matte, bg):
    """Qatlamlar: base.png (tana, boshsiz), head.png (bosh, alfa kanalli), rig.json (joylashuv).
    Bosh o'z joyida bo'lganda base + head = asl montaj (piksel-piksel): base = (asl − bosh·alfa) / (1 − alfa) ('over' tenglamasi)."""
    m = head_mask()
    a = matte * m                                                   # bosh qatlamining alfasi
    solid = matte * (1.0 - m) * still + (1.0 - matte) * bg          # asl montajning boshdan tashqari ulushi
    base = np.where(1.0 - a < 1e-2, bg, solid / np.maximum(1.0 - a, 1e-2))
    x0, y0, x1, y1 = HEAD_RECT
    outside = a.copy()
    outside[y0:y1, x0:x1] = 0.0
    assert outside.max() < 0.02, f"bosh HEAD_RECT dan chiqib ketgan (alfa {outside.max():.2f}): qutini kattalashtiring"
    head = np.dstack([np.clip(still, 0, 255), a * 255.0])[y0:y1, x0:x1]
    cv2.imwrite(os.path.join(out, "base.png"), np.clip(base + 0.5, 0, 255).astype(np.uint8))
    cv2.imwrite(os.path.join(out, "head.png"), np.clip(head + 0.5, 0, 255).astype(np.uint8))
    import json
    with open(os.path.join(out, "rig.json"), "w", encoding="utf-8") as f:
        json.dump({"frame": [OW, OH], "head": list(HEAD_RECT), "pivot": list(PIVOT), "face": list(FACE_RECT), "cut": list(CUT)}, f)
    print(f"  rig: base.png, head.png ({x1 - x0}x{y1 - y0}), rig.json")


def build(src, dst, ref, still, matte, bg, face, keep, body_keep, arm, dry=False, crop=None, seq=None, damp=0.0):
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

    # 2-o'tish: moslash + rang → montaj (asl kadr + yuz [+ qo'l]) → kontur bo'yicha fon → yozish
    static = np.clip(matte * still + (1.0 - matte) * bg + 0.5, 0, 255).astype(np.uint8)   # asl montaj (statik kadr)
    gy, gx = np.mgrid[0:OH, 0:OW].astype(np.float32)
    arm_gate = ((1.0 - smoothstep(ARM_X[0], ARM_X[1], gx)) * (1.0 - smoothstep(ARM_Y[0], ARM_Y[1], gy)))[..., None]
    zone = face.sum(2, keepdims=True)
    if crop:
        cx0, cy0, cx1, cy1 = crop
        kept = []
    else:
        w = Writer(dst, fps)
    for k, f in enumerate(read_frames(src)):
        al = align(f, matrix(head_s[k], keep, hc), matrix(body_s[k], body_keep, bc), weight) * gain
        up = cv2.resize(al, (OW, OH), interpolation=cv2.INTER_CUBIC)
        if damp:
            up = up + (damp_face(up, still, damp) - up) * zone      # ifoda yumshatiladi (faqat yuz zonasida)
        # YUZ: farq maskasi. Video asl kadrdan (past chastotalarda: shakl, soya, rang) FARQ QILGAN joyda — videoning o'zi
        # (qosh ko'tarilgan, lab cho'chchaygan, ko'z yumilgan), farq yo'q joyda — asl kadr (o'tkir teri, kiprik). Chegara farq
        # nolga tushgan joyda o'tadi, shuning uchun chok ko'rinmaydi. (Avval asl kadrning mayda tafsiloti siljigan qosh va
        # sirg'a ustiga qo'yilardi: "ikki qosh", "ikki sirg'a" — bir video ikkinchisining ustiga tushgandek.)
        lo_up, lo_st = cv2.GaussianBlur(up, (0, 0), DIFF_SIGMA), cv2.GaussianBlur(still, (0, 0), DIFF_SIGMA)
        move = smoothstep(DIFF[0], DIFF[1], cv2.GaussianBlur(np.abs(lo_up - lo_st).max(2), (0, 0), 2.0))[..., None]
        # video kattalashtirilganda xira: faqat ishlatilayotgan joyda o'tkirlanadi
        up = np.clip(up + SHARP * (up - cv2.GaussianBlur(up, (0, 0), 1.6)), 0, 255)
        face_w = face[..., :1] + face[..., 1:] * move
        if arm:
            d = cv2.GaussianBlur(np.abs(up - still).max(2), (0, 0), 3)
            a = cv2.GaussianBlur(cv2.dilate(smoothstep(ARM_THR[0], ARM_THR[1], d), np.ones((9, 9), np.uint8)), (0, 0), 5)[..., None]
            # qat'iyroq (yeng izi qolmasin); yuz zonasidan va qo'l bo'lishi mumkin bo'lmagan joydan (tana, son) tashqarida
            a = np.clip(a * 1.8, 0.0, 1.0) * (1.0 - zone) * arm_gate
            dyn = np.maximum(face_w, a)
            cut = matte * (1.0 - a) + key_abs(up) * a             # qo'l konturi kadrning o'z rangidan
        else:
            dyn, cut = face_w, matte
        fg = still * (1.0 - dyn) + up * dyn
        frame = np.clip(cut * fg + (1.0 - cut) * bg + 0.5, 0, 255).astype(np.uint8)
        if crop:
            kept.append(frame[cy0:cy1, cx0:cx1].copy())
            continue
        # to'liq kadrli klip: boshi va oxiri statik kadrga tenglashadi (yuz/tana qatlamlari bilan xira-o'tish sezilmasin)
        t = min(1.0, k / START_BLEND, (n - 1 - k) / END_BLEND)
        if t < 1.0:
            frame = np.clip(static * (1.0 - t) + frame * t + 0.5, 0, 255).astype(np.uint8)
        w.write(frame)
    if not crop:
        w.close()
        return
    order = seq if seq else list(range(len(kept)))
    print(f"  {len(kept)} kadrdan {len(order)} kadrli klip yig'ildi")
    ordered = temporal_smooth([kept[i] for i in order])   # AI kadrma-kadr titrashi (teri, lab) silliqlanadi
    w = Writer(dst, fps, size=(cx1 - cx0, cy1 - cy0))
    for frame in ordered:
        w.write(frame)
    w.close()


def main():
    global LIMIT
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep, body_keep, only, glow, seqs = dict(KEEP), dict(BODY_KEEP), set(KEEP), GLOW["add"], {}
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
        elif a.startswith("--limit="):
            LIMIT = int(a[8:])
        elif a.startswith("--seq="):
            # --seq=idle:0-36,35-1,0-44 : chiqish kadrlari tartibi (kesmalar, a>b bo'lsa teskari); yuz klipi uchun
            name, spec = a[6:].split(":", 1)
            order = []
            for part in spec.split(","):
                lo, hi = (int(x) for x in part.split("-"))
                order += list(range(lo, hi + 1)) if lo <= hi else list(range(lo, hi - 1, -1))
            seqs[name] = order
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
    if not dry:
        write_rig(out, still, matte, bg)
    for name in KEEP:
        if name not in only:
            continue
        src = os.path.join(raw, f"{name}_raw.mp4")
        if not os.path.exists(src):
            print(f"o'tkazildi (yo'q): {src}")
            continue
        print(f"{name}:")
        build(src, os.path.join(out, f"{name}_raw.mp4"), ref, still, matte, bg, face, keep[name], body_keep[name], name in ARM, dry,
              crop=CROPS.get(name), seq=seqs.get(name), damp=DAMP.get(name, 0.0))


if __name__ == "__main__":
    main()
