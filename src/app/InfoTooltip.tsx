import { useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { theme } from './theme';

interface InfoTooltipProps {
  text: string;
  /** Which side the popover's edge aligns to relative to the badge --
   * 'right' (default) keeps a badge near a container's right edge
   * from having its popover spill off that edge; 'left' for a badge
   * near the left edge instead. Purely cosmetic now that the popover
   * floats via a portal (see below) -- either way it stays fully
   * visible on screen. */
  align?: 'left' | 'right';
}

const POPOVER_WIDTH = 220;

/**
 * Falcon, 2026-09-09 ("i want the notes to be hidden on info icons as
 * drawn for cleaner view or ui"): replaces a permanently-visible
 * instructional paragraph with a small "i" badge; hovering or
 * focusing it reveals the same text in a popover, collapsed the rest
 * of the time.
 *
 * Falcon, 2026-09-09 (follow-up): "whenever i hover or click that
 * info logo for information i want it floating not truncated" -- the
 * popover used to be position:absolute inside the badge's own parent,
 * which for a badge sitting in LeftPanel/FileTab (width:200,
 * overflowY:'auto') or deep inside a RibbonGroup got clipped by that
 * ancestor's bounds instead of floating freely over the canvas. Fixed
 * the same way Ribbon.tsx's own sketch-style/quick-select flyouts
 * already do it: measure the badge's real screen position via
 * getBoundingClientRect() and render the popover through
 * createPortal into document.body with position:'fixed' -- it's no
 * longer inside any scrolling/clipping container at all, so it can
 * never be truncated by one again.
 */
export function InfoTooltip({ text, align = 'right' }: InfoTooltipProps) {
  const badgeRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function open(): void {
    const rect = badgeRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.bottom + 6,
      left: align === 'right' ? rect.right - POPOVER_WIDTH : rect.left,
    });
  }
  function close(): void {
    setPos(null);
  }

  return (
    <>
      <button
        ref={badgeRef}
        type="button"
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          // A click toggles it too (Falcon: "hover or click"), for
          // touch/keyboard use where there's no real hover state.
          e.stopPropagation();
          if (pos) close();
          else open();
        }}
        aria-label="More info"
        style={badgeStyle}
      >
        i
      </button>
      {pos &&
        createPortal(
          <div style={{ ...popoverStyle, top: pos.top, left: Math.max(6, pos.left) }} onMouseEnter={open} onMouseLeave={close}>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

const badgeStyle: CSSProperties = {
  width: 16,
  height: 16,
  flexShrink: 0,
  borderRadius: '50%',
  border: `1px solid ${theme.borderStrong}`,
  background: theme.bgPanel2,
  color: theme.text2,
  fontSize: 10,
  fontWeight: 700,
  fontStyle: 'italic',
  lineHeight: '14px',
  padding: 0,
  cursor: 'help',
};

const popoverStyle: CSSProperties = {
  position: 'fixed',
  width: POPOVER_WIDTH,
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.bgPanel,
  color: theme.text2,
  fontSize: 10,
  lineHeight: 1.4,
  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
  zIndex: 200,
};
