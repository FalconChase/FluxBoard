import { useEffect, useRef } from 'react';
import type { EdgeStyle } from '../skin/pathSkin';
import { hexWithAlpha } from '../skin/canvasUtil';

const STYLES: { style: EdgeStyle; label: string; color: string }[] = [
  { style: 'transparent', label: 'Transparent', color: '#8a8a93' },
  { style: 'conveyor', label: 'Conveyor', color: '#3d7fff' },
  { style: 'glassTube', label: 'Glass tube', color: '#17b3a3' },
];

interface PathPaletteProps {
  /** null = nothing armed. Set to a style to make the next click on
   * an EXISTING edge apply that style to it — mirrors NodePalette's
   * armedKind/onArm flow, but targets an edge instead of placing a
   * new node (design doc §5.2 edge styles; PATHS tab of the wireframe
   * chrome). */
  armedStyle: EdgeStyle | null;
  onArm: (style: EdgeStyle | null) => void;
}

/** Left-panel PATHS tab: a flat list of the 3 edge styles that exist
 * today. 'pipe'/'wire' from Falcon's future object-type → path-style
 * taxonomy aren't real EdgeStyle values yet (see claude/build-log.md)
 * — this only offers what pathSkin.ts actually renders. */
export function PathPalette({ armedStyle, onArm }: PathPaletteProps) {
  return (
    <div
      style={{
        width: 116,
        flexShrink: 0,
        borderRight: '1px solid #e5e4e7',
        padding: '10px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#8a8a93',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          padding: '0 4px',
        }}
      >
        Path style
      </div>
      {STYLES.map(({ style, label, color }) => (
        <PathSwatch
          key={style}
          style={style}
          label={label}
          color={color}
          armed={armedStyle === style}
          onClick={() => onArm(armedStyle === style ? null : style)}
        />
      ))}
      <div style={{ fontSize: 11, color: '#8a8a93', padding: '4px', lineHeight: 1.45 }}>
        Click a style, then click an existing path on the canvas to apply it.
      </div>
    </div>
  );
}

function PathSwatch({
  style,
  label,
  color,
  armed,
  onClick,
}: {
  style: EdgeStyle;
  label: string;
  color: string;
  armed: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 36;
    const h = 36;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // A tiny straight-line stand-in for each style — the real
    // pathSkin.ts drawing functions all take a curved BezierPath +
    // camera/viewport, more machinery than a swatch this small needs;
    // this just needs to read as "conveyor" vs "glass tube" vs
    // "nothing" at a glance, matching each style's real look.
    const midY = h / 2;
    if (style === 'conveyor') {
      ctx.strokeStyle = hexWithAlpha(color, 0.28); // matches drawPathUnder's fill alpha
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(5, midY);
      ctx.lineTo(w - 5, midY);
      ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(color, 0.55); // matches drawConveyorTicks' alpha
      ctx.lineWidth = 1.5;
      for (let x = 8; x < w - 4; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, midY - 4);
        ctx.lineTo(x, midY + 4);
        ctx.stroke();
      }
    } else if (style === 'glassTube') {
      ctx.strokeStyle = hexWithAlpha(color, 0.16); // matches drawPathUnder's fill alpha
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(5, midY);
      ctx.lineTo(w - 5, midY);
      ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(color, 0.65); // matches drawPathOver's boundary alpha
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(5, midY - 6);
      ctx.lineTo(w - 5, midY - 6);
      ctx.moveTo(5, midY + 6);
      ctx.lineTo(w - 5, midY + 6);
      ctx.stroke();
    } else {
      // transparent — the base state, nothing drawn (design doc
      // §5.2) — a faint dashed guide line only, so the swatch isn't
      // just blank.
      ctx.strokeStyle = '#d8d7dd';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(5, midY);
      ctx.lineTo(w - 5, midY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [style, color]);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 6,
        borderRadius: 8,
        border: armed ? '2px solid #2563eb' : '1px solid #e5e4e7',
        background: armed ? '#eaf1ff' : '#ffffff',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <canvas ref={canvasRef} />
      <span style={{ fontSize: 12, fontWeight: 600, color: '#2c2c33' }}>{label}</span>
    </button>
  );
}
