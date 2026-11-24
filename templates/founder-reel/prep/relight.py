"""Studio 'premium nude' relight for founder-reel footage.

Per frame (720x1280, ungraded footage):
  * person matte (bg_remove) splits subject / background
  * background: mint wall -> warm greige, slightly darker, soft radial falloff;
    products on the shelf are protected so their colour stays true
  * subject: soft key light that follows the face (MediaPipe landmarks), gentle
    shadow lift, warmer skin with a little less redness (colour only, no smoothing)
  * whole frame: soft highlight glow + gentle filmic curve

usage: relight.py <in.mp4> <mask_dir> <out.mp4> [--frames i,j,k --stills dir]
"""
import argparse
import glob
import os
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[3]))

W, H = 720, 1280


def lab_split(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)  # float32 in: L 0..100, a/b ~ -127..127
    return lab[..., 0], lab[..., 1], lab[..., 2]


def curve(x, lift=0.03, gain=1.0, gamma=1.0):
    x = np.clip(x, 0, 1)
    return np.clip(lift + (1 - lift) * gain * np.power(x, gamma), 0, 1)


# products region (source coordinates, 720x1280) — keep true colour (adjust per footage)
PROTECT = (40, 690, 250, 850)


def build_static():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # radial falloff for the background
    r = np.sqrt(((xx - W * 0.55) / (W * 0.75)) ** 2 + ((yy - H * 0.40) / (H * 0.70)) ** 2)
    falloff = np.clip(1.0 - 0.22 * r ** 2, 0.72, 1.0)
    prot = np.zeros((H, W), np.float32)
    x0, y0, x1, y1 = PROTECT
    prot[y0:y1, x0:x1] = 1.0
    prot = cv2.GaussianBlur(prot, (0, 0), 14)
    return xx, yy, falloff, prot


def relight(frame_bgr, mask, face, static):
    xx, yy, falloff, prot = static
    img = frame_bgr.astype(np.float32) / 255.0

    # --- global warm balance + gentle desat ("nude" base)
    img[..., 2] *= 1.025  # R
    img[..., 0] *= 0.965  # B
    img = np.clip(img, 0, 1)

    m = cv2.resize(mask, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    m = cv2.erode(m, np.ones((3, 3), np.uint8), iterations=1)
    m = cv2.GaussianBlur(np.clip(m * 1.15, 0, 1), (0, 0), 3.0)[..., None]

    L, A, B = lab_split(img)

    # --- background grade: greige, a touch darker, radial falloff.
    # Hue shift is colour-selective: mint/grey wall & sofa pixels become greige
    # (also inside the soft matte edge, so no mint fringe around hair), while
    # yellow-olive pixels (product labels, wooden shelf) keep their true colour.
    mm = m[..., 0]
    protect = np.clip((B - 10.0) / 8.0, 0, 1)
    wall = np.clip(-A / 3.0, 0, 1) * np.clip((L - 52.0) / 10.0, 0, 1) * (1 - protect)
    hue_w = np.maximum((1 - mm) * (1 - protect), wall)
    bgA = A * 0.28 + 3.4
    bgB = B * 0.30 + 11.0
    A2 = A * (1 - hue_w) + bgA * hue_w
    B2 = B * (1 - hue_w) + bgB * hue_w
    bgL = L * 0.95 * falloff

    # --- subject grade: key light following the face
    fx, fy, fw = face
    d = np.sqrt(((xx - fx) / (fw * 1.25)) ** 2 + ((yy - (fy - fw * 0.1)) / (fw * 1.55)) ** 2)
    key = np.exp(-(d ** 2) * 1.1)  # 1 at face centre
    sL = L / 100.0
    sL = curve(sL, lift=0.025, gain=1.0, gamma=0.97)
    sL = sL * (1 + 0.13 * key) + 0.025 * key * (1 - sL)  # brighter + softer shadows on the face
    sL = np.clip(sL, 0, 1) * 100.0

    Lo = sL * mm + bgL * (1 - mm)
    Ao = (A2 * (1 - 0.10 * key)) * mm + A2 * (1 - mm)
    Bo = (B2 + 1.6 * key) * mm + B2 * (1 - mm)
    out = cv2.cvtColor(np.dstack([Lo, Ao, Bo]).astype(np.float32), cv2.COLOR_LAB2BGR)
    out = np.clip(out, 0, 1)

    # --- soft highlight glow
    lum = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    hi = np.clip((lum - 0.62) / 0.38, 0, 1)[..., None] * out
    glow = cv2.GaussianBlur(hi, (0, 0), 22)
    out = 1 - (1 - out) * (1 - 0.10 * glow)

    # --- gentle filmic curve, rich but not crushed blacks
    out = curve(out, lift=0.018, gain=0.985, gamma=1.02)
    return (np.clip(out, 0, 1) * 255.0 + 0.5).astype(np.uint8)


class FaceTrack:
    """Smoothed face centre/width from MediaPipe landmarks (Tasks API)."""

    def __init__(self, fps):
        import mediapipe as mp
        from tools.enhancement.eye_enhance import _open_face_mesh

        self.mp = mp
        self.ctx = _open_face_mesh(mp)
        self.detect = self.ctx.__enter__()
        self.fps = fps
        self.state = None
        self.i = 0

    def __call__(self, bgr):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        lm = self.detect(rgb, int(self.i * 1000 / self.fps))
        self.i += 1
        if lm is not None:
            xs = np.array([p.x for p in lm.landmark]) * W
            ys = np.array([p.y for p in lm.landmark]) * H
            cur = np.array([xs.mean(), ys.mean(), xs.max() - xs.min()])
        else:
            cur = self.state if self.state is not None else np.array([W * 0.55, H * 0.48, W * 0.28])
        self.state = cur if self.state is None else self.state * 0.7 + cur * 0.3
        return tuple(self.state)

    def close(self):
        self.ctx.__exit__(None, None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("mask_dir")
    ap.add_argument("out")
    ap.add_argument("--frames", default="")
    ap.add_argument("--stills", default="")
    a = ap.parse_args()

    masks = sorted(glob.glob(os.path.join(a.mask_dir, "m_*.png")))
    want = {int(x) for x in a.frames.split(",") if x}
    cap = cv2.VideoCapture(a.inp)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    static = build_static()
    track = FaceTrack(fps)
    writer = None
    if not want:
        writer = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
             "-r", str(fps), "-i", "-", "-i", a.inp, "-map", "0:v", "-map", "1:a", "-c:v", "libx264",
             "-crf", "12", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", a.out],
            stdin=subprocess.PIPE,
        )
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        face = track(fr)
        if want and i not in want:
            i += 1
            continue
        mk = cv2.imread(masks[min(i, len(masks) - 1)], 0)
        out = relight(fr, mk, face, static)
        if want:
            cv2.imwrite(os.path.join(a.stills, f"lit_{i:04d}.png"), np.hstack([fr, out]))
        else:
            writer.stdin.write(out.tobytes())
        i += 1
        if i % 100 == 0:
            print(f"[relight] {i} frames", flush=True)
    track.close()
    if writer:
        writer.stdin.close()
        writer.wait()
    print("DONE", i, flush=True)


if __name__ == "__main__":
    main()
