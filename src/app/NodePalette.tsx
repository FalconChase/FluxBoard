import { useEffect, useRef } from 'react';
import type { NodeKind } from '../core/types';
import { nodeSkinDefaults } from '../skin/nodeSkin';
import { octagonVertices, traceClosedPath } from '../skin/octagon';

const KINDS: NodeKind[] = ['source', 'distributor', 'merger', 'sorter', 'mixer', 'buffer', 'sink'];

interface NodePaletteProps {
  /** null = nothing armed. Set to a kind to make the next canvas
   * click place a node of that kind (Milestone 5, minimal-chrome
   * scope — see FBP008's resolution). */
  armedKind: NodeKind | null;
  onArm: (kind: NodeKind | null) => void;
}

/** Left-docked node palette. Deliberately just a flat list of the 7
 * kinds, no grouping/ribbon — nothing here yet justifies more chrome
 * than that (design doc §9 roadmap step 5; FBP008). */
export function NodePalette({ armedKind, onArm }: NodePaletteProps) {
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
        Add node
      </div>
      {KINDS.map((kind) => (
        <PaletteSwatch
          key={kind}
          kind={kind}
          armed={armedKind === kind}
          onClick={() => onArm(armedKind === kind ? null : kind)}
        />
      ))}
      <div style={{ fontSize: 11, color: '#8a8a93', padding: '4px', lineHeight: 1.45 }}>
        Click a kind, then click the canvas to place it. Drag from one node onto another to connect them.
      </div>
    </div>
  );
}

function PaletteSwatch({ kind, armed, onClick }: { kind: NodeKind; armed: boolean; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 36;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Reuses the exact same skin (fill/stroke/icon) the canvas draws
    // full-size nodes with — the palette swatch IS that node, just
    // small, not a separate icon set to keep in sync.
    const skin = nodeSkinDefaults[kind];
    const center = { x: size / 2, y: size / 2 };
    const radius = size * 0.42;
    traceClosedPath(ctx, octagonVertices(center, radius));
    ctx.fillStyle = skin.fill;
    ctx.fill();
    ctx.strokeStyle = skin.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    skin.icon(ctx, center.x, center.y, radius * 0.92);
  }, [kind]);

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
      <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize', color: '#2c2c33' }}>{kind}</span>
    </button>
  );
}
