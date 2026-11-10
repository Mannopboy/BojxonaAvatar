"""Tayyor javob kliplari: video O'Z OVOZI bilan (lab harakati shu ovozga yaratilgan — Higgsfield, audio_references = javob audiosi).

  python build_answers.py idle=gen/idle_a.mp4:24:120 airport=gen/answer_airport.mp4:../../answers/airport.wav rail=...

Har klip: afin moslash (align.py) -> bosh qulflash -> yuz moslash (optik oqim) -> yorqinlik/tiniqlik kutish klipiga -> x264 + AAC (o'sha audio).
Uzun jim oraliqlar QISQARTIRILMAYDI (audio bilan sinxronlik buzilmasin). Tekshiruv: og'iz ochilishi va audio balandligi orasidagi siljish (lag) o'lchanadi —
katta bo'lsa (> 0.12 s) audio shu qadar suriladi. Natija: out/answers/<id>.mp4 + out/answers/report.json.
"""
import json, os, subprocess, sys, wave
import cv2
import numpy as np
import align as A
import exits as E
import build_assets as B

OUT = os.path.join(B.OUT, "answers")


def envelope(wav_path, fps=24.0):
    w = wave.open(wav_path)
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    sr = w.getframerate()
    n = int(sr / fps)
    return np.array([np.sqrt(np.mean(a[i:i + n] ** 2)) for i in range(0, len(a) - n + 1, n)]), len(a) / sr


def best_lag(md, env, thr, max_lag=8):
    """Og'iz ochiqligi (md > thr) va ovoz borligi (env > 0.02) orasidagi eng yaxshi siljish (kadr): musbat — og'iz ovozdan KECH."""
    m = (np.asarray(md) > thr).astype(np.float32)
    e = (env > 0.02).astype(np.float32)
    n = min(len(m), len(e))
    m, e = m[:n], e[:n]
    best = (-1.0, 0)
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            a, b = m[lag:], e[:n - lag]
        else:
            a, b = m[:n + lag], e[-lag:]
        sc = float((a == b).mean())
        if sc > best[0]:
            best = (sc, lag)
    return best


def main():
    os.makedirs(OUT, exist_ok=True)
    idle = None
    items = []
    for a in sys.argv[1:]:
        k, v = a.split("=", 1)
        if k == "idle":
            pth, s, e = v.rsplit(":", 2)
            idle = (pth, int(s), int(e))
        else:
            vid, wav = v.split(":", 1) if ":" in v[2:] else (v, None)
            items.append((k, vid, wav))
    ctx = E.prepare(idle[0], idle[1], idle[2])
    idle_frames = B.load(idle[0], idle[1], idle[2])
    report = {}
    for name, vid, wav in items:
        raw = B.load(vid)
        n = len(raw)
        g0 = [A.gray(f) for f in raw]
        p = A.fit(ctx["home"], ctx["ref"], g0, [0, n - 1])
        aff = [A.warp(f, p) for f in raw]
        rel, pose0, md0, ok0 = E.measure(ctx, [A.gray(f) for f in aff])
        stab = B.stabilize(aff, [[float(a), float(b)] for a, b in rel])
        _, _, _, ok1 = E.measure(ctx, [A.gray(f) for f in stab])
        fr = B.ramp_fix(B.flow_align(stab, ctx["home"], ok1))
        fr = B.sharp_match(B.tone_match(fr, idle_frames), idle_frames)
        _, pose, md, okm = E.measure(ctx, [A.gray(f) for f in fr])
        env, adur = envelope(wav)
        score, lag = best_lag(md, env, ctx["thr"])
        speech = np.where(env > 0.02)[0]
        s0, s1 = speech[0] / 24.0, (speech[-1] + 1) / 24.0
        mopen = np.where(np.asarray(md) > ctx["thr"])[0]
        m0, m1 = (mopen[0] / 24.0, (mopen[-1] + 1) / 24.0) if len(mopen) else (0, 0)
        tmp = os.path.join(OUT, name + "_v.mp4")
        B.encode(fr, tmp)
        dst = os.path.join(OUT, name + ".mp4")
        shift = lag / 24.0 if abs(lag) >= 3 else 0.0   # og'iz ovozdan >= 0.125 s kech/erta bo'lsa audio shu qadar suriladi
        cmd = [B.FF, "-v", "error", "-y", "-i", tmp]
        if shift > 0:
            cmd += ["-itsoffset", f"{shift:.3f}"]
        cmd += ["-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-t", f"{len(fr) / 24.0:.3f}", "-movflags", "+faststart", dst]
        subprocess.run(cmd, check=True)
        os.remove(tmp)
        info = {
            "frames": len(fr), "duration": round(len(fr) / 24.0, 3), "audio": round(adur, 3),
            "speech": [round(s0, 2), round(s1, 2)], "mouthOpen": [round(m0, 2), round(m1, 2)],
            "lipLagFrames": lag, "lipMatch": round(score, 2), "audioShift": round(shift, 3),
            "poseStart": round(float(pose[0]), 2), "poseEnd": round(float(pose[-1]), 2), "poseMean": round(float(pose.mean()), 2),
            "mouthStart": round(float(md[0]), 1), "mouthEnd": round(float(md[-1]), 1), "closedThr": round(ctx["thr"], 2),
        }
        report[name] = info
        ok = info["poseStart"] <= 1.5 and info["poseEnd"] <= 1.5 and info["mouthStart"] <= ctx["thr"] and info["mouthEnd"] <= ctx["thr"] and score >= 0.7
        print(f"{name}: {info} -> {'QABUL' if ok else 'TEKSHIRISH KERAK'}")
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
