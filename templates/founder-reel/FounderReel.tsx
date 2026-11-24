import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import { FONT_DATA } from "./fonts";

// ============================================================================
// FOUNDER REEL — series template for founder-led premium beauty brands.
//
// One composition, driven entirely by props (artifacts/props.json): brand
// palette + logo, the founder footage with per-shot camera moves, a hook word
// set behind the founder (segmentation cutouts), captions, and a list of
// inserts (product hero, stock media, ingredient molecule, texture macro).
// See templates/founder-reel/README.md and skills/creative/founder-reel-format.md.
// ============================================================================

// ---------------------------------------------------------------- fonts ----
// Cormorant Garamond + Jost (OFL) embedded as base64 in ./fonts.ts (generate
// with build_fonts.py). The render browser cannot reach Google Fonts through
// the proxy here, and the Scene holds the first frame until the faces decode.
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const toBuffer = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};
const FONTS_READY: Promise<void> =
  typeof document === "undefined"
    ? Promise.resolve()
    : Promise.all(
        FONT_DATA.map(async (f) => {
          const ff = new FontFace(f.family, toBuffer(f.b64), { style: f.style, weight: f.weight });
          await ff.load();
          document.fonts.add(ff);
        }),
      )
        .then(() => undefined)
        .catch((err) => console.error("font load failed", err));

const W = 1080;
const H = 1920;

// ---------------------------------------------------------------- types ----
type Shot = { id: string; start: number; end: number; z0: number; z1: number; sx: number; sy: number };
type CapWord = { text: string; start: number; kw: boolean };
type Page = { start: number; end: number; words: CapWord[] };
type Line = { text: string; at: number; style: "kicker" | "hero" | "second"; icon?: "drop" | "leaf" };
type Chip = { at: number; side: "left" | "right"; title: string; sub: string; x?: number; y?: number };
type Shape = "arch" | "circle";

export type Brand = {
  ink: string; // dark text
  cream: string; // light card background
  creamDeep: string;
  accent: string; // brand colour (e.g. the logo colour) — used on light surfaces
  accentSoft: string; // pale brand tint (label sage) — keywords on footage
  taupe: string; // secondary text on light surfaces
  hairline: string; // thin decorative lines
  archFill: [string, string, string]; // product-card arch gradient
  logo?: string; // public path, transparent PNG (brand colour)
  logoLight?: string; // public path, white logo for dark media
  shape?: Shape; // signature frame used by product card, end card and wipe (default "arch")
};

type ProductItem = { image: string; imageSize: [number, number]; height: number; cx: number; bottom: number; delay?: number };
type ProductInsert = {
  type: "product"; start: number; end: number;
  image?: string; imageSize?: [number, number]; iconY?: number; // single product (legacy)
  products?: ProductItem[]; // several products, drawn back to front
  backdrop?: Shape; circle?: { d: number; cx?: number; cy: number }; textTop?: number; lines: Line[]; chips: Chip[];
};
type StockInsert = {
  type: "stock"; start: number; end: number; media: "video" | "image"; src: string; startFrom?: number;
  zoom?: [number, number]; focus?: [number, number]; lines: Line[]; logoAt?: number; textTop?: number;
};
type MoleculeInsert = {
  type: "molecule"; start: number; end: number; molecule: "resveratrol"; bg?: string; lines: Line[];
  moleculeTop?: number; textTop?: number;
};
type TextureInsert = { type: "texture"; start: number; end: number; lines: Line[] };
type Insert = ProductInsert | StockInsert | MoleculeInsert | TextureInsert;

export interface FounderReelProps {
  [key: string]: unknown;
  fps: number;
  durationSeconds: number;
  brand: Brand;
  baseVideo: string;
  baseEndSeconds: number;
  face: { fx: number; fy: number };
  shots: Shot[];
  transitions: { start: number; end: number }[];
  leaks: { at: number; dur: number; seed: number }[];
  hook: {
    kicker: string; text: string; italic?: boolean; fontSize: number; in: number; out: number;
    cx: number; cy: number; strikeAt?: number; lining?: boolean;
  };
  person: { prefix: string; ext: string; frames: number; until: number };
  nameTitle?: { pre?: string; name: string; role: string; in: number; out: number; top?: number };
  captions: Page[];
  captionHide: [number, number][];
  ring?: { start: number; end: number; cx: number; cy: number; rx: number; ry: number; rot: number };
  inserts: Insert[];
  archWipe: { start: number; dur: number };
  endCard: { start: number; logo?: string; wordmark?: string; episode: string; question: string };
}

// -------------------------------------------------------------- helpers ----
const clamp01 = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
const easeIn = Easing.bezier(0.7, 0, 0.84, 0);
const ramp = (t: number, a: number, b: number, ease = easeOut) =>
  interpolate(t, [a, b], [0, 1], { ...clamp01, easing: ease });

const shotAt = (shots: Shot[], t: number): Shot =>
  shots.find((s) => t >= s.start && t < s.end) ?? shots[shots.length - 1];

// Camera: scale by z, place the face at (sx, sy) of the screen, never show an edge.
const camera = (shot: Shot, t: number, face: { fx: number; fy: number }) => {
  const p = interpolate(t, [shot.start, shot.end], [0, 1], { ...clamp01, easing: Easing.inOut(Easing.sin) });
  const z = shot.z0 + (shot.z1 - shot.z0) * p;
  let x = shot.sx * W - face.fx * W * z;
  let y = shot.sy * H - face.fy * H * z;
  x = Math.min(0, Math.max(W - W * z, x));
  y = Math.min(0, Math.max(H - H * z, y));
  return { x, y, z };
};

// ------------------------------------------------------------ film layer ----
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const ox = Math.floor(random(`gx${frame}`) * 110);
  const oy = Math.floor(random(`gy${frame}`) * 110);
  return (
    <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: 0.07, pointerEvents: "none" }}>
      <Img src={staticFile("grain.png")} style={{ position: "absolute", left: -ox, top: -oy, width: 1200, height: 2040 }} />
    </AbsoluteFill>
  );
};

const Daylight: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ background: "radial-gradient(120% 70% at 8% 18%, rgba(255,232,196,0.14) 0%, rgba(255,232,196,0.04) 45%, rgba(255,232,196,0) 70%)", mixBlendMode: "screen" }} />
    <AbsoluteFill style={{ background: "radial-gradient(110% 80% at 50% 45%, rgba(0,0,0,0) 60%, rgba(30,24,20,0.16) 100%)", mixBlendMode: "multiply" }} />
  </AbsoluteFill>
);

// --------------------------------------------- hook word behind founder ----
const HookWord: React.FC<{ hook: FounderReelProps["hook"]; brand: Brand; t: number }> = ({ hook, brand, t }) => {
  const a = ramp(t, hook.in, hook.in + 0.55);
  const out = ramp(t, hook.out, hook.out + 0.14, easeIn);
  const opacity = a * (1 - out);
  if (opacity <= 0.001) return null;
  const rise = (1 - a) * 70;
  const spacing = interpolate(a, [0, 1], [0.1, -0.03]);
  const blur = (1 - a) * 14 + out * 6;
  const strike = hook.strikeAt !== undefined ? ramp(t, hook.strikeAt, hook.strikeAt + 0.32, easeInOut) : 0;
  return (
    <div
      style={{
        position: "absolute", left: hook.cx * W, top: hook.cy * H,
        transform: `translate(-50%, -50%) translateY(${rise}px) scale(${1 + out * 0.05})`,
        opacity, filter: `blur(${blur}px)`, whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          fontFamily: SERIF, fontWeight: 300, fontStyle: hook.italic ? "italic" : "normal", fontSize: hook.fontSize,
          lineHeight: 1, letterSpacing: `${spacing}em`, color: "#FBF8F1",
          textShadow: "0 24px 60px rgba(70,55,45,0.22), 0 2px 0 rgba(120,100,90,0.16)",
          ...(hook.lining ? { fontVariantNumeric: "lining-nums", fontFeatureSettings: '"lnum" 1' } : {}),
        }}
      >
        {hook.text}
      </div>
      {hook.strikeAt !== undefined && (
        <div
          style={{
            position: "absolute", left: "-4%", top: "56%", height: Math.max(8, hook.fontSize * 0.022),
            width: `${108 * strike}%`, background: brand.accent, borderRadius: 8, transform: "rotate(-5deg)",
            transformOrigin: "0 50%", boxShadow: "0 6px 18px rgba(60,20,45,0.25)",
          }}
        />
      )}
    </div>
  );
};

const Kicker: React.FC<{ text: string; t: number; tin: number; tout: number; top: number; color: string }> = ({ text, t, tin, tout, top, color }) => {
  const a = ramp(t, tin, tin + 0.5) * (1 - ramp(t, tout - 0.2, tout, easeIn));
  if (a <= 0.001) return null;
  return (
    <div style={{ position: "absolute", top, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontWeight: 500, fontSize: 27, letterSpacing: "0.38em", color, opacity: a, transform: `translateY(${(1 - a) * 12}px)` }}>
      {text}
    </div>
  );
};

// ------------------------------------------------------- name in headroom ----
const NameTitle: React.FC<{ n: NonNullable<FounderReelProps["nameTitle"]>; brand: Brand; t: number }> = ({ n, brand, t }) => {
  const a = ramp(t, n.in, n.in + 0.5);
  const out = ramp(t, n.out - 0.3, n.out, easeIn);
  if (a <= 0.001 || out >= 0.999) return null;
  const reveal = (d: number) => {
    const k = ramp(t, n.in + d, n.in + d + 0.6);
    return { transform: `translateY(${(1 - k) * 105}%)`, opacity: k * (1 - out) };
  };
  return (
    <div style={{ position: "absolute", top: n.top ?? 300, left: 0, right: 0, textAlign: "center", color: brand.ink }}>
      {n.pre && (
        <div style={{ overflow: "hidden", height: 74 }}>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 62, lineHeight: "74px", color: brand.taupe, ...reveal(0) }}>{n.pre}</div>
        </div>
      )}
      <div style={{ overflow: "hidden", height: 170, marginTop: -6 }}>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 158, lineHeight: "170px", letterSpacing: "-0.01em", ...reveal(0.08) }}>{n.name}</div>
      </div>
      <div style={{ overflow: "hidden", height: 44, marginTop: 14 }}>
        <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 26, letterSpacing: "0.42em", lineHeight: "44px", color: brand.accent, ...reveal(0.2) }}>{n.role}</div>
      </div>
    </div>
  );
};

// --------------------------------------------- hand-drawn ring annotation ----
const Ring: React.FC<{ r: NonNullable<FounderReelProps["ring"]>; t: number }> = ({ r, t }) => {
  if (t < r.start - 0.05 || t > r.end) return null;
  const draw = ramp(t, r.start, r.start + 0.75, easeInOut);
  const fade = 1 - ramp(t, r.end - 0.25, r.end, easeIn);
  const cx = r.cx * W, cy = r.cy * H, rx = r.rx * W, ry = r.ry * H;
  const pts: string[] = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI * 0.62 + (i / N) * Math.PI * 2.12;
    const wob = 1 + 0.035 * Math.sin(i * 0.33) + 0.06 * (i / N);
    pts.push(`${(cx + Math.cos(a) * rx * wob).toFixed(1)},${(cy + Math.sin(a) * ry * wob).toFixed(1)}`);
  }
  const len = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) * 1.12;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: fade }}>
      <g transform={`rotate(${r.rot} ${cx} ${cy})`}>
        <polyline points={pts.join(" ")} fill="none" stroke="#F4E9D8" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - draw)} style={{ filter: "drop-shadow(0 2px 6px rgba(60,40,30,0.35))" }} />
      </g>
    </svg>
  );
};

// ------------------------------------------------------------- captions ----
const Captions: React.FC<{ pages: Page[]; hide: [number, number][]; brand: Brand; t: number }> = ({ pages, hide, brand, t }) => {
  if (hide.some(([a, b]) => t >= a && t < b)) return null;
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const pin = ramp(t, page.start, page.start + 0.14);
  const pout = 1 - ramp(t, page.end - 0.1, page.end, easeIn);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 1440, textAlign: "center", opacity: pin * pout, transform: `translateY(${(1 - pin) * 14}px)` }}>
      {page.words.map((w, i) => {
        const k = ramp(t, w.start, w.start + 0.2);
        const style: React.CSSProperties = w.kw
          ? { fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, fontSize: 82, color: brand.accentSoft, letterSpacing: "0.005em", fontVariantNumeric: "lining-nums" }
          : { fontFamily: SANS, fontWeight: 500, fontSize: 58, color: "#FFFFFF", letterSpacing: "0.01em" };
        return (
          <span key={i} style={{ ...style, display: "inline-block", margin: "0 0.17em", lineHeight: 1.18, opacity: 0.35 + 0.65 * k, transform: `translateY(${(1 - k) * 10}px)`, textShadow: "0 2px 18px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.35)" }}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------- line icons ----
const DropIcon: React.FC<{ p: number; color: string }> = ({ p, color }) => (
  <svg width={46} height={62} viewBox="0 0 46 62" style={{ overflow: "visible" }}>
    <path d="M23 3 C 33 18, 42 29, 42 40 A 19 19 0 0 1 4 40 C 4 29, 13 18, 23 3 Z" fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeDasharray={150} strokeDashoffset={150 * (1 - p)} />
    <path d="M14 41 a 9 9 0 0 0 7 8" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={p} />
  </svg>
);
const LeafIcon: React.FC<{ p: number; color: string }> = ({ p, color }) => (
  <svg width={56} height={56} viewBox="0 0 56 56" style={{ overflow: "visible" }}>
    <path d="M8 48 C 8 22, 26 8, 50 6 C 49 30, 34 48, 8 48 Z" fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeDasharray={160} strokeDashoffset={160 * (1 - p)} />
    <path d="M8 48 C 20 34, 31 24, 44 13" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeDasharray={60} strokeDashoffset={60 * (1 - p)} />
  </svg>
);

const TypeLine: React.FC<{ line: Line; t: number; ink: string; accent: string; sizes: Record<Line["style"], number>; shadow?: string }> = ({ line, t, ink, accent, sizes, shadow }) => {
  const k = ramp(t, line.at, line.at + 0.55);
  const isKicker = line.style === "kicker";
  const style: React.CSSProperties = isKicker
    ? { fontFamily: SANS, fontWeight: 500, fontSize: sizes.kicker, letterSpacing: "0.42em", color: accent, textTransform: "uppercase" }
    : { fontFamily: SERIF, fontStyle: "italic", fontWeight: line.style === "hero" ? 600 : 500, fontSize: sizes[line.style], color: ink, letterSpacing: "-0.005em" };
  const iconP = ramp(t, line.at + 0.1, line.at + 0.8, easeInOut);
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 22, overflow: "hidden", padding: "0 0 6px" }}>
      {line.icon === "drop" && <div style={{ opacity: k }}><DropIcon p={iconP} color={accent} /></div>}
      {line.icon === "leaf" && <div style={{ opacity: k }}><LeafIcon p={iconP} color={accent} /></div>}
      <div style={{ ...style, lineHeight: 1.08, opacity: k, transform: `translateY(${(1 - k) * 60}%)`, textShadow: shadow }}>{line.text}</div>
    </div>
  );
};

// ------------------------------------------------- insert: product hero ----
const ARCH_W = 640;
const ARCH_H = 900;
const PRODUCT_H = 1040;
const CIRCLE_D = 780;
const CIRCLE_CY = 770;

const ProductCard: React.FC<{ ins: ProductInsert; brand: Brand; t: number }> = ({ ins, brand, t }) => {
  const enter = ramp(t, ins.start, ins.start + 0.42, easeInOut);
  const local = t - ins.start;
  const dur = ins.end - ins.start;
  const shape: Shape = ins.backdrop ?? brand.shape ?? "arch";
  const cd = ins.circle?.d ?? CIRCLE_D;
  const ccx = ins.circle?.cx ?? W / 2;
  const ccy = ins.circle?.cy ?? CIRCLE_CY;
  const push = 1 + 0.035 * Math.min(1, Math.max(0, local / dur));
  const outline = ramp(t, ins.start + 0.25, ins.start + 1.2, easeInOut);
  const archTop = 300;
  // products: explicit list, or the legacy single image centred in the frame
  const items: ProductItem[] = ins.products ?? (ins.image && ins.imageSize
    ? [{ image: ins.image, imageSize: ins.imageSize, height: PRODUCT_H, cx: W / 2, bottom: archTop + ARCH_H + 36 }]
    : []);
  const first = items[0];
  const firstW = first ? (first.imageSize[0] * first.height) / first.imageSize[1] : 0;
  const defaultChipY = first ? first.bottom - first.height + ((ins.iconY ?? first.imageSize[1] * 0.87) * first.height) / first.imageSize[1] : 900;
  const fill = `radial-gradient(70% 55% at 45% 32%, ${brand.archFill[0]} 0%, ${brand.archFill[1]} 68%, ${brand.archFill[2]} 100%)`;
  const shadow = "inset 0 -30px 60px rgba(120,110,80,0.10), 0 30px 70px rgba(90,70,50,0.12)";
  const backdropBottom = shape === "circle" ? ccy + cd / 2 : archTop + ARCH_H;
  const r = cd / 2 + 24;
  const circ = 2 * Math.PI * r;
  const L = 2 * ARCH_H + Math.PI * (ARCH_W / 2 + 22);
  return (
    <AbsoluteFill style={{ transform: `translateY(${(1 - enter) * 100}%)` }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${brand.cream} 0%, ${brand.creamDeep} 100%)` }} />
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "50% 55%" }}>
        {shape === "circle" ? (
          <>
            <div style={{ position: "absolute", left: ccx - cd / 2, top: ccy - cd / 2, width: cd, height: cd, borderRadius: "50%", background: fill, boxShadow: shadow, transform: `scale(${0.92 + 0.08 * enter})` }} />
            <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <circle cx={ccx} cy={ccy} r={r} fill="none" stroke={brand.hairline} strokeWidth={1.6} strokeDasharray={circ} strokeDashoffset={circ * (1 - outline)} transform={`rotate(-90 ${ccx} ${ccy})`} opacity={0.85} />
            </svg>
          </>
        ) : (
          <>
            <div style={{ position: "absolute", left: (W - ARCH_W) / 2, top: archTop, width: ARCH_W, height: ARCH_H, borderRadius: `${ARCH_W / 2}px ${ARCH_W / 2}px 4px 4px`, background: fill, boxShadow: shadow, transform: `scale(${0.95 + 0.05 * enter})` }} />
            <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <path d={`M ${(W - ARCH_W) / 2 - 22} ${archTop + ARCH_H + 22} L ${(W - ARCH_W) / 2 - 22} ${archTop + ARCH_W / 2} A ${ARCH_W / 2 + 22} ${ARCH_W / 2 + 22} 0 0 1 ${(W + ARCH_W) / 2 + 22} ${archTop + ARCH_W / 2} L ${(W + ARCH_W) / 2 + 22} ${archTop + ARCH_H + 22}`} fill="none" stroke={brand.hairline} strokeWidth={1.6} strokeDasharray={L} strokeDashoffset={L * (1 - outline)} opacity={0.85} />
            </svg>
          </>
        )}
        {items.map((it, i) => {
          const w = (it.imageSize[0] * it.height) / it.imageSize[1];
          const k = ramp(t, ins.start + 0.1 + (it.delay ?? i * 0.12), ins.start + 0.9 + (it.delay ?? i * 0.12), easeOut);
          const float = Math.sin(local * 1.7 + i * 1.3) * 5;
          return (
            <React.Fragment key={i}>
              <div style={{ position: "absolute", left: it.cx - w * 0.47, top: it.bottom - 26, width: w * 0.94, height: 46, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(70,48,36,0.32), rgba(70,48,36,0))", opacity: k }} />
              <Img src={staticFile(it.image)} style={{ position: "absolute", left: it.cx - w / 2, top: it.bottom - it.height, width: w, height: it.height, opacity: k, transform: `translateY(${(1 - k) * 60 + float}px)`, filter: "drop-shadow(0 26px 34px rgba(70,50,40,0.16))" }} />
            </React.Fragment>
          );
        })}
        {ins.chips.map((c, i) => {
          const k = ramp(t, c.at, c.at + 0.5);
          if (k <= 0.001) return null;
          const left = c.side === "left";
          const edge = c.x ?? (left ? (first?.cx ?? W / 2) - firstW / 2 - 26 : (first?.cx ?? W / 2) + firstW / 2 + 26);
          const top = (c.y ?? defaultChipY) - 34;
          return (
            <div key={i} style={{ position: "absolute", top, ...(left ? { right: W - edge } : { left: edge }), textAlign: left ? "right" : "left", opacity: k, transform: `translateX(${(1 - k) * (left ? -24 : 24)}px)` }}>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 38, color: brand.ink, lineHeight: 1.05, whiteSpace: "nowrap" }}>{c.title}</div>
              <div style={{ display: "flex", justifyContent: left ? "flex-end" : "flex-start", alignItems: "center", gap: 10, marginTop: 8 }}>
                {!left && <div style={{ width: 8, height: 8, borderRadius: 4, background: brand.accent }} />}
                <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 19, letterSpacing: "0.32em", color: brand.accent, whiteSpace: "nowrap" }}>{c.sub}</div>
                {left && <div style={{ width: 8, height: 8, borderRadius: 4, background: brand.accent }} />}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ position: "absolute", top: ins.textTop ?? backdropBottom + 92, left: 0, right: 0 }}>
        {ins.lines.map((l, i) => (
          <TypeLine key={i} line={l} t={t} ink={brand.ink} accent={brand.accent} sizes={{ kicker: 30, hero: 112, second: 80 }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------- insert: stock photo/video ----
const StockMedia: React.FC<{ ins: StockInsert; brand: Brand; t: number }> = ({ ins, brand, t }) => {
  const { fps } = useVideoConfig();
  const enter = ramp(t, ins.start, ins.start + 0.32, easeOut);
  const p = Math.min(1, Math.max(0, (t - ins.start) / (ins.end - ins.start)));
  const [z0, z1] = ins.zoom ?? [1.0, 1.07];
  const z = z0 + (z1 - z0) * p;
  const [fx, fy] = ins.focus ?? [0.5, 0.5];
  const blur = (1 - enter) * 16;
  const logoK = ins.logoAt !== undefined ? ramp(t, ins.logoAt, ins.logoAt + 0.45) : 0;
  const media: React.CSSProperties = { width: W, height: H, objectFit: "cover", objectPosition: `${fx * 100}% ${fy * 100}%` };
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.6), background: "#120c10" }}>
      <AbsoluteFill style={{ transform: `scale(${z * (1 + 0.06 * (1 - enter))})`, transformOrigin: `${fx * 100}% ${fy * 100}%`, filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined }}>
        {ins.media === "video" ? (
          <Sequence from={Math.round(ins.start * fps)} layout="none">
            <OffthreadVideo src={staticFile(ins.src)} muted startFrom={Math.round((ins.startFrom ?? 0) * fps)} style={media} />
          </Sequence>
        ) : (
          <Img src={staticFile(ins.src)} style={media} />
        )}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(18,10,16,0.10) 0%, rgba(18,10,16,0) 35%, rgba(18,10,16,0.35) 62%, rgba(18,10,16,0.72) 100%)" }} />
      <div style={{ position: "absolute", top: ins.textTop ?? 1180, left: 0, right: 0 }}>
        {ins.lines.map((l, i) => (
          <TypeLine key={i} line={l} t={t} ink="#FFFFFF" accent={brand.accentSoft} sizes={{ kicker: 30, hero: 150, second: 84 }} shadow="0 4px 30px rgba(0,0,0,0.45)" />
        ))}
        {brand.logoLight && ins.logoAt !== undefined && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 34, opacity: logoK, transform: `translateY(${(1 - logoK) * 18}px)` }}>
            <Img src={staticFile(brand.logoLight)} style={{ width: 330, filter: "drop-shadow(0 4px 20px rgba(0,0,0,0.35))" }} />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------- insert: ingredient molecule ----
// Resveratrol = 3,5,4'-trihydroxy-trans-stilbene: two benzene rings joined by
// a trans C=C bridge; OH at the 3 and 5 positions of ring A, 4' of ring B.
const hexPts = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i; // vertex 0 points right
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });

const Resveratrol: React.FC<{ p: number; color: string; accent: string }> = ({ p, color, accent }) => {
  const r = 78;
  const A = hexPts(300, 520, r);
  const bx = A[0][0], by = A[0][1];
  const c1: [number, number] = [bx + r * Math.cos(-Math.PI / 6), by + r * Math.sin(-Math.PI / 6)];
  const c2: [number, number] = [c1[0] + r * Math.cos(Math.PI / 6), c1[1] + r * Math.sin(Math.PI / 6)];
  const bEntry: [number, number] = [c2[0] + r * Math.cos(-Math.PI / 6), c2[1] + r * Math.sin(-Math.PI / 6)];
  const B = hexPts(bEntry[0] + r, bEntry[1], r);
  const ring = (pts: [number, number][]) => `M ${pts.map((q) => q.join(" ")).join(" L ")} Z`;
  const inner = (pts: [number, number][], cx: number, cy: number) =>
    [0, 2, 4].map((i) => {
      const s = pts[i], e = pts[(i + 1) % 6];
      const k = 0.78;
      return `M ${cx + (s[0] - cx) * k} ${cy + (s[1] - cy) * k} L ${cx + (e[0] - cx) * k} ${cy + (e[1] - cy) * k}`;
    }).join(" ");
  const oh = (from: [number, number], cx: number, cy: number, label: string, key: string) => {
    const dx = from[0] - cx, dy = from[1] - cy, len = Math.hypot(dx, dy);
    const to: [number, number] = [from[0] + (dx / len) * 58, from[1] + (dy / len) * 58];
    const lab: [number, number] = [from[0] + (dx / len) * 98, from[1] + (dy / len) * 98];
    return (
      <g key={key}>
        <path d={`M ${from.join(" ")} L ${to.join(" ")}`} stroke={color} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.min(1, Math.max(0, (p - 0.55) / 0.3))} />
        <text x={lab[0]} y={lab[1] + 14} textAnchor="middle" fontFamily={SANS} fontWeight={500} fontSize={40} fill={accent} opacity={Math.min(1, Math.max(0, (p - 0.7) / 0.25))}>{label}</text>
      </g>
    );
  };
  const draw = (start: number, span: number) => 1 - Math.min(1, Math.max(0, (p - start) / span));
  return (
    <svg viewBox="140 260 820 460" width={W} height={(W * 460) / 820} style={{ overflow: "visible", filter: "drop-shadow(0 0 14px rgba(255,255,255,0.35))" }}>
      <path d={ring(A)} fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={draw(0, 0.3)} />
      <path d={inner(A, 300, 520)} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" opacity={Math.min(1, Math.max(0, (p - 0.25) / 0.2))} />
      <path d={`M ${A[0].join(" ")} L ${c1.join(" ")} L ${c2.join(" ")} L ${bEntry.join(" ")}`} fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={draw(0.2, 0.25)} />
      <path d={`M ${c1[0] + 4} ${c1[1] + 14} L ${c2[0] - 6} ${c2[1] + 2}`} stroke={color} strokeWidth={4} strokeLinecap="round" opacity={Math.min(1, Math.max(0, (p - 0.4) / 0.2))} />
      <path d={ring(B)} fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={draw(0.3, 0.3)} />
      <path d={inner(B, bEntry[0] + r, bEntry[1])} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" opacity={Math.min(1, Math.max(0, (p - 0.5) / 0.2))} />
      {oh(A[2], 300, 520, "OH", "a3")}
      {oh(A[4], 300, 520, "OH", "a5")}
      {oh(B[0], bEntry[0] + r, bEntry[1], "OH", "b4")}
    </svg>
  );
};

const MoleculeCard: React.FC<{ ins: MoleculeInsert; brand: Brand; t: number }> = ({ ins, brand, t }) => {
  const enter = ramp(t, ins.start, ins.start + 0.3, easeOut);
  const p = Math.min(1, Math.max(0, (t - ins.start) / (ins.end - ins.start)));
  const drawP = ramp(t, ins.start + 0.15, ins.start + Math.min(1.5, (ins.end - ins.start) * 0.75), easeInOut);
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.6), background: "#0d0b12" }}>
      {ins.bg && (
        <AbsoluteFill style={{ transform: `scale(${1.04 + 0.05 * p})`, filter: enter < 1 ? `blur(${((1 - enter) * 14).toFixed(2)}px)` : undefined }}>
          <Img src={staticFile(ins.bg)} style={{ width: W, height: H, objectFit: "cover" }} />
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ background: "radial-gradient(80% 45% at 50% 34%, rgba(13,11,18,0.15) 0%, rgba(13,11,18,0.55) 70%), linear-gradient(180deg, rgba(13,11,18,0.35) 0%, rgba(13,11,18,0.1) 40%, rgba(13,11,18,0.75) 100%)" }} />
      <div style={{ position: "absolute", top: ins.moleculeTop ?? 330, left: 0, width: W }}>
        <Resveratrol p={drawP} color="#FFFFFF" accent={brand.accentSoft} />
      </div>
      <div style={{ position: "absolute", top: ins.textTop ?? 1180, left: 0, right: 0 }}>
        {ins.lines.map((l, i) => (
          <TypeLine key={i} line={l} t={t} ink="#FFFFFF" accent={brand.accentSoft} sizes={{ kicker: 30, hero: 150, second: 84 }} shadow="0 4px 30px rgba(0,0,0,0.5)" />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------- insert: texture macro ----
const TextureCard: React.FC<{ ins: TextureInsert; brand: Brand; t: number }> = ({ ins, brand, t }) => {
  const a = ramp(t, ins.start - 0.12, ins.start + 0.22, easeInOut);
  const local = t - ins.start;
  const rot = -8 + local * 4.5;
  const sc = 1.15 + local * 0.05;
  const lx = 180 + local * 70;
  return (
    <AbsoluteFill style={{ opacity: a, background: brand.cream }}>
      <svg width={540} height={960} viewBox="0 0 540 960" style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
        <defs>
          <filter id="cream" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.0042 0.0068" numOctaves={3} seed={11} result="noise" />
            <feGaussianBlur in="noise" stdDeviation={7} result="soft" />
            <feDiffuseLighting in="soft" surfaceScale={24} diffuseConstant={1.22} lightingColor="#FFFBF3" result="diffuse"><feDistantLight azimuth={235} elevation={58} /></feDiffuseLighting>
            <feSpecularLighting in="soft" surfaceScale={24} specularConstant={0.85} specularExponent={38} lightingColor="#FFFFFF" result="spec"><fePointLight x={lx} y={180} z={320} /></feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
            <feFlood floodColor="#F1E7D6" result="creamc" />
            <feBlend in="diffuse" in2="creamc" mode="multiply" result="shaded" />
            <feComposite in="shaded" in2="creamc" operator="arithmetic" k1={0} k2={0.62} k3={0.38} k4={0.02} result="mixed" />
            <feComposite in="specIn" in2="mixed" operator="arithmetic" k1={0} k2={0.32} k3={1} k4={0} />
          </filter>
        </defs>
        <g transform={`translate(270 480) rotate(${rot}) scale(${sc}) translate(-270 -480)`}>
          <rect x={-200} y={-200} width={940} height={1360} fill="#EFE5D3" filter="url(#cream)" />
        </g>
      </svg>
      <AbsoluteFill style={{ background: "radial-gradient(75% 30% at 50% 47%, rgba(247,242,232,0.8) 0%, rgba(247,242,232,0.45) 55%, rgba(247,242,232,0) 100%)" }} />
      <div style={{ position: "absolute", top: 640, left: 0, right: 0 }}>
        {ins.lines.map((l, i) => (
          <TypeLine key={i} line={l} t={t} ink={brand.ink} accent={brand.accent} sizes={{ kicker: 32, hero: 150, second: 92 }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------ light leak ----
const LightLeak: React.FC<{ at: number; dur: number; seed: number; t: number }> = ({ at, dur, seed, t }) => {
  const p = (t - (at - dur / 2)) / dur;
  if (p < 0 || p > 1) return null;
  const env = Math.sin(Math.PI * p);
  const x1 = -20 + 110 * p + random(`lx${seed}`) * 10;
  const y1 = 25 + 30 * random(`ly${seed}`);
  const x2 = 120 - 90 * p;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.75 * env, pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: `radial-gradient(55% 40% at ${x1}% ${y1}%, rgba(255,198,128,0.95) 0%, rgba(255,160,110,0.45) 40%, rgba(255,160,110,0) 72%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(45% 55% at ${x2}% 80%, rgba(255,226,170,0.7) 0%, rgba(255,226,170,0) 70%)` }} />
    </AbsoluteFill>
  );
};

// ----------------------------------------------------- arch wipe + end ----
const ArchWipe: React.FC<{ w: FounderReelProps["archWipe"]; brand: Brand; t: number }> = ({ w, brand, t }) => {
  const p = ramp(t, w.start, w.start + w.dur, easeInOut);
  if (p <= 0) return null;
  if ((brand.shape ?? "arch") === "circle") {
    // a disc rising from below the frame — covers the speaker's face last
    const d = interpolate(p, [0, 1], [500, 4700]);
    const cy = H * 1.08;
    return <div style={{ position: "absolute", left: W / 2 - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: "50%", background: brand.cream }} />;
  }
  const width = interpolate(p, [0, 1], [120, 2200]);
  const height = interpolate(p, [0, 1], [0, 3200]);
  return <div style={{ position: "absolute", left: (W - width) / 2, bottom: 0, width, height, background: brand.cream, borderRadius: `${width / 2}px ${width / 2}px 0 0` }} />;
};

const EndCard: React.FC<{ e: FounderReelProps["endCard"]; brand: Brand; t: number }> = ({ e, brand, t }) => {
  if (t < e.start) return null;
  const local = t - e.start;
  const AW = 560, AH = 780, top = 520;
  const L = 2 * AH + Math.PI * (AW / 2);
  const outline = ramp(local, 0.0, 0.9, easeInOut);
  const glow = 0.5 + 0.5 * Math.sin(local * 2.2);
  const logoK = ramp(local, 0.1, 0.75);
  const logo = e.logo ?? brand.logo;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(90% 60% at 50% 40%, #FAF6F0 0%, ${brand.cream} 55%, ${brand.creamDeep} 100%)` }}>
      <AbsoluteFill style={{ background: `radial-gradient(40% 25% at 50% 47%, rgba(223,227,197,${0.22 + 0.06 * glow}), rgba(223,227,197,0) 70%)` }} />
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        {(brand.shape ?? "arch") === "circle" ? (
          <circle cx={W / 2} cy={965} r={340} fill="none" stroke={brand.hairline} strokeWidth={1.6} strokeDasharray={2 * Math.PI * 340} strokeDashoffset={2 * Math.PI * 340 * (1 - outline)} transform={`rotate(-90 ${W / 2} 965)`} />
        ) : (
          <path d={`M ${(W - AW) / 2} ${top + AH} L ${(W - AW) / 2} ${top + AW / 2} A ${AW / 2} ${AW / 2} 0 0 1 ${(W + AW) / 2} ${top + AW / 2} L ${(W + AW) / 2} ${top + AH}`} fill="none" stroke={brand.hairline} strokeWidth={1.6} strokeDasharray={L} strokeDashoffset={L * (1 - outline)} />
        )}
      </svg>
      {logo ? (
        <div style={{ position: "absolute", top: 850, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: logoK, transform: `translateY(${(1 - logoK) * 30}px)`, filter: `blur(${(1 - logoK) * 6}px)` }}>
          <Img src={staticFile(logo)} style={{ width: 470 }} />
        </div>
      ) : (
        <div style={{ position: "absolute", top: 820, left: 0, right: 0, textAlign: "center", fontFamily: SERIF, fontWeight: 500, fontSize: 176, letterSpacing: "0.12em", color: brand.ink, opacity: logoK }}>{e.wordmark}</div>
      )}
      <div style={{ position: "absolute", top: 1046, left: (W - 140) / 2, width: 140 * ramp(local, 0.55, 1.0, easeInOut), height: 1.6, background: brand.hairline }} />
      <div style={{ position: "absolute", top: 1080, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontWeight: 500, fontSize: 25, letterSpacing: "0.4em", color: brand.taupe, opacity: ramp(local, 0.6, 1.0) }}>{e.episode}</div>
      <div style={{ position: "absolute", top: 1400, left: 60, right: 60, textAlign: "center", fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 64, color: brand.ink, opacity: ramp(local, 0.75, 1.2), transform: `translateY(${(1 - ramp(local, 0.75, 1.2)) * 20}px)` }}>{e.question}</div>
    </AbsoluteFill>
  );
};

// ----------------------------------------------------------------- scene ----
export const FounderReel: React.FC<FounderReelProps> = (props) => {
  const { delayRender, continueRender } = useDelayRender();
  const [fontHandle] = useState(() => delayRender("embedded fonts"));
  useEffect(() => {
    FONTS_READY.then(() => continueRender(fontHandle));
  }, [continueRender, fontHandle]);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const { brand } = props;
  const shot = shotAt(props.shots, t);
  const cam = camera(shot, t, props.face);
  const baseFrames = Math.round(props.baseEndSeconds * fps);
  const personIdx = Math.min(props.person.frames - 1, frame);
  const tr = (props.transitions ?? []).reduce((acc, x) => {
    const p = (t - x.start) / (x.end - x.start);
    return p >= 0 && p <= 1 ? Math.max(acc, Math.sin(Math.PI * p)) : acc;
  }, 0);
  const active = (props.inserts ?? []).filter((i) => t >= i.start - 0.15 && t < i.end);

  return (
    <AbsoluteFill style={{ backgroundColor: brand.cream }}>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AbsoluteFill style={tr > 0 ? { filter: `blur(${(22 * tr).toFixed(2)}px)`, transform: `scale(${1 + 0.1 * tr})`, transformOrigin: "50% 42%" } : undefined}>
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
            <Sequence durationInFrames={baseFrames} layout="none">
              <OffthreadVideo src={staticFile(props.baseVideo)} style={{ width: W, height: H, objectFit: "cover" }} />
            </Sequence>
            {t < props.hook.out + 0.2 && <HookWord hook={props.hook} brand={brand} t={t} />}
            {t < props.person.until && (
              <Img src={staticFile(`${props.person.prefix}${String(personIdx).padStart(3, "0")}${props.person.ext}`)} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
            )}
            {props.ring && <Ring r={props.ring} t={t} />}
          </div>
        </AbsoluteFill>
        <Daylight />
      </AbsoluteFill>

      <Kicker text={props.hook.kicker} t={t} tin={0.1} tout={props.hook.out + 0.1} top={232} color={brand.taupe} />
      {props.nameTitle && <NameTitle n={props.nameTitle} brand={brand} t={t} />}
      <Captions pages={props.captions} hide={props.captionHide} brand={brand} t={t} />

      {active.map((ins, i) =>
        ins.type === "product" ? <ProductCard key={i} ins={ins} brand={brand} t={t} />
        : ins.type === "stock" ? <StockMedia key={i} ins={ins} brand={brand} t={t} />
        : ins.type === "molecule" ? <MoleculeCard key={i} ins={ins} brand={brand} t={t} />
        : <TextureCard key={i} ins={ins} brand={brand} t={t} />,
      )}

      {props.leaks.map((l, i) => (
        <LightLeak key={i} at={l.at} dur={l.dur} seed={l.seed} t={t} />
      ))}

      <ArchWipe w={props.archWipe} brand={brand} t={t} />
      <EndCard e={props.endCard} brand={brand} t={t} />
      <Grain />
    </AbsoluteFill>
  );
};

export const calculateMetadata: CalculateMetadataFunction<FounderReelProps> = async ({ props }) => ({
  durationInFrames: Math.round((props.durationSeconds ?? 20) * (props.fps ?? 30)),
  fps: props.fps ?? 30,
  width: W,
  height: H,
});
