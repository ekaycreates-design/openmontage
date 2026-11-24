# Founder Reel — a repeatable reel format for founder-led beauty & wellness brands

## When to use

The brand has a real founder who talks to camera in short clips (10–30 s), the
product is premium or "quiet luxury", and the client wants a **series** that can be
produced on a cadence ("episode N every week") without re-inventing the look each time.

Typical brief: mid+/premium skincare or wellness brand, audience 25–35 into wellness,
natural beauty, pilates / clean-girl aesthetics; founder older than the audience, so her
real skin and her story are the proof. The founder footage is shot on a phone, often
already edited by someone else (burned-in captions, overlays, dissolve jump-cuts).

This is a **templated** format on purpose: batch output for one brand is exactly where
the guide prefers templated over atelier. The creative work happens once (brand kit +
template); each episode is data (props) plus footage prep.

Runtime: Remotion, project-local template at `templates/founder-reel/`
(`FounderReel` composition, rendered through `video_compose` atelier mode).
Pipeline: `talking-head`.

## The format

Name the series and keep the name on every episode (e.g. "Behind <Brand> · Episode N").
Length 12–22 s. Vertical 1080×1920, 30 fps, −14 LUFS.

### Beat grammar

| Beat | Time | What happens | Template element |
|------|------|--------------|------------------|
| **Hook** | 0–1.8 s | The strongest line is moved to the front (cut order ≠ shooting order). One oversized word or number is set *behind* the founder (segmentation cutout): a number ("55"), or a word that is negated with a brand-colour strike ("~~moda~~"). Series kicker at the top. | `hook`, `person` cutouts |
| **ID** | next 1–1.5 s | Founder name + role in the headroom, only once per episode. | `nameTitle` |
| **Body** | 6–14 s | Talking head, framing change on every cut (wide / medium / close), slow push inside each shot. 1–3 inserts, each tied to a spoken word. | `shots`, `inserts`, `captions` |
| **Proof line** | 2–3 s | The belief sentence ("really works", "my real skin") on her close-up, keyword styled. | captions `kw` |
| **End card** | last 1.5 s | Arch wipe → brand logo, series + episode, one question that seeds the next episode. | `archWipe`, `endCard` |

### Insert library (pick by what she says)

| She talks about… | Insert | Notes |
|---|---|---|
| a product | `product` — cut-out PNG standing in front of an arch, contact shadow, slow float, ingredient chips copied from the label | always the client's real PNG, never a generated product |
| an ingredient's origin (grape, oat, rose…) | `stock` — full-bleed free stock media of the source, slow zoom, white serif type, optional light logo | prefer **macro with condensation / water drops** on a dark or warm background; grade off-palette hues (e.g. green foliage or bokeh) toward the brand palette — or pick another shot; Pixabay/Pexels licence (commercial, no attribution); never AI-generated imagery |
| a molecule / active (resveratrol…) | `molecule` — line drawing of the real structure that draws itself over a dark macro photo | only chemically correct structures |
| texture / sensoriality | `texture` — procedural cream macro + serif words | abstract; never presented as product footage |
| her own shelf in shot | `ring` — hand-drawn ring around the real products in the frame | |

Rules: one insert per idea, ≤ 3 per episode, an insert replaces the captions for the
words it shows (never captions + the same words twice), inserts are the natural place to
hide the client's own dissolve cuts.

### Visual system (per brand, stored in the brand kit)

- `accent` = brand colour (e.g. the logo colour) — used on light surfaces only.
- `accentSoft` = pale brand tint (e.g. label colour) — keywords on top of footage.
- Creams in a "premium nude" range for cards and end card; arch fill in warm nude so the
  product label pops.
- Type: one elegant serif for emotion (Cormorant Garamond italic), one geometric sans for
  structure and captions (Jost). Captions white with soft shadow, 2–4 words per page,
  word-by-word reveal, keywords in serif italic `accentSoft`.
- Footage look ("honest glow-up" + "premium nude" studio relight): see prep below.
  No skin smoothing, no face restoration on the founder — her skin is the proof of the
  product, retouching it is misleading for a skincare brand.
- Audio identity: the same music track family every episode + one shimmer sting on the
  hook word and the logo; soft whooshes on inserts.

## Production recipe (per episode)

1. **Ingest** the clip into `projects/<brand>-epNN/assets/source/raw.mp4`; probe; contact sheet.
2. **Transcribe** with `transcriber` (Whisper medium, language set). Cross-check against any
   burned-in captions — they are the brand's own spelling (names, brand name, "viña" vs "vino").
3. **Burned text removal**: mask from the per-pixel max/min deviation over *all* frames
   (captions change word by word — sampling at 1 fps misses some), plus shirt overlays;
   apply with `face_enhance` `custom_vf` = `removelogo=<mask>,` + presets.
4. **Honest glow-up**: `face_enhance` presets `denoise, brighten, sharpen_light`;
   `eye_enhance` `brighten_eyes, sharpen_eyes` (0.25 / 0.3).
5. **Scan the source** for dissolve jump-cuts (sharpness dips on the face) and duplicate
   frames (frame diff ≈ 0). Plan to cover every dissolve with an insert or a zoom-blur
   transition; never with a freeze frame.
6. **Cut plan**: hook line first, then story order; cut at audio minima; `video_trimmer`
   `cut` (frame-accurate, re-encoded) per segment, then `concat`. Motion-interpolate the
   duplicate frames (ffmpeg `minterpolate` mci between the neighbours). `video_trimmer`
   `speed` 1.06.
7. **Mattes**: `bg_remove` (u2net_human_seg) on 360×640 frames for the whole cut.
8. **Studio "premium nude" relight** (`prep/relight.py`): matte-split grade — wall shifted
   to warm greige/sand colour-selectively (product labels and wood keep their colour, no
   mint fringe around hair), face-tracked soft key light, a little less redness, soft
   highlight glow.
9. **Mild upscale**: `upscale` model `realesr-general-x4v3`, scale 2, denoise 0.25
   (bf16 on AMX CPUs ≈ 4 s/frame), blended 60/40 with lanczos + light CAS.
10. **Hook cutouts**: re-matte the hook frames at 720p, eroded + feathered alpha, RGBA webp.
11. **Measure the real timeline** on the final base: cut frames, remaining dissolves,
    re-transcribe for word timings; build `props.json` from data, not estimates.
12. **Inserts**: product PNG; stock via the brand's licensed source (keyed Pixabay/Pexels
    tools, or a keyless project script when no key is configured — log it); upscale crops
    with `upscale`.
13. **Render** `FounderReel` via `video_compose` (atelier path, `remotion_browser_executable`
    when the bundled Chrome cannot be downloaded); review stills first.
14. **Audio**: `audio_mixer` `full_mix` — speech + music (ducked, `target_duration` = full
    length so the music survives the end card) + SFX; `loudnorm_target` −14.
15. **QA**: `visual_qa` probe (1080×1920, yuv420p), freeze scan on talking shots, A/V offset
    at joins (< 45 ms), residual burned-text scan, review frames.
16. **Export**: video, cover (hook frame), caption + hashtags, SRT, metadata.

## Filming brief for the founder (send to the client once)

The biggest speed and quality gain is footage that does not need repair:

- Send the **raw clip**: no burned captions, no overlays, no dissolves between takes.
- Vertical, 1080p or 4K, 30 fps; phone at eye level; chest-up with a hand of headroom.
- Soft window light at 45°, plain wall a step behind her; lavalier mic.
- One idea per clip, 15–30 s; say the hook line twice in different energies.
- 1 s of silence before and after each take.
- Monthly B-roll batch (reused across episodes): hands applying the product, dropper drip
  macro, texture on fingers, product on linen/stone in daylight, morning ritual moments.

## Content pillars (rotate)

Origin story · Ingredient (one per episode) · Ritual / how she uses it · Myth vs truth
("I didn't choose it for trends") · Texture · Answers to last episode's question.

## Review checklist

- Hook word visible in the first second, founder in front of it.
- Every cut changes framing or subject; no shot holds longer than ~3 s.
- No caption duplicates text an insert shows.
- No freeze, no visible dissolve, no residual burned text.
- Brand colours only; product shown is the real product; no retouched skin.
- Music present on the end card; −14 LUFS; peak ≤ −1 dBFS.
