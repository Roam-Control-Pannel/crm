# Bundled fonts

`InstrumentSerif-Regular.ttf` — the CRM's display face (`--font-display` in
`app/globals.css`), so a generated social graphic reads as the same brand as
the app.

Licensed under the SIL Open Font License 1.1 (`OFL.txt`), which permits
bundling and redistribution provided the licence travels with the font. It is
not sold on its own and is not renamed, so the two conditions that matter are
met.

## Why the file is in the repo rather than fetched

The composer (`lib/compose-graphic.ts`) renders headline text through sharp,
which resolves fonts through fontconfig at render time. The deployed function
is not this container: it has its own, much smaller font set, and a font that
cannot be resolved does not raise — it silently draws nothing, which would
publish a graphic with an invisible headline. Shipping the exact file and
pointing fontconfig at it is the only way to know which glyphs come out.

`next.config.js` lists this directory in `outputFileTracingIncludes` so the
bundler actually ships it; Next's tracer cannot see a path built at runtime.
`assertFontAvailable()` fails loudly at render time if it is missing anyway.
