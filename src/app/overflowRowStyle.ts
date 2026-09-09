import type { CSSProperties } from 'react';
import { theme } from './theme';
import { hexWithAlpha } from '../skin/canvasUtil';

/**
 * Falcon, 2026-09-09 ("i want all that of in the options panel to
 * have or placed this way"): a single shared row style for every
 * "More" overflow panel (Icons, Nodes, Paths, Modify) so they read as
 * one consistent list -- a full-width bordered card with a small
 * preview on the left and a label on the right, instead of each panel
 * reusing whatever compact ribbon-tile button happened to exist for
 * that group. IconLibraryPanel's original row (the first of these
 * panels built) is the reference this was extracted from verbatim.
 */
export function overflowRowStyle(opts: { active?: boolean; dangerous?: boolean; disabled?: boolean; draggable?: boolean } = {}): CSSProperties {
  const { active = false, dangerous = false, disabled = false, draggable = false } = opts;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 6px',
    borderRadius: 6,
    border: `1px solid ${active ? theme.accent : theme.borderSoft}`,
    background: active ? hexWithAlpha(theme.accent, 0.16) : theme.bgPanel2,
    cursor: disabled ? 'not-allowed' : draggable ? 'grab' : 'pointer',
    textAlign: 'left',
    flexShrink: 0,
    width: '100%',
    boxSizing: 'border-box',
    opacity: disabled ? 0.4 : 1,
    color: dangerous && !disabled ? theme.danger : theme.text1,
  };
}

export const overflowRowLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: theme.text1,
};

export const overflowPanelListStyle: CSSProperties = {
  width: 200,
  flexShrink: 0,
  padding: '12px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  overflowY: 'auto',
  minHeight: 0,
};

export const overflowBackButtonStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '7px 8px',
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: theme.bgPanel2,
  color: theme.text2,
  cursor: 'pointer',
  textAlign: 'left',
};

export const overflowSectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: theme.text3,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '2px 4px 0',
};
