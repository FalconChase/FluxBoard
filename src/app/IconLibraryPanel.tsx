import { useEffect, useRef } from 'react';
import { annotationIcons, ANNOTATION_ICON_COLOR, ANNOTATION_ICON_LABEL, ANNOTATION_ICON_ORDER, type AnnotationIconKind } from '../skin/annotationIcons';
import { theme } from './theme';
import { overflowRowStyle, overflowRowLabelStyle, overflowBackButtonStyle, overflowSectionLabelStyle } from './overflowRowStyle';

interface IconLibraryPanelProps {
  onBack: () => void;
}

/**
 * Falcon, 2026-09-09 ("i want the icons to be in the left side pannel
 * never to collapse the ribbon in order to not scroll sideward"): the
 * INSERT tab's Icons group (Ribbon.tsx) now only shows a handful of
 * built-in icons plus a "More" tile -- clicking it swaps LeftPanel
 * over to this view (App.tsx's leftPanelView state) so the full
 * built-in set is reachable as a vertical, naturally-scrolling list
 * instead of forcing the ribbon strip itself to scroll sideways.
 * Scoped to built-ins only (Falcon: "just the built-in icons") --
 * Text and the shared custom/imported icons stay in the ribbon.
 *
 * Falcon also specified the panel's behavior: Projects shows for the
 * HOME tab; this view only takes over when "More" was explicitly
 * clicked from INSERT. App.tsx owns the switch-back-to-projects
 * timing (resets on tab change); the Back button here is just a
 * manual escape hatch for staying on INSERT.
 */
export function IconLibraryPanel({ onBack }: IconLibraryPanelProps) {
  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        // Falcon, 2026-09-09 ("i cant scroll the options panel"):
        // flex: 1 makes this actually fill LeftPanel's available
        // height instead of sizing to its own (tall) content, and
        // minHeight: 0 overrides the flex-item default of "auto" (=
        // content height) that would otherwise defeat both flex: 1
        // and overflowY -- without both, the 19-row list just grows
        // past the panel's real bottom edge with nothing to scroll.
        flex: 1,
        minHeight: 0,
        padding: '12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflowY: 'auto',
      }}
    >
      <button type="button" onClick={onBack} style={overflowBackButtonStyle}>
        ← Back to Projects
      </button>
      <div style={overflowSectionLabelStyle}>All icons</div>
      <p style={{ fontSize: 10, color: theme.text3, lineHeight: 1.4, margin: '0 0 2px', padding: '0 2px' }}>
        Drag any icon onto the canvas to drop a free-floating annotation there (no simulation meaning).
      </p>
      {ANNOTATION_ICON_ORDER.map((kind) => (
        <IconRow key={kind} kind={kind} />
      ))}
    </div>
  );
}

function IconRow({ kind }: { kind: AnnotationIconKind }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 24;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = ANNOTATION_ICON_COLOR[kind];
    ctx.strokeStyle = ANNOTATION_ICON_COLOR[kind];
    annotationIcons[kind](ctx, size / 2, size / 2, size * 0.7);
  }, [kind]);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-fluxboard-annotation-icon', kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`Drag "${ANNOTATION_ICON_LABEL[kind]}" onto the canvas`}
      style={overflowRowStyle({ draggable: true })}
    >
      <canvas ref={canvasRef} style={{ flexShrink: 0 }} />
      <span style={overflowRowLabelStyle}>{ANNOTATION_ICON_LABEL[kind]}</span>
    </button>
  );
}

