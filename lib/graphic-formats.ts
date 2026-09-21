/**
 * GRAPHIC-COMPOSE-V1 — shared types and constants.
 *
 * No runtime deps, so the composer UI can import these without dragging
 * sharp and node:fs into the client bundle. Same drift-prevention split as
 * lib/social-settings-types.ts, and it is not optional here: importing them
 * straight from lib/compose-graphic.ts fails the build outright
 * ("Reading from node:child_process is not handled by plugins"), because
 * webpack follows the import into sharp.
 */

export type GraphicFormat = 'square' | 'portrait' | 'landscape' | 'story';

/**
 * Output sizes. These are the platforms' own native sizes, so nothing is
 * re-scaled after upload: a 4:5 portrait is the largest an Instagram feed
 * post can be and the one that takes the most vertical space in the feed.
 */
export const GRAPHIC_FORMATS: Record<GraphicFormat, {
  width: number; height: number; label: string; note: string;
}> = {
  square:    { width: 1080, height: 1080, label: 'Square 1:1',       note: 'Instagram and Facebook feed' },
  portrait:  { width: 1080, height: 1350, label: 'Portrait 4:5',     note: 'Instagram feed — takes the most space' },
  landscape: { width: 1200, height: 630,  label: 'Landscape 1.91:1', note: 'Facebook and LinkedIn' },
  story:     { width: 1080, height: 1920, label: 'Story 9:16',       note: 'Instagram and Facebook stories' },
};

export type ScrimStyle = 'bottom' | 'full' | 'none';

/**
 * Brand colours, lifted from :root in app/globals.css. Duplicated rather
 * than imported because CSS custom properties do not exist at render time —
 * the pairing is noted in both places so a palette change is caught.
 */
export const BRAND = {
  ink: '#1a1213',        // --ink-900
  maroon: '#702040',     // --maroon-700
  sun: '#f5b134',        // --sun-500
  white: '#ffffff',
};
