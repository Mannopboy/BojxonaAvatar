"""AI klip figurasini kutish klipi bilan ustma-ust tushirish (doimiy afin moslash, butun klip uchun BITTA).

AI har klipni 2-3 px boshqacha joylaydi va biroz boshqa masshtabda chizadi (bosh pastroq, oyoqlar yuqoriroq): xira-o'tishda "ikki bosh/ikki tana"
bo'lib ko'rinadi. Klip uchlari (uy kadrlari) bosh, ko'krak, yubka etagi, tizza va poyabzal bo'yicha kutish klipi bilan solishtiriladi,
siljish dx(y), dy(y) ning chiziqli yaqinlashuvi topiladi va butun klipga qo'llanadi. Mazmun o'zgarmaydi (faqat joylashuv).
"""
import cv2
import numpy as np

REG = {"cap": (60, 112, 330, 410), "chest": (230, 330, 330, 400), "hem": (560, 640, 270, 450), "knees": (860, 960, 300, 420), "shoes": (1130, 1210, 280, 440)}
M = 14


def gray(f):
    return cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if f.ndim == 3 else f


def home_from_idle(idle_gray):
    return np.mean([x.astype(np.float32) for x in idle_gray], axis=0).astype(np.uint8)


def region_offset(home, g, box):
    y0, y1, x0, x1 = box
    tpl = home[y0:y1, x0:x1]
    big = g[y0 - M:y1 + M, x0 - M:x1 + M]
    res = cv2.matchTemplate(big, tpl, cv2.TM_CCOEFF_NORMED)
    _, mv, _, (x, y) = cv2.minMaxLoc(res)

    def sp(a, b, c):
        d = a - 2 * b + c
        return 0.0 if d == 0 else 0.5 * (a - c) / d

    dx = x + (sp(res[y, x - 1], res[y, x], res[y, x + 1]) if 0 < x < res.shape[1] - 1 else 0.0) - M
    dy = y + (sp(res[y - 1, x], res[y, x], res[y + 1, x]) if 0 < y < res.shape[0] - 1 else 0.0) - M
    return float(dx), float(dy), float(mv)


def offsets(home, g):
    return {k: region_offset(home, g, b) for k, b in REG.items()}


def fit(home, ref_off, clip_gray, picks):
    """clip_gray[picks] kadrlari (uy kadrlari: boshi va oxiri) bo'yicha afin parametrlar. ref_off — kutish klipining o'rtacha siljishi."""
    ys, dxs, dys = [], [], []
    for k, b in REG.items():
        vs = [region_offset(home, clip_gray[i], b) for i in picks]
        if np.mean([v[2] for v in vs]) < 0.85:
            continue
        ys.append((b[0] + b[1]) / 2.0)
        dxs.append(np.mean([v[0] for v in vs]) - ref_off[k][0])
        dys.append(np.mean([v[1] for v in vs]) - ref_off[k][1])
    bx, ax = np.polyfit(ys, dxs, 1)
    by, ay = np.polyfit(ys, dys, 1)
    return {"ax": float(ax), "bx": float(bx), "ay": float(ay), "by": float(by)}


def warp(frame, p):
    # dst -> src: manba kadrdagi nuqta = dst + d(dst); d(y) = (ax + bx*y, ay + by*y)
    m = np.float32([[1, p["bx"], p["ax"]], [0, 1 + p["by"], p["ay"]]])
    return cv2.warpAffine(frame, m, (frame.shape[1], frame.shape[0]), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
