"""Low-res person mattes for every frame of a video (drives the relight).

usage: mattes.py <video.mp4> <work_dir>    -> <work_dir>/mask/m_NNNN.png
Uses the registry's bg_remove tool (rembg u2net_human_seg, session reused).
"""
import glob
import os
import subprocess
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from tools.tool_registry import registry  # noqa: E402


def main(video: str, work: str) -> None:
    registry.discover()
    src, dst = Path(work) / "mask_src", Path(work) / "mask"
    src.mkdir(parents=True, exist_ok=True)
    dst.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", "scale=360:640", str(src / "m_%04d.png")], check=True)
    tool = registry._tools["bg_remove"]
    t0 = time.time()
    frames = sorted(glob.glob(str(src / "m_*.png")))
    for k, f in enumerate(frames):
        out = dst / os.path.basename(f)
        if out.exists():
            continue
        tmp = str(out) + ".rgba.png"
        r = tool.execute({"input_path": f, "output_path": tmp, "model": "u2net_human_seg"})
        if not r.success:
            print("FAIL", f, r.error, flush=True)
            continue
        cv2.imwrite(str(out), cv2.imread(tmp, cv2.IMREAD_UNCHANGED)[:, :, 3])
        os.remove(tmp)
        if (k + 1) % 50 == 0:
            print(f"{k + 1}/{len(frames)} {time.time() - t0:.0f}s", flush=True)
    print("DONE", len(frames), round(time.time() - t0), flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
