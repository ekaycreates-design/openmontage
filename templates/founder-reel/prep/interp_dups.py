"""Find duplicated frames (frozen source frames, dup after cuts) and replace them
with motion-interpolated frames (ffmpeg minterpolate, mci) between the neighbours.

usage: interp_dups.py <in.mp4> <out.mp4> [--thr 0.11]
"""
import argparse
import glob
import os
import shutil
import subprocess
import tempfile

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--thr", type=float, default=0.11)
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        fr = os.path.join(tmp, "f")
        os.makedirs(fr)
        subprocess.run(["ffmpeg", "-v", "error", "-i", a.inp, "-vsync", "0", os.path.join(fr, "f_%04d.png")], check=True)
        fs = sorted(glob.glob(os.path.join(fr, "f_*.png")))
        g = [cv2.resize(cv2.imread(f, 0), (180, 320)).astype(float) for f in fs]
        d = [9.9] + [np.abs(g[i] - g[i - 1]).mean() for i in range(1, len(g))]
        dups = [i for i in range(1, len(d) - 1) if d[i] < a.thr]
        runs = []
        for i in dups:
            if runs and i == runs[-1][-1] + 1:
                runs[-1].append(i)
            else:
                runs.append([i])
        for run in runs:
            lo, hi = run[0] - 1, run[-1] + 1
            if hi >= len(fs):
                continue
            gap = hi - lo
            w = os.path.join(tmp, f"i_{lo}")
            os.makedirs(w)
            for k, i in enumerate([lo, lo, hi, hi]):
                shutil.copy(fs[i], os.path.join(w, f"i_{k}.png"))
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(30 / gap), "-i", os.path.join(w, "i_%d.png"),
                            "-vf", "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1", "-vsync", "0",
                            os.path.join(w, "o_%03d.png")], check=True)
            outs = sorted(glob.glob(os.path.join(w, "o_*.png")))
            for k in range(1, gap):
                shutil.copy(outs[gap + k], fs[lo + k])
        print("interpolated runs:", [(r[0], len(r)) for r in runs])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", os.path.join(fr, "f_%04d.png"), "-i", a.inp,
                        "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "copy", a.out], check=True)


if __name__ == "__main__":
    main()
