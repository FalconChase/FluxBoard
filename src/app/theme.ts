/**
 * Shared UI-chrome tokens for FluxBoard's ribbon interface (Falcon,
 * 2026-09-04: approved the dark-ribbon/white-canvas design mockup via
 * the published reference "FluxBoard Ribbon UI", then selected "Full
 * port now"). Values are lifted from that approved mockup and cross-
 * checked against the real per-node-kind colors already defined in
 * skin/nodeSkin.ts and skin/pathSkin.ts.
 *
 * Scope: UI CHROME only -- ribbon/panel/status-bar colors. Node and
 * path colors stay owned by nodeSkinDefaults/pathSkin exactly as
 * before; nothing here duplicates or overrides them.
 */

export const theme = {
  bgApp: '#0c0e12',
  bgPanel: '#14171d',
  bgPanel2: '#191d24',
  bgElevated: '#20242c',
  border: '#262b34',
  borderSoft: '#1d2129',
  borderStrong: '#333a46',
  text1: '#e8eaef',
  text2: '#9aa1ad',
  text3: '#666d7a',
  accent: '#5b8cff',
  accentStrong: '#82a6ff',
  accentSoft: 'rgba(91, 140, 255, 0.16)',
  success: '#2ecc71',
  sketch: '#7c3aed',
  danger: '#ff5d5d',
  dangerSoft: 'rgba(255, 93, 93, 0.14)',
} as const;

/** Falcon, 2026-09-04: "I WANT THE BOARD OR THE WORKSPACE BE SET TO
 * WHITE ALSO MAYBE WE NEED SETTINGS ON VIEW FOR WORKSPACE THEME OR
 * BACKGROUND COLOR" -- a per-project canvas background, independent of
 * the (always-dark) ribbon/panel chrome above. Persisted in
 * CanvasSettings.canvasBackground (persistence.ts); 'white' is the
 * default for both a brand-new project and any pre-existing save that
 * predates this field. */
export type CanvasBackground = 'white' | 'dark' | 'blueprint';

export const CANVAS_THEMES: Record<CanvasBackground, { background: string; grid: string }> = {
  white: { background: '#ffffff', grid: '#e9e9ee' },
  dark: { background: '#15181d', grid: '#262b34' },
  blueprint: { background: '#1a3a5c', grid: '#3d6a95' },
};

export const CANVAS_BACKGROUND_LABELS: Record<CanvasBackground, string> = {
  white: 'White',
  dark: 'Dark',
  blueprint: 'Blueprint',
};

export const CANVAS_BACKGROUND_ORDER: CanvasBackground[] = ['white', 'dark', 'blueprint'];
