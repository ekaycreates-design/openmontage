"""Mask for burned-in captions / overlays in client footage (for ffmpeg removelogo).

Captions often appear word by word, so the mask is built from the per-pixel
max/min deviation over ALL frames (sampling at 1 fps misses words).

usage: text_mask.py <raw.mp4> <out_mask.png> --band y0 y1 x0 x1 [--box y0 y1 x0 x1 ...]
  --band : flat-wall region with captions (bright fill or dark outline vs wall)
  --box  : overlay on clothing etc. (consistently brighter than its local surroundings)
"""
import argparse
import subprocess

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("out")
    ap.add_argument("--band", nargs=4, type=int, action="append", default=[])
    ap.add_argument("--box", nargs=4, type=int, action="append", default=[])
    a = ap.parse_args()
    w, h = map(int, subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
                                    "-of", "csv=p=0", a.raw], capture_output=True, text=True).stdout.strip().split(","))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", a.raw, "-vf", "format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, h, w)
    med = np.median(f[::6], axis=0).astype(np.float32)
    mx, mn = f.max(axis=0).astype(np.float32), f.min(axis=0).astype(np.float32)
    mask = np.zeros((h, w), np.uint8)
    for y0, y1, x0, x1 in a.band:
        wall = np.median(med[y0:y1, x0:x1])
        mask[y0:y1, x0:x1] |= (((mx[y0:y1, x0:x1] > wall + 22) | (mn[y0:y1, x0:x1] < wall - 28)) * 255).astype(np.uint8)
    for y0, y1, x0, x1 in a.box:
        reg = med[y0:y1, x0:x1]
        loc = cv2.medianBlur(reg.astype(np.uint8), 31).astype(np.float32)
        mask[y0:y1, x0:x1] |= (((reg - loc) > 14) * 255).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), 1)
    cv2.imwrite(a.out, mask)
    print("mask px", int((mask > 0).sum()))


if __name__ == "__main__":
    main()
