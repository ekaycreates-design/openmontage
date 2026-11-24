# Founder Reel template

Props-driven Remotion composition for a **series** of founder-led reels (premium beauty,
wellness, small DTC brands). The format, beat grammar and production recipe are in
[`skills/creative/founder-reel-format.md`](../../skills/creative/founder-reel-format.md).

Brand-specific material (logo, product PNGs, palette values, positioning notes, footage)
belongs in the project folder (`projects/<brand>-epNN/`, gitignored) — this folder stays
brand-agnostic.

## Files

| File | What |
|------|------|
| `FounderReel.tsx` | the composition (`FounderReel`): hook word behind the founder, name title, captions, inserts (`product`, `stock`, `molecule`, `texture`), ring annotation, zoom-blur transitions, light leaks, arch wipe, logo end card |
| `Root.tsx`, `index.tsx` | Remotion entry |
| `build_fonts.py` | downloads Cormorant Garamond + Jost (OFL, latin) and writes `fonts.ts` (base64) into a project |
| `prep/text_mask.py` | mask for burned-in captions/overlays (max/min deviation over all frames) |
| `prep/interp_dups.py` | replaces duplicated frames with motion-interpolated ones |
| `prep/mattes.py` | low-res person mattes for every frame (registry `bg_remove`) |
| `prep/relight.py` | studio "premium nude" relight: matte-split grade, colour-selective wall shift, face-tracked key light |
| `prep/finish_base.py` | blends ESRGAN/lanczos, finds cuts + dissolves, rebuilds hook cutouts |

## New episode, step by step

```bash
SLUG=brand-ep04; P=projects/$SLUG
python -c "from lib.checkpoint import init_project; init_project('$SLUG', title='…', pipeline_type='talking-head')"
cp templates/founder-reel/{index.tsx,Root.tsx,FounderReel.tsx} $P/
python templates/founder-reel/build_fonts.py $P
# public/: grain.png, product PNG(s), logo (brand colour) + logo_white, stock media
```

Prep scripts work at 720×1280 (typical phone export) — scale other footage to that first.

Then follow the production recipe (transcribe → text mask → glow-up tools → cut →
`prep/interp_dups.py` → speed → `prep/mattes.py` → `prep/relight.py` → `upscale`
→ `prep/finish_base.py`), write `artifacts/props.json` from the measured timeline, and render:

```python
from tools.video.video_compose import VideoCompose
VideoCompose().execute({
  "operation": "render", "output_path": f"{P}/renders/video_voice.mp4",
  "edit_decisions": {"render_runtime": "remotion", "composition_mode": "atelier", "cuts": [],
    "bespoke": {"entry": f"{P}/index.tsx", "composition_id": "FounderReel",
                "props_path": f"{P}/artifacts/props.json", "public_dir": f"{P}/public",
                "art_direction": "skills/creative/founder-reel-format.md", "crf": 16, "concurrency": 3}},
  "remotion_browser_executable": "/opt/pw-browsers/chromium_headless_shell",  # when Chrome can't be downloaded
})
```

Mix with `audio_mixer` `full_mix` (pass `target_duration` = full length so music survives the
end card) and mux / encode with `video_compose`.

## Props (shape)

```jsonc
{
  "fps": 30, "durationSeconds": 14.0,
  "brand": { "ink": "#1F2420", "cream": "#F3ECE4", "creamDeep": "#E8DED3",
             "accent": "#<brand colour>", "accentSoft": "#<pale brand tint>", "taupe": "#6E6157",
             "hairline": "#B49A5A", "archFill": ["#FAF4EC", "#EADCCD", "#DDCAB7"],
             "logo": "logo.png", "logoLight": "logo_white.png" },
  "baseVideo": "base.mp4", "baseEndSeconds": 12.43, "face": { "fx": 0.55, "fy": 0.485 },
  "shots": [{ "id": "SH1", "start": 0, "end": 1.0, "z0": 1.18, "z1": 1.24, "sx": 0.5, "sy": 0.58 }],
  "transitions": [{ "start": 0.86, "end": 1.2 }],
  "leaks": [{ "at": 3.5, "dur": 0.7, "seed": 3 }],
  "hook": { "kicker": "SERIES · EPISODE 3", "text": "moda", "italic": true, "fontSize": 560,
            "in": 0.2, "out": 0.95, "cx": 0.53, "cy": 0.29, "strikeAt": 0.7 },
  "person": { "prefix": "person/p_", "ext": ".webp", "frames": 56, "until": 1.0 },
  "nameTitle": { "name": "Name", "role": "FOUNDER OF BRAND", "in": 1.05, "out": 2.4 },
  "captions": [{ "start": 0, "end": 1.0, "words": [{ "text": "No", "start": 0.05, "kw": false }] }],
  "captionHide": [[1.0, 2.4]],
  "inserts": [
    { "type": "stock", "start": 1.9, "end": 3.5, "media": "video", "src": "vineyard.mp4",
      "lines": [{ "text": "extracto de", "at": 1.95, "style": "kicker" }], "logoAt": 3.0 },
    { "type": "molecule", "molecule": "resveratrol", "start": 4.2, "end": 5.9, "bg": "splash.jpg",
      "lines": [{ "text": "resveratrol", "at": 4.4, "style": "hero" }] },
    { "type": "product", "start": 8.2, "end": 10.2, "image": "serum.png", "imageSize": [571, 1400],
      "iconY": 1213, "lines": [], "chips": [] }
  ],
  "archWipe": { "start": 12.2, "dur": 0.42 },
  "endCard": { "start": 12.55, "episode": "SERIES · EPISODE 3", "question": "…?" }
}
```
