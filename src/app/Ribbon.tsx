import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { NodeKind } from '../core/types';
import { nodeSkinDefaults } from '../skin/nodeSkin';
import { octagonVertices, traceClosedPath } from '../skin/octagon';
import type { EdgeStyle } from '../skin/pathSkin';
import type { SketchStyle } from './FluxCanvas';
import { hexWithAlpha } from '../skin/canvasUtil';
import { annotationIcons, ANNOTATION_ICON_COLOR, ANNOTATION_ICON_LABEL, ANNOTATION_ICON_ORDER } from '../skin/annotationIcons';
import type { AnnotationIconKind } from './annotationLayer';
import {
  theme,
  CANVAS_BACKGROUND_LABELS,
  CANVAS_BACKGROUND_ORDER,
  CANVAS_THEMES,
  type CanvasBackground,
} from './theme';

export type RibbonTab = 'home' | 'insert' | 'view' | 'manage' | 'layers' | 'tools';

/** Multi-select's hover flyout (2026-09-05, Falcon: "when i hover
 * over to multiselect i want it to have a secondary popup selection
 * such as all (select all), paths only, nodes only, sketches only,
 * (soon possible others)"). A plain array so a future addition is one
 * more row, not new branching logic. */
export type QuickSelectKind = 'all' | 'nodes' | 'paths' | 'sketches';
const QUICK_SELECT_OPTIONS: { kind: QuickSelectKind; label: string }[] = [
  { kind: 'all', label: 'Select all' },
  { kind: 'nodes', label: 'Nodes only' },
  { kind: 'paths', label: 'Paths only' },
  { kind: 'sketches', label: 'Sketches only' },
];

/** Sketch's own hover flyout (2026-09-05, Falcon: "there is no way to
 * end the continious lines... proposing a path style... 'single
 * path','polypath','3-point-arc path'"). Mirrors Multi-select's
 * QUICK_SELECT_OPTIONS above -- same flyout pattern, different menu.
 * 3-point-arc path was proposed alongside these but explicitly
 * deferred by Falcon as the challenging one; not listed here yet. */
const SKETCH_STYLE_OPTIONS: { style: SketchStyle; label: string; hint: string }[] = [
  { style: 'single', label: 'Single path', hint: 'One drag = one segment, finishes on release' },
  { style: 'polypath', label: 'Polypath', hint: 'Click to place each point, double-click/Enter to finish' },
];

const NODE_KINDS: NodeKind[] = ['source', 'distributor', 'merger', 'sorter', 'mixer', 'buffer', 'sink'];
const EDGE_STYLES: { style: EdgeStyle; label: string; color: string }[] = [
  { style: 'transparent', label: 'Transparent', color: theme.text3 },
  { style: 'trace', label: 'Trace', color: '#9aa1ad' },
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
  /** Title-strip project name (Falcon, 2026-09-04, comparing the port
   * against the mockup: "the rest are kind of missing" — the mockup's
   * title strip reads "FluxBoard — <project name>", centered). Null
   * while the manifest hasn't resolved yet (same brief window every
   * other project-aware UI already tolerates). */
  projectName: string | null;
  /** Quick-access Save (title strip). The real save is autosave every
   * 3s (App.tsx) — this just flushes it immediately on demand, same
   * function the project-switch/create flow already calls before
   * swapping projects. */
  onSaveNow: () => void;
  /** Undo/redo (Falcon, 2026-09-05: "i want to activate the undo and
   * redo features also") — full-project-snapshot history, App.tsx
   * owns the stack; these QAT icons are its only UI (Ctrl+Z/Ctrl+Y
   * also work, wired at the window level in App.tsx). Disabled
   * exactly when there's nothing to undo/redo. */
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;

  activeTab: RibbonTab;
  onTabChange: (tab: RibbonTab) => void;

  armedKind: NodeKind | null;
  onArmKind: (kind: NodeKind | null) => void;
  armedEdgeStyle: EdgeStyle | null;
  onArmEdgeStyle: (style: EdgeStyle | null) => void;
  sketchArmed: boolean;
  onArmSketch: (armed: boolean) => void;
  sketchStyle: SketchStyle;
  onSketchStyleChange: (style: SketchStyle) => void;
  /** FBP014 (2026-09-05): marquee-drag + click-to-toggle multi
   * selection — mirrors sketchArmed's arm-then-act flow. */
  multiSelectArmed: boolean;
  onArmMultiSelect: (armed: boolean) => void;
  /** FBP016 (2026-09-06): the ribbon MODIFY group's Move/Rotate tools
   * -- arm-then-drag "modes", same convention Pan/Multi-select already
   * use, replacing the now-redundant Pan/hand tool (empty-canvas drag
   * already pans for free without arming anything). Both apply only
   * to the current selection when it's a single path or sketch --
   * Falcon, 2026-09-06: "move,flip(horisontally,vertically),
   * rotate(path and sketches only)". */
  moveArmed: boolean;
  onArmMove: (armed: boolean) => void;
  rotateArmed: boolean;
  onArmRotate: (armed: boolean) => void;

  canDelete: boolean;
  onDeleteSelection: () => void;
  /** FBP014 (2026-09-05): clones the current selection (a node, or a
   * multi-select group) offset a few grid cells over. */
  canDuplicate: boolean;
  onDuplicateSelection: () => void;
  /** Multi-select's hover flyout (2026-09-05) — replaces the
   * selection with every item of the given kind(s) and arms the tool. */
  onQuickSelect: (kind: QuickSelectKind) => void;
  /** FBP016 (2026-09-06): direct-apply Modify actions -- Flip mirrors
   * the selected path/sketch's interior shape across its own
   * horizontal/vertical center axis (its two true endpoints never
   * move); Group/Ungroup fold the current multi-selection into a
   * persisted GroupRegistry entry (or dissolve one back apart). */
  canFlip: boolean;
  onFlipSelection: (axis: 'horizontal' | 'vertical') => void;
  canGroup: boolean;
  onGroupSelection: () => void;
  canUngroup: boolean;
  onUngroupSelection: () => void;

  /** FBP011 (2026-09-05): opens the OBJECTS registry manager — a
   * modal overlay (ObjectRegistryManager.tsx) rather than a ribbon-
   * strip group, since a type isn't "armed then placed" like a node/
   * path kind, it's a library entry referenced from elsewhere. */
  onOpenObjectsManager: () => void;

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
 * panel's NODES/PATHS/OBJECTS tabs plus a MODIFY group — Delete,
 * Multi-select, Duplicate, Move, Rotate, Flip, Group and Ungroup are
 * all real now (FBP014, 2026-09-05: the deferred Tools-tab concept,
 * folded in here instead of a separate tab; FBP016, 2026-09-06:
 * Move/Flip/Rotate/Group/Ungroup, replacing the old Pan/hand tool). Objects opens ObjectRegistryManager.tsx (FBP011,
 * 2026-09-05 — first-pass registry: shape/size/color per item type,
 * a modal rather than a ribbon group since a type is a referenced
 * library entry, not an arm-then-place kind). VIEW absorbs the
 * properties panel's old "Canvas & simulation" section (grid
 * spacing, sim tick interval, snap-to-grid) plus the new workspace-
 * background setting Falcon asked for. INSERT/MANAGE/LAYERS/TOOLS are
 * inert placeholders — real content for those needs more spec first
 * (ICONS/LABEL overlay, LAYERS' z-axis floor stacking, TOOLS' measure
 * tool — see claude/build-log.md).
 */
export function Ribbon({
  projectName,
  onSaveNow,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  activeTab,
  onTabChange,
  armedKind,
  onArmKind,
  armedEdgeStyle,
  onArmEdgeStyle,
  sketchArmed,
  onArmSketch,
  sketchStyle,
  onSketchStyleChange,
  multiSelectArmed,
  onArmMultiSelect,
  moveArmed,
  onArmMove,
  rotateArmed,
  onArmRotate,
  canDelete,
  onDeleteSelection,
  canDuplicate,
  onDuplicateSelection,
  onQuickSelect,
  canFlip,
  onFlipSelection,
  canGroup,
  onGroupSelection,
  canUngroup,
  onUngroupSelection,
  onOpenObjectsManager,
  snapToGrid,
  onToggleSnapToGrid,
  gridSpacing,
  onGridSpacingChange,
  tickIntervalMs,
  onTickIntervalMsChange,
  canvasBackground,
  onCanvasBackgroundChange,
}: RibbonProps) {
  // Multi-select's hover flyout (2026-09-05) — open while the mouse is
  // over the button OR the flyout itself. Rendered via a portal into
  // document.body (below) so it floats free of the ribbon row's
  // overflow-x scroll container — setting overflow-x to anything but
  // `visible` silently makes overflow-y `auto` too (one axis can't stay
  // `visible` while the other doesn't), which was clipping this flyout
  // and forcing a scroll of the whole row to see it in full. Any future
  // ribbon dropdown should follow the same anchor-ref + portal pattern.
  const quickSelectAnchorRef = useRef<HTMLDivElement>(null);
  const [quickSelectOpen, setQuickSelectOpen] = useState(false);
  const [quickSelectPos, setQuickSelectPos] = useState<{ top: number; left: number } | null>(null);
  const openQuickSelect = () => {
    const rect = quickSelectAnchorRef.current?.getBoundingClientRect();
    if (rect) setQuickSelectPos({ top: rect.bottom + 2, left: rect.left });
    setQuickSelectOpen(true);
  };

  // Sketch style's own hover flyout -- identical shape to Multi-
  // select's above, just a second anchor/open/pos triple for the
  // Sketch tool button instead.
  const sketchStyleAnchorRef = useRef<HTMLDivElement>(null);
  const [sketchStyleOpen, setSketchStyleOpen] = useState(false);
  const [sketchStylePos, setSketchStylePos] = useState<{ top: number; left: number } | null>(null);
  const openSketchStyle = () => {
    const rect = sketchStyleAnchorRef.current?.getBoundingClientRect();
    if (rect) setSketchStylePos({ top: rect.bottom + 2, left: rect.left });
    setSketchStyleOpen(true);
  };

  return (
    <div style={{ flexShrink: 0, background: theme.bgPanel, borderBottom: `1px solid ${theme.border}` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '5px 10px',
          borderBottom: `1px solid ${theme.borderSoft}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <QatIconButton title="Save now" onClick={onSaveNow} icon={<SaveIcon />} />
          <QatIconButton title="Export — coming soon" disabled icon={<ExportIcon />} />
          <span style={{ width: 1, height: 16, background: theme.borderSoft, margin: '0 4px' }} />
          <QatIconButton
            title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
            disabled={!canUndo}
            onClick={onUndo}
            icon={<UndoIcon />}
          />
          <QatIconButton
            title={canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo'}
            disabled={!canRedo}
            onClick={onRedo}
            icon={<RedoIcon />}
          />
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.text1, letterSpacing: 0.2, textAlign: 'center' }}>
          FluxBoard{projectName ? ` — ${projectName}` : ''}
        </div>
        <div style={{ flex: 1 }} />
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${theme.borderSoft}` }}>
        {TABS.map(({ tab, label }) => (
          <button key={tab} type="button" onClick={() => onTabChange(tab)} style={tabButtonStyle(activeTab === tab)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 84, padding: '6px 10px', overflowX: 'auto', overflowY: 'visible' }}>
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
                <div
                  ref={sketchStyleAnchorRef}
                  onMouseEnter={openSketchStyle}
                  onMouseLeave={() => setSketchStyleOpen(false)}
                >
                  <RibbonIconButton
                    label="Sketch"
                    title={`Sketch a planning path — drag anywhere on the canvas, no simulation meaning (style: ${
                      SKETCH_STYLE_OPTIONS.find((o) => o.style === sketchStyle)?.label ?? 'Single path'
                    }; hover for more)`}
                    active={sketchArmed}
                    activeColor={theme.sketch}
                    onClick={() => onArmSketch(!sketchArmed)}
                    icon={<SketchIcon />}
                  />
                  {sketchStyleOpen &&
                    sketchStylePos &&
                    createPortal(
                      <div
                        style={{ ...quickSelectMenuStyle, top: sketchStylePos.top, left: sketchStylePos.left, minWidth: 210 }}
                        onMouseEnter={openSketchStyle}
                        onMouseLeave={() => setSketchStyleOpen(false)}
                      >
                        {SKETCH_STYLE_OPTIONS.map(({ style, label, hint }) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => {
                              onSketchStyleChange(style);
                              setSketchStyleOpen(false);
                            }}
                            style={{
                              ...quickSelectItemStyle,
                              background: sketchStyle === style ? theme.bgPanel2 : 'transparent',
                            }}
                          >
                            <div>{label}</div>
                            <div style={{ fontSize: 10, fontWeight: 400, color: theme.text3, marginTop: 1 }}>{hint}</div>
                          </button>
                        ))}
                      </div>,
                      document.body,
                    )}
                </div>
              </div>
            </RibbonGroup>
            <RibbonGroup title="Objects">
              <div style={{ display: 'flex', gap: 4 }}>
                <RibbonIconButton
                  label="Items"
                  title="Manage item types — shape, size, color"
                  onClick={onOpenObjectsManager}
                  icon={<ObjectsIcon />}
                />
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
                <div
                  ref={quickSelectAnchorRef}
                  onMouseEnter={openQuickSelect}
                  onMouseLeave={() => setQuickSelectOpen(false)}
                >
                  <RibbonIconButton
                    label="Multi-select"
                    title="Click nodes to toggle them in, drag over empty canvas to box-select, or hover for quick-select"
                    active={multiSelectArmed}
                    onClick={() => onArmMultiSelect(!multiSelectArmed)}
                    icon={<MultiSelectIcon />}
                  />
                  {quickSelectOpen &&
                    quickSelectPos &&
                    createPortal(
                      <div
                        style={{ ...quickSelectMenuStyle, top: quickSelectPos.top, left: quickSelectPos.left }}
                        onMouseEnter={openQuickSelect}
                        onMouseLeave={() => setQuickSelectOpen(false)}
                      >
                        {QUICK_SELECT_OPTIONS.map(({ kind, label }) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => {
                              onQuickSelect(kind);
                              setQuickSelectOpen(false);
                            }}
                            style={quickSelectItemStyle}
                          >
                            {label}
                          </button>
                        ))}
                      </div>,
                      document.body,
                    )}
                </div>
                <RibbonIconButton
                  label="Duplicate"
                  title={canDuplicate ? 'Clone the selected node(s), offset a few grid cells over' : 'Select a node first'}
                  disabled={!canDuplicate}
                  onClick={onDuplicateSelection}
                  icon={<DuplicateIcon />}
                />
                <RibbonIconButton
                  label="Move"
                  title="Drag to reshape the selected path/sketch's curve — its two ends stay pinned"
                  active={moveArmed}
                  onClick={() => onArmMove(!moveArmed)}
                  icon={<MoveIcon />}
                />
                <RibbonIconButton
                  label="Rotate"
                  title="Drag to spin the selected path/sketch's curve around its own center — snaps near 15° steps"
                  active={rotateArmed}
                  onClick={() => onArmRotate(!rotateArmed)}
                  icon={<RotateIcon />}
                />
                <RibbonIconButton
                  label="Flip H"
                  title={canFlip ? "Mirror the selected path/sketch's curve left-right" : 'Select a path or sketch first'}
                  disabled={!canFlip}
                  onClick={() => onFlipSelection('horizontal')}
                  icon={<FlipHIcon />}
                />
                <RibbonIconButton
                  label="Flip V"
                  title={canFlip ? "Mirror the selected path/sketch's curve top-bottom" : 'Select a path or sketch first'}
                  disabled={!canFlip}
                  onClick={() => onFlipSelection('vertical')}
                  icon={<FlipVIcon />}
                />
                <RibbonIconButton
                  label="Group"
                  title={canGroup ? 'Fold the current selection into one persisted group' : 'Select 2+ ungrouped items first'}
                  disabled={!canGroup}
                  onClick={onGroupSelection}
                  icon={<GroupIcon />}
                />
                <RibbonIconButton
                  label="Ungroup"
                  title={canUngroup ? 'Dissolve this group back into its individual items' : 'Select a group first'}
                  disabled={!canUngroup}
                  onClick={onUngroupSelection}
                  icon={<UngroupIcon />}
                />
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

        {activeTab === 'insert' && (
          <RibbonGroup title="Icons">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {ANNOTATION_ICON_ORDER.map((kind) => (
                  <AnnotationSwatchButton key={kind} kind={kind} />
                ))}
              </div>
              <p style={{ fontSize: 10, color: theme.text3, lineHeight: 1.4, maxWidth: 420, margin: '4px 0 0' }}>
                Drag an icon onto the canvas to drop a free-floating annotation there (no simulation meaning) — pick
                it up on the canvas afterward to type a label or move it.
              </p>
            </div>
          </RibbonGroup>
        )}

        {(activeTab === 'manage' || activeTab === 'layers' || activeTab === 'tools') && (
          <PlaceholderTabContent tab={activeTab} />
        )}
      </div>
    </div>
  );
}

function PlaceholderTabContent({ tab }: { tab: RibbonTab }) {
  const copy: Record<string, string> = {
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

/** INSERT tab icon swatch (Falcon, 2026-09-09: "free-floating on
 * canvas for now" / "click-and-drag"): draggable rather than arm-
 * then-click like every other palette here, since Falcon specifically
 * picked drag-and-drop for this one — dataTransfer carries the icon
 * kind as plain text, read back by FluxCanvas's onDrop handler. */
function AnnotationSwatchButton({ kind }: { kind: AnnotationIconKind }) {
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
    const center = { x: size / 2, y: size / 2 };
    const r = size * 0.42;
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = ANNOTATION_ICON_COLOR[kind];
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = ANNOTATION_ICON_COLOR[kind];
    annotationIcons[kind](ctx, center.x, center.y, r * 1.5);
  }, [kind]);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-fluxboard-annotation-icon', kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`Drag onto the canvas to place a ${ANNOTATION_ICON_LABEL[kind]} annotation`}
      style={swatchButtonStyle(false)}
    >
      <canvas ref={canvasRef} />
      <span style={swatchLabelStyle}>{ANNOTATION_ICON_LABEL[kind]}</span>
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
    } else if (edgeStyle === 'trace') {
      // Matches the real drawPathUnder 'trace' render: a thin solid
      // line at full color opacity, plus a small arrowhead like
      // drawPathDirectionArrow draws on every real path.
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(4, midY);
      ctx.lineTo(w - 7, midY);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(w - 4, midY);
      ctx.lineTo(w - 9, midY - 3);
      ctx.lineTo(w - 9, midY + 3);
      ctx.closePath();
      ctx.fill();
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

// Multi-select's hover flyout (2026-09-05) — a small dropdown portaled
// into document.body, positioned via the anchor's live getBoundingClientRect
// (top/left set at render time, see the wrapper above).
const quickSelectMenuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 20,
  minWidth: 130,
  display: 'flex',
  flexDirection: 'column',
  background: theme.bgPanel2,
  border: `1px solid ${theme.borderStrong}`,
  borderRadius: 6,
  padding: 4,
  boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
};

const quickSelectItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: theme.text1,
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  padding: '6px 8px',
  cursor: 'pointer',
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
function MoveIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M8 2.5v11M2.5 8h11" />
      <path d="M8 2.5 6 4.5M8 2.5 10 4.5M8 13.5 6 11.5M8 13.5 10 11.5M2.5 8 4.5 6M2.5 8 4.5 10M13.5 8 11.5 6M13.5 8 11.5 10" />
    </svg>
  );
}
function RotateIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12.5 8A4.5 4.5 0 1 1 10.7 4.4" />
      <path d="M12.8 2.6 12.5 5.6 9.6 5.1" />
    </svg>
  );
}
function FlipHIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M8 2v12" strokeDasharray="1.6 1.6" />
      <path d="M5.5 4.5 3 6v4l2.5 1.5Z" />
      <path d="M10.5 4.5 13 6v4l-2.5 1.5Z" />
    </svg>
  );
}
function FlipVIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M2 8h12" strokeDasharray="1.6 1.6" />
      <path d="M4.5 5.5 6 3h4l1.5 2.5Z" />
      <path d="M4.5 10.5 6 13h4l1.5-2.5Z" />
    </svg>
  );
}
function GroupIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
      <rect x="6.5" y="6.5" width="7" height="7" rx="1" />
    </svg>
  );
}
function UngroupIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2" y="2.5" width="5.2" height="5.2" rx="1" />
      <rect x="8.8" y="8.3" width="5.2" height="5.2" rx="1" />
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

/** Title-strip icon button — smaller/flatter than the ribbon-group
 * swatch buttons below (`swatchButtonStyle`), no label underneath,
 * matching the mockup's QAT row. */
function QatIconButton({
  title,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 5,
        background: 'transparent',
        color: theme.text2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
    </button>
  );
}

function SaveIcon() {
  return (
    <svg {...iconProps(14)}>
      <path d="M2.5 2.5h9l2 2v9h-11z" />
      <path d="M4.5 2.5v4h6v-4" />
      <path d="M4.5 13.5v-4h7v4" />
    </svg>
  );
}
function ExportIcon() {
  return (
    <svg {...iconProps(14)}>
      <path d="M8 10.5V2.5" />
      <path d="M5 5.5 8 2.5l3 3" />
      <path d="M2.5 10.5v2.2a.8.8 0 0 0 .8.8h9.4a.8.8 0 0 0 .8-.8v-2.2" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg {...iconProps(14)}>
      <path d="M4 4.5H10.5a3.5 3.5 0 0 1 0 7H7" />
      <path d="M6 2 3.5 4.5 6 7" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg {...iconProps(14)}>
      <path d="M12 4.5H5.5a3.5 3.5 0 0 0 0 7H9" />
      <path d="M10 2l2.5 2.5L10 7" />
    </svg>
  );
}
