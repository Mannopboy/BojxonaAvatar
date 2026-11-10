"""Qabul qilingan xom klipalardan sayt fayllari (work/higgsfield/v7/out/):

  python build_assets.py idle=<gen/idle_a.mp4>:24:120 greeting=<gen/greeting_a.mp4> speak=<gen/speak_01.mp4> speak=<gen/speak_02.mp4> ...

idle: berilgan kadr oralig'i (etalon, moslashsiz). greeting, speak: butun klip, doimiy afin moslash (align.py) bilan.
Natija: idle.mp4, greeting.mp4, speaking-01.mp4 ... va avatarClips.json (variants: file, duration, exits).
"""
import json, os, subprocess, sys
import cv2
import numpy as np
import align as A

FF = "C:/av/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
ENC = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-g", "24", "-movflags", "+faststart", "-r", "24"]


def encode(frames, dst, crf="18"):
    h, w = frames[0].shape[:2]
    p = subprocess.Popen([FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", "24", "-i", "-"] + ENC[:ENC.index("-crf") + 1] + [crf] + ENC[ENC.index("-crf") + 2:] + [dst], stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close()
    if p.wait():
        raise SystemExit("ffmpeg xatosi: " + dst)



FACE = (110, 260, 290, 430)   # tiniqlik o'lchanadigan hudud (ko'z..iyak), 720x1280


def _lapvar(frames, box):
    import numpy as np
    y0, y1, x0, x1 = box
    return float(np.median([cv2.Laplacian(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1].astype(np.float32), cv2.CV_32F).var() for f in frames[::3]]))


def tone_match(frames, ref_frames):
    """Klipning yorqinlik taqsimotini kutish klipiga moslaydi (Y kanalida gistogramma moslash; rang o'zgarmaydi). Foydalanuvchi: kutish tiniq,
    gapirish xira — AI klipni boshqacha ekspozitsiyada chizadi (shapka ~8% qoraroq)."""
    def luma(fr):
        ys = np.concatenate([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[::2, ::2].ravel() for f in fr[::4]])
        return ys[ys > 20]
    a, b = luma(frames), luma(ref_frames)
    ca = np.cumsum(np.bincount(a, minlength=256)) / len(a)
    cb = np.cumsum(np.bincount(b, minlength=256)) / len(b)
    lut = np.zeros(256, np.uint8)
    for v in range(256):
        lut[v] = int(np.searchsorted(cb, ca[v]).clip(0, 255)) if v > 20 else v
    # 20 dan past (fon) o'zgarmaydi; tekis o'tish uchun 14..30 oralig'ida aralashtiriladi
    for v in range(14, 31):
        t = (v - 14) / 16.0
        lut[v] = int(round((1 - t) * v + t * lut[v]))
    out = []
    for f in frames:
        ycc = cv2.cvtColor(f, cv2.COLOR_BGR2YCrCb)
        ycc[..., 0] = cv2.LUT(ycc[..., 0], lut)
        out.append(cv2.cvtColor(ycc, cv2.COLOR_YCrCb2BGR))
    return out


REGIONS = {"yuz": (110, 260, 290, 430), "kamzul": (330, 700, 250, 470), "shapka": (40, 120, 300, 420)}


def sharp_match(frames, ref_frames):
    """Tiniqlikni (Laplasian dispersiyasi) kutish klipiga tenglaydi: unsharp mask, miqdori butun klip uchun BITTA. Miqdor uch hudud (yuz,
    kamzul, shapka) bo'yicha eng katta og'ishni kamaytiradigan qilib tanlanadi (faqat yuz bo'yicha tanlansa, shapka qirralari haddan o'tkir bo'ladi)."""
    ref = {k: _lapvar(ref_frames, b) for k, b in REGIONS.items()}
    sample = frames[::6]
    blur = lambda f: cv2.GaussianBlur(f, (0, 0), 1.0)
    base = [f.astype(np.float32) for f in sample]
    soft = [blur(f).astype(np.float32) for f in sample]
    best = (9e9, 0.0, None)
    for amt in np.linspace(0.0, 0.5, 11):
        test = [np.clip(f + amt * (f - sb), 0, 255).astype(np.uint8) for f, sb in zip(base, soft)]
        dev = {k: _lapvar(test, b) / ref[k] - 1 for k, b in REGIONS.items()}
        worst = max(abs(v) for v in dev.values())
        if worst < best[0]:
            best = (worst, float(amt), dev)
    amt = best[1]
    print("   tiniqlik: unsharp miqdori %.2f; kutish klipiga nisbatan og'ish: %s" % (amt, {k: f"{v * 100:+.0f}%" for k, v in best[2].items()}))
    if amt == 0.0:
        return frames
    return [np.clip(f.astype(np.float32) + amt * (f.astype(np.float32) - blur(f).astype(np.float32)), 0, 255).astype(np.uint8) for f in frames]


def ramp_fix(frames, ramp=12):
    """AI klipning birinchi ~12 kadri qorong'iroq (asl rasm yorqinligidan o'z yorqinligiga o'tadi, ~3-5%): klip boshidagi yorqinlik "pulsi"
    bo'lmasin deb shu kadrlar ko'paytirgich bilan tekislanadi. Faqat yorqinlik (mazmun, joylashuv, ifoda o'zgarmaydi)."""
    import numpy as np

    def fig(f):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        m = g > 20
        return float(g[m].mean()) if m.any() else float(g.mean())

    ms = np.array([fig(f) for f in frames])
    settled = float(np.median(ms[ramp:ramp + 18]))
    out = []
    gains = []
    for i, f in enumerate(frames):
        gain = min(1.08, max(1.0, settled / ms[i])) if i < ramp else 1.0
        gains.append(gain)
        out.append(np.clip(f.astype(np.float32) * gain, 0, 255).astype(np.uint8) if gain > 1.0005 else f)
    print(f"   yorqinlik rampasi: boshida x{gains[0]:.3f} (kadr 0: {ms[0]:.1f} -> {settled:.1f})")
    return out

FACE_BOX = (60, 300, 270, 450)   # kadrlarni solishtirish hududi (shapka..iyak)
SOFT_MOUTH_K = 1.05              # chiqish oynasi uchun yumshoq chegara: lablar deyarli yopiq (kutish tezroq: gap tugagach og'iz uzoq harakatlanmasin)
SOFT_POSE_MAX = 3.5
CLOSE_POSE_MAX = 4.0             # kesish uchun bosh o'rni sharti (chiqish sharti POSE_MAX=2.5 dan yumshoqroq)
KEEP_FRAMES = tuple(range(4, 13))   # yopiq og'iz oralig'ida qoladigan kadrlar soni (~0.17-0.33 s); tikuv yaxshi bo'lsa kam, bo'lmasa ko'proq


def _face(f):
    y0, y1, x0, x1 = FACE_BOX
    return cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1].astype(np.float32)


def trim_pauses(frames, md, pose, thr, ok):
    """Gap o'rtasida og'iz uzoq yopiq turmasin (foydalanuvchi: ovoz gapirib turganda videoda og'iz ~1 s yopiladi, keyin yana ochiladi).
    AI klipda audio pauzalariga mos uzun yopiq-og'iz oraliqlari bor; jonli ovozda esa bu pauzalar boshqa joyda. Har yopiq-og'iz oralig'i
    (og'iz yopiq, bosh uy o'rnida) 4-6 kadrga (~0.2 s) qisqartiriladi: oraliq o'rtasidan kadrlar olib tashlanadi, tikuv joyi — oraliqning
    ichidan eng o'xshash ikki kadr (yuz hududi farqi eng kichik) va ularni ikki kadrli aralashtirish. Klip uchlari o'zgarmaydi (birinchi va
    oxirgi kadr joyida). Qaytaradi: yangi kadrlar, yangi ok (chiqish) massivi, nechta kadr olib tashlangani."""
    n = len(frames)
    closed = [(md[i] <= thr and pose[i] <= CLOSE_POSE_MAX) for i in range(n)]
    face = [_face(f) for f in frames]
    adj = float(np.median([np.abs(face[i] - face[i + 1]).mean() for i in range(n - 1)]))
    runs, a = [], None
    for i, v in enumerate(closed + [False]):
        if v and a is None:
            a = i
        if not v and a is not None:
            runs.append((a, i))
            a = None
    cut = set()
    blend = {}
    for a, b in runs:
        L = b - a
        if L <= 6:   # <= 0.25 s: tabiiy nafas/so'z orasidagi pauza, tegilmaydi
            continue
        best = None
        for R in KEEP_FRAMES:
            if L <= R + 1:
                continue
            for k1 in range(1, R):
                i, j = a + k1 - 1, b - (R - k1)
                if j <= i + 1:
                    continue
                raw = float(np.abs(face[i] - face[j]).mean())
                d = raw + 0.35 * (R - 4)
                if best is None or d < best[0]:
                    best = (d, i, j, raw)
        if best is None or best[3] > 4.0 * adj + 1.0:
            print(f"   kesish: {a}-{b} oralig'i ({L} kadr) kesilmadi (tikuv farqi {best[3] if best else -1:.1f} > {4.0 * adj + 1.0:.1f})")
            continue
        _, i, j, _ = best
        cut.update(range(i + 1, j))
        blend[i] = (j, 0.33)
        blend[j] = (i, 0.33)
    out, out_ok, out_soft = [], [], []
    for i in range(n):
        if i in cut:
            continue
        f = frames[i]
        if i in blend:
            o, w = blend[i]
            f = np.clip(f.astype(np.float32) * (1 - w) + frames[o].astype(np.float32) * w, 0, 255).astype(np.uint8)
        out.append(f)
        out_ok.append(bool(md[i] <= thr and pose[i] <= 2.5))
        out_soft.append(bool(md[i] <= thr * SOFT_MOUTH_K and pose[i] <= SOFT_POSE_MAX))
    left = max([sum(1 for _ in g) for g in []] + [0])
    print(f"   kesish: {len(runs)} yopiq oraliq, {len(cut)} kadr ({len(cut) / 24:.2f} s) olib tashlandi, klip {n / 24:.2f} -> {len(out) / 24:.2f} s")
    return out, out_soft, len(cut)


def ok_intervals(ok, fps=24.0):
    iv, a = [], None
    for i, v in enumerate(list(ok) + [False]):
        if v and a is None:
            a = i
        if not v and a is not None:
            iv.append([round(a / fps, 3), round(i / fps, 3)])
            a = None
    return iv



def load(path, lo=0, hi=None):
    c = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = c.read()
        if not ok:
            break
        out.append(f)
    return out[lo:(hi + 1 if hi is not None else None)]


def main():
    os.makedirs(OUT, exist_ok=True)
    idle = greet = None
    speaks = []
    for a in sys.argv[1:]:
        k, v = a.split("=", 1)
        if k == "idle":
            pth, s, e = v.rsplit(":", 2)
            idle = (pth, int(s), int(e))
        elif k == "greeting":
            greet = v
        elif k == "speak":
            speaks.append(v)
    r = subprocess.run([sys.executable, os.path.join(HERE, "exits.py"), idle[0], str(idle[1]), str(idle[2])] + speaks + [greet], capture_output=True, text=True)
    print(r.stderr)
    res = {x["file"]: x for x in json.loads(r.stdout.strip().splitlines()[-1])}
    idle_frames = load(idle[0], idle[1], idle[2])
    encode(idle_frames, os.path.join(OUT, "idle.mp4"))
    xg = res[os.path.basename(greet)]
    g_fr = ramp_fix([A.warp(f, xg["align"]) for f in load(greet)])
    g_fr = sharp_match(tone_match(g_fr, idle_frames), idle_frames)
    f0 = next((i for i, v in enumerate(xg["md"]) if i > 0 and v > xg["thr"]), 0)   # og'iz birinchi ochiladigan kadr
    start = max(0, f0 - 2)                                                           # undan oldingi jim kutish kesiladi: og'iz va qo'l salom ovozi bilan birga boshlansin
    print(f"   salom: og'iz {f0}-kadrda ochiladi, boshidan {start} kadr ({start / 24:.2f} s) kesildi")
    g_fr = g_fr[start:]
    encode(g_fr, os.path.join(OUT, "greeting.mp4"))
    variants = []
    for i, pth in enumerate(speaks, 1):
        x = res[os.path.basename(pth)]
        name = f"speaking-{i:02d}.mp4"
        s_fr = ramp_fix([A.warp(f, x["align"]) for f in load(pth)])
        s_fr = sharp_match(tone_match(s_fr, idle_frames), idle_frames)
        s_fr, s_ok, _ = trim_pauses(s_fr, x["md"], x["pose"], x["thr"], x["ok"])
        encode(s_fr, os.path.join(OUT, name))
        dur = round(len(s_fr) / 24.0, 3)
        iv = ok_intervals(s_ok)
        gaps, last = [], 0.0
        for a_, b_ in iv:
            gaps.append(a_ - last)
            last = b_
        gaps.append(dur - last)
        mw = round(max(gaps), 2)
        ok = x["poseStart"] <= 1.5 and x["poseEnd"] <= 1.5 and iv and iv[0][0] == 0.0 and abs(iv[-1][1] - dur) < 0.1
        print(f"{name}: {dur} s, chiqish oraliqlari {len(iv)}, eng uzun kutish {mw} s, uchlari mos: {'HA' if ok else 'YOQ (qabul qilinmaydi!)'}")
        variants.append({"file": name, "duration": dur, "exits": iv})
    json.dump({"fps": 24, "speaking": {"variants": variants}}, open(os.path.join(OUT, "avatarClips.json"), "w"))
    print("tayyor:", OUT)


main()
