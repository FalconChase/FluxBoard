import type { Point } from '../floor/bezier';
import { theme } from './theme';

interface StatusBarProps {
  isRunning: boolean;
  onPlayPauseClick: () => void;
  instructionText: string;
  /** Live world-space cursor position (FluxCanvas's
   * onCursorWorldPositionChange), null when the pointer isn't over
   * the canvas. Coordinate-readout-only scope, per Falcon's answer to
   * the UCS-vs-current-coordinate-system question, 2026-09-03/04. */
  cursorWorldPosition: Point | null;
  snapToGrid: boolean;
  gridSpacing: number;
  /** Falcon, 2026-09-05: a rejected connection/placement attempt
   * shows its reason here instead of the normal contextual hint —
   * this flags that case so the text reads as a warning, not routine
   * guidance. */
  isWarning?: boolean;
}

/**
 * Bottom status bar (design mockup's bottom strip). Replaces the old
 * plain `<footer>` — same Run/Hold button and instruction text as
 * before, plus a coordinate readout and a grid/snap summary so the
 * ribbon port doesn't lose the header's old "Snap to grid ON/OFF"
 * visibility now that the toggle itself moved into the ribbon's VIEW
 * tab.
 */
export function StatusBar({ isRunning, onPlayPauseClick, instructionText, cursorWorldPosition, snapToGrid, gridSpacing, isWarning }: StatusBarProps) {
  return (
    <footer
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0.45rem 1rem',
        borderTop: `1px solid ${theme.border}`,
        background: theme.bgPanel,
        fontSize: 12,
        color: theme.text2,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onPlayPauseClick}
        style={{
          flexShrink: 0,
          padding: '5px 14px',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          border: '1px solid ' + (isRunning ? '#d8555a' : '#2f8f57'),
          borderRadius: 6,
          background: isRunning ? theme.danger : theme.success,
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {isRunning ? '⏸ Hold' : '▶ Run'}
      </button>

      <span
        style={{
          color: isWarning ? theme.danger : theme.text2,
          fontWeight: isWarning ? 600 : 400,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {instructionText}
      </span>

      <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: theme.text3 }}>
        {cursorWorldPosition
          ? `X: ${Math.round(cursorWorldPosition.x)}  Y: ${Math.round(cursorWorldPosition.y)}`
          : 'X: —  Y: —'}
      </span>

      <span style={{ flexShrink: 0, color: theme.text3 }}>
        Grid {gridSpacing} · Snap {snapToGrid ? 'ON' : 'OFF'} (F8)
      </span>
    </footer>
  );
}
