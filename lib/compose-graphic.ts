/**
 * GRAPHIC-COMPOSE-V1
 *
 * Turn a Brain photograph into a branded, platform-shaped social graphic:
 * the right aspect ratio, a legibility scrim, a headline in the CRM's own
 * display face, and the lion mark.
 *
 * This is the honest answer to "can we generate an image with AI from the
 * photos in the Brain". Claude reads images; it does not draw them. What it
 * can do is choose the photo (IMAGE-SEMANTIC-V1) and write the words — and
 * then sharp, already a dependency for the upload transcode, assembles them
 * deterministically. A composited graphic is reproducible, on-brand and free
 * per render, which a generated one would be none of.
 *
 * On fonts — the part that had to be measured, not assumed
 * -------------------------------------------------------
 * Text is drawn through sharp's `text` input with an explicit `fontfile`,
 * NOT through SVG <text>. The difference matters in the deployed function,
 * which has a far smaller font set than any dev machine:
 *
 *   - SVG <text> resolves fonts through fontconfig. Measured here with the
 *     font directory emptied: the render succeeds, returns a valid image,
 *     and draws a row of empty tofu boxes where the words should be — about
 *     a tenth of the ink of the real thing, and unreadable. No exception, no
 *     warning; just a published graphic with a row of rectangles on it.
 *   - `fontfile` hands Pango the file directly and needs no fontconfig at
 *     all (measured with FONTCONFIG_FILE and FONTCONFIG_PATH unset). Its
 *     failure mode when the file is missing is a fallback to some default
 *     face — wrong, but legible, which is a far better floor.
 *
 * So the remaining risk is not "no text", it is "not our font", and the
 * realistic cause of that is the bundler not shipping assets/fonts.
 * assertBrandFont() reads the file's TrueType name table and refuses to
 * render unless it really is Instrument Serif, which turns a silent brand
 * regression into a loud failure. next.config.js lists the directory in
 * outputFileTracingIncludes, because Next's tracer cannot see a path built
 * at runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { JPEG_QUALITY } from '@/lib/uploads';
import {
  BRAND,
  GRAPHIC_FORMATS,
  type GraphicFormat,
  type ScrimStyle,
} from '@/lib/graphic-formats';

// Re-exported so server code has one import for the whole composer.
export { BRAND, GRAPHIC_FORMATS };
export type { GraphicFormat, ScrimStyle };

export const FONT_FAMILY = 'Instrument Serif';
export const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'InstrumentSerif-Regular.ttf');
export const LOGO_PATH = path.join(process.cwd(), 'public', 'logo-lionFav-icon.png');

export interface ComposeOptions {
  format: GraphicFormat;
  /** Large display line. Omit for a plain platform-shaped crop. */
  headline?: string;
  /** Small line above the headline — a place name reads best here. */
  kicker?: string;
  /** Draw the lion mark. */
  logo?: boolean;
  /** Darkening behind the text. 'bottom' is the default and the safe one. */
  scrim?: ScrimStyle;
  /** Kicker colour. Defaults to the brand sun yellow. */
  accent?: string;
}

// ---------------------------------------------------------------------------
// Font integrity
// ---------------------------------------------------------------------------

/**
 * Read the family names out of a TrueType `name` table.
 *
 * Deliberately a file check rather than a render check: the failure this
 * guards against is the font not being deployed, which is deterministic and
 * cheap to detect. Comparing rendered pixel counts against a recorded
 * reference would also catch a font Pango cannot parse, but it would make
 * every deploy hostage to the exact harfbuzz build, and the payoff — a
 * legible fallback face instead of the right one — does not justify it.
 */
export function trueTypeFamilies(buf: Buffer): string[] {
  const families: string[] = [];
  try {
    const numTables = buf.readUInt16BE(4);
    let nameOffset = 0;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (rec + 16 > buf.length) break;
      if (buf.toString('ascii', rec, rec + 4) === 'name') {
        nameOffset = buf.readUInt32BE(rec + 8);
        break;
      }
    }
    if (!nameOffset || nameOffset + 6 > buf.length) return families;
    const count = buf.readUInt16BE(nameOffset + 2);
    const stringOffset = nameOffset + buf.readUInt16BE(nameOffset + 4);
    for (let i = 0; i < count; i++) {
      const rec = nameOffset + 6 + i * 12;
      if (rec + 12 > buf.length) break;
      const platformId = buf.readUInt16BE(rec);
      const nameId = buf.readUInt16BE(rec + 6);
      if (nameId !== 1) continue;               // 1 = font family
      const length = buf.readUInt16BE(rec + 8);
      const offset = stringOffset + buf.readUInt16BE(rec + 10);
      if (offset + length > buf.length) continue;
      // Platform 3 (Windows) is UTF-16BE; platform 1 (Mac) is single-byte.
      const encoding = platformId === 3 ? 'utf16le' : 'latin1';
      const slice = buf.subarray(offset, offset + length);
      const text =
        encoding === 'utf16le' ? slice.swap16().toString('utf16le') : slice.toString('latin1');
      if (text) families.push(text);
    }
  } catch {
    // A malformed table is indistinguishable from "not our font" as far as
    // the caller is concerned — return nothing and let the assert fail.
  }
  return families;
}

let fontChecked: string | null = null;

/**
 * Throw unless the bundled brand font is present and is what it claims to be.
 * Result is memoised — this runs on a warm function that may render many
 * graphics.
 */
export function assertBrandFont(fontPath: string = FONT_PATH): void {
  if (fontChecked === fontPath) return;
  let buf: Buffer;
  try {
    buf = fs.readFileSync(fontPath);
  } catch {
    throw new Error(
      `Brand font missing at ${fontPath}. It is bundled via outputFileTracingIncludes ` +
        `in next.config.js — if that entry was removed, graphics would silently render ` +
        `in a substitute face instead.`
    );
  }
  const families = trueTypeFamilies(buf);
  if (!families.some(f => f.trim().toLowerCase() === FONT_FAMILY.toLowerCase())) {
    throw new Error(
      `Font at ${fontPath} is not ${FONT_FAMILY} (found: ${families.join(', ') || 'no family name'}).`
    );
  }
  fontChecked = fontPath;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Escape for Pango markup — the text is user copy and may contain & or <. */
export function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Side padding as a fraction of the shorter edge — keeps every format even. */
const PAD_RATIO = 0.075;

/**
 * Starting headline size as a fraction of the width, then stepped down until
 * the wrapped block fits its box. Pango does the wrapping; this only has to
 * decide how big to start and when to give up.
 */
const HEADLINE_RATIO = 0.085;
const KICKER_RATIO = 0.032;
const MIN_HEADLINE_PT = 18;
const SIZE_STEP = 0.88;
const MAX_FIT_ATTEMPTS = 6;

interface TextLayer { buffer: Buffer; width: number; height: number; }

/**
 * Render a line of text to an RGBA layer, shrinking the point size until it
 * fits `maxWidth` x `maxHeight`.
 *
 * Returns null for empty text so callers can compose unconditionally.
 */
async function renderText(
  text: string,
  opts: {
    fontPath: string; startPt: number; maxWidth: number; maxHeight: number;
    colour: string; lineSpacing: number;
  }
): Promise<TextLayer | null> {
  const clean = text.trim();
  if (!clean) return null;
  let pt = Math.max(MIN_HEADLINE_PT, Math.round(opts.startPt));
  for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
    const layer = sharp({
      text: {
        text: `<span foreground="${opts.colour}">${escapeMarkup(clean)}</span>`,
        font: `${FONT_FAMILY} ${pt}`,
        fontfile: opts.fontPath,
        width: Math.round(opts.maxWidth),
        // `height` in sharp's text input is an auto-fit target, not a clip, so
        // it is deliberately not passed: we want the natural wrapped height
        // and our own decision about whether it fits.
        rgba: true,
        align: 'left',
        spacing: opts.lineSpacing,
      },
    });
    const buffer = await layer.png().toBuffer();
    const meta = await sharp(buffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (height <= opts.maxHeight || pt <= MIN_HEADLINE_PT) {
      return { buffer, width, height };
    }
    pt = Math.max(MIN_HEADLINE_PT, Math.round(pt * SIZE_STEP));
  }
  return null;
}

/**
 * The darkening behind the text. Pure shapes and gradients — no glyphs — so
 * this layer never depends on a font.
 *
 * `textTop` is where the copy actually starts, measured after the text has
 * been laid out. The first version used a fixed gradient (clear until 35% of
 * the height, dark by the base) and it was wrong on any short canvas: at
 * 1200x630 a two-line headline reached well above the dark zone, so the top
 * line and the kicker sat on bright sky and were barely readable. A scrim
 * that does not know where the text is cannot be sized to protect it.
 *
 * So the gradient is built around the block: fully clear a fade-length above
 * it, dark enough to hold white type by the time the first glyph starts, and
 * stronger still at the base.
 */
export function scrimSvg(
  width: number,
  height: number,
  style: ScrimStyle,
  textTop?: number
): string | null {
  if (style === 'none') return null;
  let stops: string;
  if (style === 'full') {
    stops =
      `<stop offset="0" stop-color="${BRAND.ink}" stop-opacity="0.55"/>` +
      `<stop offset="1" stop-color="${BRAND.ink}" stop-opacity="0.80"/>`;
  } else {
    // No text to protect: a gentle base wash, purely for depth.
    const top = textTop === undefined ? height * 0.62 : textTop;
    const fade = height * 0.3;
    const clear = clamp01((top - fade) / height);
    const solid = clamp01(top / height);
    stops =
      `<stop offset="0" stop-color="${BRAND.ink}" stop-opacity="0"/>` +
      `<stop offset="${clear.toFixed(4)}" stop-color="${BRAND.ink}" stop-opacity="0"/>` +
      `<stop offset="${Math.max(clear, solid).toFixed(4)}" stop-color="${BRAND.ink}" stop-opacity="0.72"/>` +
      `<stop offset="1" stop-color="${BRAND.ink}" stop-opacity="0.90"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#s)"/>
</svg>`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export interface ComposeResult {
  buffer: Buffer;
  width: number;
  height: number;
  /** True when a headline was requested and actually drawn. */
  headlineDrawn: boolean;
  /**
   * Y of the top of the text block, or undefined when there is none. Returned
   * because it is the one number that says whether the copy fitted: a block
   * that ran off the top would report 0, and counting light pixels near the
   * top of the frame cannot tell a headline from a bright sky.
   */
  textTop?: number;
}

/**
 * Build the graphic.
 *
 * `source` is the original photo's bytes. Everything else is derived, so the
 * same inputs always produce the same output — which is what makes this
 * testable and what lets the UI show a preview that is the real thing rather
 * than an approximation.
 */
export async function composeGraphic(
  source: Buffer,
  opts: ComposeOptions,
  paths?: { fontPath?: string; logoPath?: string }
): Promise<ComposeResult> {
  const fontPath = paths?.fontPath || FONT_PATH;
  const logoPath = paths?.logoPath || LOGO_PATH;
  const spec = GRAPHIC_FORMATS[opts.format] || GRAPHIC_FORMATS.square;
  const { width, height } = spec;
  const wantsText = !!(opts.headline?.trim() || opts.kicker?.trim());
  if (wantsText) assertBrandFont(fontPath);

  // 1. The photograph, cropped to the platform's shape. `attention` picks the
  //    most visually salient region rather than the centre, which is the
  //    difference between a portrait crop keeping a shopfront and cutting it
  //    in half.
  const base = await sharp(source)
    .rotate()                       // honour EXIF before cropping
    .resize(width, height, { fit: 'cover', position: sharp.strategy.attention })
    .toBuffer();

  // 2. Lay the text out BEFORE the scrim, because the scrim has to be sized
  //    around where the copy actually lands (see scrimSvg).
  //
  //    Type scales off the SHORTER edge, not the width. Scaling off width put
  //    a 102pt headline on a 630px-tall landscape canvas — enormous, and the
  //    reason it overflowed. The short edge gives 92pt on the square and
  //    portrait formats and 53pt on the landscape, which is what each wants.
  const pad = Math.round(Math.min(width, height) * PAD_RATIO);
  const typeScale = Math.min(width, height);
  const textWidth = width - pad * 2;
  const textLayers: Array<{ layer: TextLayer; gapAbove: number }> = [];
  let headlineDrawn = false;

  if (opts.headline?.trim()) {
    const headline = await renderText(opts.headline, {
      fontPath,
      startPt: typeScale * HEADLINE_RATIO,
      maxWidth: textWidth,
      maxHeight: height * 0.42,
      colour: BRAND.white,
      // Instrument Serif sets loose by default; pulling the leading in a
      // little is what makes a multi-line headline read as one block.
      lineSpacing: -Math.round(typeScale * 0.012),
    });
    if (headline) {
      textLayers.push({ layer: headline, gapAbove: 0 });
      headlineDrawn = true;
    }
  }

  if (opts.kicker?.trim()) {
    const kicker = await renderText(opts.kicker, {
      fontPath,
      startPt: typeScale * KICKER_RATIO,
      maxWidth: textWidth,
      maxHeight: height * 0.1,
      colour: opts.accent || BRAND.sun,
      lineSpacing: 0,
    });
    if (kicker) {
      textLayers.push({ layer: kicker, gapAbove: Math.round(typeScale * 0.015) });
    }
  }

  // Stack upwards from the bottom padding: headline first, then the kicker
  // above it, so the headline baseline is identical with or without a kicker.
  const placed: Array<{ buffer: Buffer; top: number }> = [];
  let cursor = height - pad;
  for (const { layer, gapAbove } of textLayers) {
    cursor -= layer.height + gapAbove;
    placed.push({ buffer: layer.buffer, top: Math.max(0, cursor) });
  }
  const textTop = placed.length ? Math.min(...placed.map(p => p.top)) : undefined;

  const layers: sharp.OverlayOptions[] = [];

  // 3. Scrim, now that it knows what it is protecting.
  const scrim = scrimSvg(
    width, height, opts.scrim || (wantsText ? 'bottom' : 'none'), textTop
  );
  if (scrim) layers.push({ input: Buffer.from(scrim), top: 0, left: 0 });
  for (const p of placed) layers.push({ input: p.buffer, left: pad, top: p.top });

  // 4. Lion mark, top-left, sized off the width so it reads the same at every
  //    format. Optional and best-effort: a missing logo must not fail a
  //    graphic whose point is the photograph.
  if (opts.logo) {
    try {
      const mark = Math.round(width * 0.075);
      const logo = await sharp(fs.readFileSync(logoPath))
        .resize(mark, mark, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      layers.push({ input: logo, left: pad, top: pad });
    } catch (err) {
      console.warn('[compose] logo could not be drawn:', err);
    }
  }

  const buffer = await sharp(base)
    .composite(layers)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return { buffer, width, height, headlineDrawn, textTop };
}
