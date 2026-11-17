"""arrive.mp4 uchun boshlang'ich kadr: uy kadridagi xodim uzoqda, kichik (perspektiva: poyi yuqoriroq).
Natija: work/arrive/start_far_1080x1920.png (+ sof qora kadr black_1080x1920.png).
Ishga tushirish: C:\\av python (numpy + cv2 bor).
"""
import sys
import cv2
import numpy as np

HOME = "work/higgsfield/chat_pack/home_black_1080x1920.png"
OUT = "work/arrive/"
SCALE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.26   # xodimning uzoqdagi o'lchami (uy kadriga nisbatan)
FEET_Y = int(sys.argv[2]) if len(sys.argv) > 2 else 1180   # uzoqda poyi turadigan qator (uy kadrida ~1850)

home = cv2.imread(HOME, cv2.IMREAD_COLOR)
assert home is not None and home.shape[:2] == (1920, 1080), home.shape if home is not None else "o'qilmadi"

# xodimning chegaralari (qora fondan farq)
gray = cv2.cvtColor(home, cv2.COLOR_BGR2GRAY)
ys, xs = np.where(gray > 12)
y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
fig = home[y0:y1 + 1, x0:x1 + 1]
print("xodim qutisi (uy kadri):", (x0, y0, x1, y1), "bo'yi", y1 - y0 + 1)

h = max(2, int(round(fig.shape[0] * SCALE)))
w = max(2, int(round(fig.shape[1] * SCALE)))
small = cv2.resize(fig, (w, h), interpolation=cv2.INTER_AREA)

canvas = np.zeros_like(home)
# gorizontal: uy kadridagi markaz chizig'i saqlanadi (ikki oyoq oralig'i markazi ~ x=540)
cx_home = (x0 + x1) / 2.0
cx = int(round(540 + (cx_home - 540) * SCALE))
top = FEET_Y - h
left = cx - w // 2
assert top >= 0 and left >= 0 and left + w <= 1080, (top, left, w, h)
canvas[top:top + h, left:left + w] = small
cv2.imwrite(OUT + "start_far_1080x1920.png", canvas)
cv2.imwrite(OUT + "black_1080x1920.png", np.zeros_like(home))
print("yozildi:", OUT + "start_far_1080x1920.png", "xodim", (w, h), "poy y =", FEET_Y)
