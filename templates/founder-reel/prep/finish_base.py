"""After relight + upscale: blend 60/40 ESRGAN/lanczos, analyse cuts/dissolves, rebuild hook cutouts.

usage: finish_base.py <project_dir> <video_work_dir>
  expects <work>/esr_1440.mp4 and <work>/lit_106.mp4; writes <work>/base_v2_1440.mp4,
  <work>/analysis.json and <project>/public/person/p_NNN.webp
"""
import glob
import json
import os
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[3]))
from tools.tool_registry import registry  # noqa: E402

registry.discover()
P = sys.argv[1].rstrip("/") + "/"
V = sys.argv[2].rstrip("/") + "/"
base = V + "base_v2_1440.mp4"

# 1) gentle upscale: 60% Real-ESRGAN (texture-preserving) + 40% lanczos, light CAS
subprocess.run([
    "ffmpeg", "-v", "error", "-y", "-i", V + "esr_1440.mp4", "-i", V + "lit_106.mp4",
    "-filter_complex",
    "[1:v]scale=1440:2560:flags=lanczos,format=yuv420p[lz];[0:v]format=yuv420p[es];"
    "[es][lz]blend=all_mode=normal:all_opacity=0.6,cas=0.15[v]",
    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-crf", "14", "-preset", "medium",
    "-pix_fmt", "yuv420p", "-c:a", "copy", base,
], check=True)
print("blend ok", flush=True)


def gray_frames(path, size=(180, 320)):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={size[0]}:{size[1]},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, size[1], size[0]).astype(float)


# 2) jump cuts + dissolves (sharpness dips on the face region)
f = gray_frames(base)
d = np.array([0] + [np.abs(f[i] - f[i - 1]).mean() for i in range(1, len(f))])
cuts = [i for i in range(1, len(d)) if d[i] > 3 and d[i] > 2.5 * np.median(d[max(0, i - 5):i + 5])]
face = gray_frames(base, (360, 640))[:, 200:500, 90:330]
sh = np.array([cv2.Laplacian(x, cv2.CV_64F).var() for x in face])
med = np.median(sh)
dips = [i for i in range(len(sh)) if sh[i] < 0.75 * med]
groups = []
for i in dips:
    if groups and i - groups[-1][-1] <= 2:
        groups[-1].append(i)
    else:
        groups.append([i])
res = {"frames": len(f), "cuts": cuts, "dissolves": [(g[0], g[-1]) for g in groups if len(g) >= 3]}
json.dump(res, open(V + "analysis.json", "w"))
print("analysis", res, flush=True)

# 3) hook cutouts (person in front of the "55"): new alpha on the new base frames
os.makedirs(V + "hook_src", exist_ok=True)
os.makedirs(V + "hook_hi", exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-t", "1.85", "-vf", "scale=720:1280",
                V + "hook_src/h_%03d.png"], check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-t", "1.85", V + "hook_hi/h_%03d.png"], check=True)
pub = P + "public/person"
for old in glob.glob(pub + "/p_*.webp"):
    os.remove(old)
t = registry._tools["bg_remove"]
srcs = sorted(glob.glob(V + "hook_src/h_*.png"))
for k, src in enumerate(srcs):
    tmp = V + f"hook_src/a_{k:03d}.png"
    r = t.execute({"input_path": src, "output_path": tmp, "model": "u2net_human_seg"})
    if not r.success:
        print("FAIL", src, r.error)
        continue
    a = cv2.imread(tmp, cv2.IMREAD_UNCHANGED)[:, :, 3]
    a = cv2.erode(a, np.ones((3, 3), np.uint8), iterations=2)
    a = cv2.resize(a, (1440, 2560), interpolation=cv2.INTER_CUBIC)
    a = cv2.GaussianBlur(a, (0, 0), 2.0)
    hi = cv2.imread(V + f"hook_hi/h_{k + 1:03d}.png")
    cv2.imwrite(f"{pub}/p_{k:03d}.webp", np.dstack([hi, a]), [cv2.IMWRITE_WEBP_QUALITY, 92])
print("hook cutouts", len(srcs), flush=True)
print("POST DONE", flush=True)
