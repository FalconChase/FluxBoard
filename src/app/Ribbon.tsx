import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { NodeKind } from '../core/types';
import { nodeSkinDefaults } from '../skin/nodeSkin';
import { octagonVertices, traceClosedPath } from '../skin/octagon';
import type { EdgeStyle } from '../skin/pathSkin';
import { hexWithAlpha } from '../skin/canvasUtil';
import {
  theme,
  CANVAS_BACKGROUND_LABELS,
  CANVAS_BACKGROUND_ORDER,
  CANVAS_THEMES,
  type CanvasBackground,
} from './theme';

export type RibbonTab = 'home' | 'insert' | 'view' | 'manage' | 'layers' | 'tools';

const NODE_KINDS: NodeKind[] = ['source', 'distributor', 'merger', 'sorter', 'mixer', 'buffer', 'sink'];
const EDGE_STYLES: { style: EdgeStyle; label: string; color: string }[] = [
  { style: 'transparent', label: 'Transparent', color: theme.text3 },
  { style: 'conveyor', label: 'Conveyor', color: '#3d7fff' },
  { style: 'glassTube', label: 'Glass tube', color: '#17b3a3' },
];

const TABS: { tab: RibbonTab; label: string }[] = [
  { tab: 'home', label: 'Home' },
  { tab: 'insert', label: 'Insert' },
  { tab: 'view', label: 'View' },
  { tab: 'manage', label: 'Manage' },
  { tab: 'layers', label: 'Layers' },
  { tab: 'tools', label: 'Tools' },
];

interface RibbonProps {
  activeTab: RibbonTab;
  onTabChange: (tab: RibbonTab) => void;

  armedKind: NodeKind | null;
  onArmKind: (kind: NodeKind | null) => void;
  armedEdgeStyle: EdgeStyle | null;
  onArmEdgeStyle: (style: EdgeStyle | null) => void;
  sketchArmed: boolean;
  onArmSketch: (armed: boolean) => void;

  canDelete: boolean;
  onDeleteSelection: () => void;

  snapToGrid: boolean;
  onToggleSnapToGrid: () => void;
  gridSpacing: number;
  onGridSpacingChange: (spacing: number) => void;
  tickIntervalMs: number;
  onTickIntervalMsChange: (ms: number) => void;
  canvasBackground: CanvasBackground;
  onCanvasBackgroundChange: (bg: CanvasBackground) => void;
}

/**
 * Top ribbon chrome (Falcon's "TABS UI FRAMEWORKS" wireframe sheet,
 * approved as the "FluxBoard Ribbon UI" design mockup, then "Full
 * port now", 2026-09-04). HOME absorbs what used to be the left
 * panel's NODES/PATHS/OBJECTS tabs plus a MODIFY group (Delete is
 * real; Multi-select/Duplicate/Pan are placeholders — the deferred
 * Tools-tab concept, folded in here instead of a separate tab, still
 * not built). VIEW absorbs the properties panel's old "Canvas &
 * simulation" section (grid spacing, sim tick interval, snap-to-grid)
 * plus the new workspace-background setting Falcon asked for. INSERT/
 * MANAGE/LAYERS/TOOLS are inert placeholders — real content for those
 * needs more spec first (ICONS/LABEL overlay, LAYERS' z-axis floor
 * stacking, TOOLS' measure tool — see claude/build-log.md), same
 * "placeholder until asked for" treatment OBJECTS already had.
 */
export function Ribbon({
  activeTab,
  onTabChange,
  armedKind,
  onArmKind,
  armedEdgeStyle,
  onArmEdgeStyle,
  sketchArmed,
  onArmSketch,
  canDelete,
  onDeleteSelection,
  snapToGrid,
  onToggleSnapToGrid,
  gridSpacing,
  onGridSpacingChange,
  tickIntervalMs,
  onTickIntervalMsChange,
  canvasBackground,
  onCanvasBackgroundChange,
}: RibbonProps) {
  return (
    <div style={{ flexShrink: 0, background: theme.bgPanel, borderBottom: `1px solid ${theme.border}` }}>
      <div
        style={{
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 700,
          color: theme.text1,
          letterSpacing: 0.2,
          borderBottom: `1px solid ${theme.borderSoft}`,
        }}
      >
        FluxBoard
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${theme.borderSoft}` }}>
        {TABS.map(({ tab, label }) => (
          <button key={tab} type="button" onClick={() => onTabChange(tab)} style={tabButtonStyle(activeTab === tab)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 84, padding: '6px 10px', overflowX: 'auto' }}>
        {activeTab === 'home' && (
          <>
            <RibbonGroup title="Nodes">
              <div style={{ display: 'flex', gap: 4 }}>
                {NODE_KINDS.map((kind) => (
                  <NodeSwatchButton
                    key={kind}
                    kind={kind}
                    armed={armedKind === kind}
                    onClick={() => onArmKind(armedKind === kind ? null : kind)}
                  />
                ))}
              </div>
            </RibbonGroup>
            <RibbonGroup title="Paths">
              <div style={{ display: 'flex', gap: 4 }}>
                {EDGE_STYLES.map(({ style, label, color }) => (
                  <PathSwatchButton
                    key={style}
                    edgeStyle={style}
                    label={label}
                    color={color}
                    armed={armedEdgeStyle === style}
                    onClick={() => onArmEdgeStyle(armedEdgeStyle === style ? null : style)}
                  />
                ))}
                <RibbonIconButton
                  label="Sketch"
                  title="Sketch a planning path — drag anywhere on the canvas, no simulation meaning"
                  active={sketchArmed}
                  activeColor={theme.sketch}
                  onClick={() => onArmSketch(!sketchArmed)}
                  icon={<SketchIcon />}
                />
              </div>
            </RibbonGroup>
            <RibbonGroup title="Objects">
              <div style={{ display: 'flex', gap: 4, opacity: 0.4 }}>
                <RibbonIconButton label="Items" title="Coming soon — object-type registry" disabled icon={<ObjectsIcon />} />
              </div>
            </RibbonGroup>
            <RibbonGroup title="Modify">
              <div style={{ display: 'flex', gap: 4 }}>
                <RibbonIconButton
                  label="Delete"
                  title={canDelete ? 'Delete the selected node or path (Delete/Backspace)' : 'Select something first'}
                  disabled={!canDelete}
                  onClick={onDeleteSelection}
                  icon={<DeleteIcon />}
                  dangerous
                />
                <RibbonIconButton label="Multi-select" title="Coming soon" disabled icon={<MultiSelectIcon />} />
                <RibbonIconButton label="Duplicate" title="Coming soon" disabled icon={<DuplicateIcon />} />
                <RibbonIconButton label="Pan" title="Coming soon — drag-to-pan is already free with an empty-canvas drag" disabled icon={<PanIcon />} />
              </div>
            </RibbonGroup>
          </>
        )}

        {activeTab === 'view' && (
          <>
            <RibbonGroup title="Workspace background">
              <div style={{ display: 'flex', gap: 6 }}>
                {CANVAS_BACKGROUND_ORDER.map((bg) => (
                  <BackgroundSwatchButton
                    key={bg}
                    bg={bg}
                    active={canvasBackground === bg}
                    onClick={() => onCanvasBackgroundChange(bg)}
                  />
                ))}
              </div>
            </RibbonGroup>
            <RibbonGroup title="Grid & snap">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <RibbonNumberField
                  label="Grid spacing"
                  value={gridSpacing}
                  min={4}
                  step={4}
                  onChange={onGridSpacingChange}
                />
                <RibbonToggleButton label="Snap to grid" hint="F8" active={snapToGrid} onClick={onToggleSnapToGrid} />
              </div>
            </RibbonGroup>
            <RibbonGroup title="Simulation">
              <RibbonNumberField
                label="Tick interval (ms)"
                value={tickIntervalMs}
                min={10}
                step={10}
                onChange={onTickIntervalMsChange}
              />
            </RibbonGroup>
          </>
        )}

        {(activeTab === 'insert' || activeTab === 'manage' || activeTab === 'layers' || activeTab === 'tools') && (
          <PlaceholderTabContent tab={activeTab} />
        )}
      </div>
    </div>
  );
}

function PlaceholderTabContent({ tab }: { tab: RibbonTab }) {
  const copy: Record<string, string> = {
    insert: 'Insert — icon/label overlays for explaining a flow (e.g. a "cash" icon riding a path). Not built yet.',
    manage: 'Manage — bulk project/graph operations. Not built yet.',
    layers: 'Layers — stacking floors along a z-axis. Not built yet.',
    tools: 'Tools — measurement and guide tools. Not built yet.',
  };
  return (
    <RibbonGroup title={TABS.find((t) => t.tab === tab)?.label ?? ''}>
      <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, maxWidth: 420, margin: 0 }}>{copy[tab]}</p>
    </RibbonGroup>
  );
}

function RibbonGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 6,
        padding: '2px 12px',
        borderRight: `1px solid ${theme.borderSoft}`,
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{children}</div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: theme.text3,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          textAlign: 'center',
        }}
      >
        {title}
      </div>
    </div>
  );
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '7px 14px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    border: 'none',
    borderBottom: active ? `2px solid ${theme.accent}` : '2px solid transparent',
    background: active ? theme.accentSoft : 'transparent',
    color: active ? theme.accentStrong : theme.text2,
    cursor: 'pointer',
  };
}

/** Node kind swatch — reuses the exact same skin the canvas draws
 * full-size nodes with (nodeSkinDefaults/octagonVertices), same
 * technique NodePalette used, just smaller and laid out horizontally
 * for the ribbon. */
function NodeSwatchButton({ kind, armed, onClick }: { kind: NodeKind; armed: boolean; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 28;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const skin = nodeSkinDefaults[kind];
    const center = { x: size / 2, y: size / 2 };
    const radius = size * 0.42;
    traceClosedPath(ctx, octagonVertices(center, radius));
    ctx.fillStyle = skin.fill;
    ctx.fill();
    ctx.strokeStyle = skin.stroke;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    skin.icon(ctx, center.x, center.y, radius * 0.92);
  }, [kind]);

  return (
    <button type="button" onClick={onClick} title={`Place a ${kind}`} style={swatchButtonStyle(armed)}>
      <canvas ref={canvasRef} />
      <span style={swatchLabelStyle}>{kind}</span>
    </button>
  );
}

/** Path style swatch — reuses PathPalette's exact alpha-matched
 * stand-in drawing (hexWithAlpha against pathSkin.ts's real values)
 * so the ribbon swatch still reads as "conveyor" vs "glass tube" vs
 * "nothing" at a glance. */
function PathSwatchButton({
  edgeStyle,
  label,
  color,
  armed,
  onClick,
}: {
  edgeStyle: EdgeStyle;
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
    const w = 28;
    const h = 28;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const midY = h / 2;
    if (edgeStyle === 'conveyor') {
      ctx.strokeStyle = hexWithAlpha(color, 0.28);
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4, midY);
      ctx.lineTo(w - 4, midY);
      ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(color, 0.55);
      ctx.lineWidth = 1.3;
      for (let x = 6; x < w - 3; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, midY - 3);
        ctx.lineTo(x, midY + 3);
        ctx.stroke();
      }
    } else if (edgeStyle === 'glassTube') {
      ctx.strokeStyle = hexWithAlpha(color, 0.16);
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4, midY);
      ctx.lineTo(w - 4, midY);
      ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(color, 0.65);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(4, midY - 5);
      ctx.lineTo(w - 4, midY - 5);
      ctx.moveTo(4, midY + 5);
      ctx.lineTo(w - 4, midY + 5);
      ctx.stroke();
    } else {
      ctx.strokeStyle = theme.borderStrong;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(4, midY);
      ctx.lineTo(w - 4, midY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [edgeStyle, color]);

  return (
    <button type="button" onClick={onClick} title={`Apply the ${label} style`} style={swatchButtonStyle(armed)}>
      <canvas ref={canvasRef} />
      <span style={swatchLabelStyle}>{label}</span>
    </button>
  );
}

function BackgroundSwatchButton({
  bg,
  active,
  onClick,
}: {
  bg: CanvasBackground;
  active: boolean;
  onClick: () => void;
}) {
  const preset = CANVAS_THEMES[bg];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Workspace background: ${CANVAS_BACKGROUND_LABELS[bg]}`}
      style={swatchButtonStyle(active)}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 5,
          background: preset.background,
          border: `1px solid ${theme.borderStrong}`,
          position: 'relative',
        }}
      >
        {active && (
          <svg
            width={12}
            height={12}
            viewBox="0 0 16 16"
            style={{ position: 'absolute', top: 2, right: 2 }}
            fill="none"
            stroke={theme.accentStrong}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5 6.5 12 13 4" />
          </svg>
        )}
      </div>
      <span style={swatchLabelStyle}>{CANVAS_BACKGROUND_LABELS[bg]}</span>
    </button>
  );
}

function RibbonNumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: theme.text2 }}>{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v > 0) onChange(v);
        }}
        style={{
          width: 84,
          fontSize: 12,
          padding: '5px 7px',
          borderRadius: 5,
          border: `1px solid ${theme.borderStrong}`,
          background: theme.bgPanel2,
          color: theme.text1,
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function RibbonToggleButton({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 10px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'system-ui, sans-serif',
        borderRadius: 6,
        border: '1px solid ' + (active ? theme.accent : theme.borderStrong),
        background: active ? theme.accent : theme.bgPanel2,
        color: active ? '#ffffff' : theme.text2,
        cursor: 'pointer',
      }}
    >
      {label} {hint ? `(${hint})` : ''} {active ? 'ON' : 'OFF'}
    </button>
  );
}

function RibbonIconButton({
  label,
  title,
  icon,
  active,
  activeColor,
  disabled,
  dangerous,
  onClick,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  active?: boolean;
  activeColor?: string;
  disabled?: boolean;
  dangerous?: boolean;
  onClick?: () => void;
}) {
  const accent = activeColor ?? theme.accent;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...swatchButtonStyle(!!active, accent),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        color: dangerous && !disabled ? theme.danger : theme.text1,
      }}
    >
      <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
      <span style={swatchLabelStyle}>{label}</span>
    </button>
  );
}

function swatchButtonStyle(active: boolean, accent: string = theme.accent): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    padding: '5px 6px',
    borderRadius: 7,
    border: '1px solid ' + (active ? accent : theme.borderSoft),
    background: active ? hexWithAlpha(accent, 0.16) : theme.bgPanel2,
    cursor: 'pointer',
    textAlign: 'center',
  };
}

const swatchLabelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  textTransform: 'capitalize',
  color: theme.text2,
  whiteSpace: 'nowrap',
};

function iconProps(size = 16) {
  return { width: size, height: size, viewBox: '0 0 16 16', fill: 'none' as const, stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
}

function DeleteIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M3.5 4.5 4.2 13a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-8.5" />
    </svg>
  );
}
function MultiSelectIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="2.2 2.2" />
    </svg>
  );
}
function DuplicateIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2.5" y="4.5" width="8" height="9" rx="1.2" />
      <path d="M5.5 4.5V3a1.2 1.2 0 0 1 1.2-1.2h6.1A1.2 1.2 0 0 1 14 3v6.1a1.2 1.2 0 0 1-1.2 1.2H11.5" />
    </svg>
  );
}
function PanIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 8.5V3a1 1 0 1 1 2 0v4.5M8 7.5V2.3a1 1 0 1 1 2 0V7.5M10 7.8V3.6a1 1 0 1 1 2 0v6.9c0 2.5-1.8 4.5-4.5 4.5S3 13 3 10.5v-2a1 1 0 1 1 2 0" />
    </svg>
  );
}
function SketchIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5Z" />
    </svg>
  );
}
function ObjectsIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}
