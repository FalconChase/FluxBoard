import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GraphModel } from '../core/GraphModel';
import type { EdgeDef, NodeDef } from '../core/types';
import { getPortCapacity } from '../core/nodes/portCapacity';
import { hasSignalInput, watchedNodeIds, defaultVerbForTargetKind } from '../core/nodes/index';
import { compassLabel } from '../skin/octagon';
import type { FloorLayout } from '../floor/floorLayout';
import type { SkinConfig } from '../skin/SkinConfig';
import type { EdgeStyle, ItemOrientationMode } from '../skin/pathSkin';
import type { ObjectRegistry } from '../skin/ObjectRegistry';
import type { Selection } from './selection';
import type { Sketch, SketchLayer } from './sketchLayer';
import type { AnnotationLayer } from './annotationLayer';
import type { CustomIconLibrary } from '../skin/customIconLibrary';
import {
  ANNOTATION_ICON_LABEL,
  ANNOTATION_ICON_ORDER,
  ANNOTATION_FONT_FAMILIES,
  ANNOTATION_DEFAULT_FONT_FAMILY,
  type AnnotationIconKind,
} from '../skin/annotationIcons';
import { theme } from './theme';

interface PropertiesPanelProps {
  /** Falcon, 2026-09-04 (comparing the real port against the approved
   * mockup): "the rest are kind of missing in the UI" — the mockup's
   * PROPERTIES panel is a permanent right-docked column with an idle
   * placeholder, not a floating overlay that vanishes when nothing is
   * selected. Reverted to that; null means show the placeholder. */
  selection: Selection | null;
  graph: GraphModel;
  skinConfig: SkinConfig;
  floorLayout: FloorLayout;
  sketchLayer: SketchLayer;
  /** Canvas annotations (INSERT tab, 2026-09-09) — free-floating
   * icon+label markers, no simulation meaning. */
  annotationLayer: AnnotationLayer;
  /** Edits an annotation's free-text label in place. */
  onUpdateAnnotationLabel: (id: string, label: string) => void;
  /** Custom icon library (2026-09-09) — only read here to show a
   * 'custom'-kind annotation's icon name/preview; importing/deleting
   * lives in the Ribbon's INSERT tab, not this panel. */
  customIconLibrary: CustomIconLibrary;
  /** OBJECTS registry (FBP011, 2026-09-05) — lets SourceFields/
   * SorterFields/MixerFields offer a dropdown of actually-registered
   * item types instead of a free-text field that can silently
   * reference nothing renderable. */
  objectRegistry: ObjectRegistry;
  /** Deletes whatever is currently selected (node — cascading to its
   * edges — or edge). App.tsx owns the actual GraphModel/FloorLayout/
   * SkinConfig cleanup and the Delete/Backspace shortcut; this panel
   * only offers the same action as a button, and doesn't need to know
   * the selection's id since App.tsx already has it. */
  onDelete: () => void;
  /** FBP014 (2026-09-05): clones the selected node (or every member
   * of a multi selection) — the properties panel's own button, same
   * action as the ribbon's Duplicate tool. Not offered for an edge or
   * a sketch selection (neither renders a Duplicate button). */
  onDuplicate: () => void;
  /** Falcon, 2026-09-05: turns a fully-pinned sketch (both ends
   * attached to a real port) into a real path, at the chosen style.
   * Only ever called when SketchProperties actually shows the
   * control, i.e. both ends are attached — App.tsx re-checks anyway. */
  onConvertSketch: (sketchId: string, style: EdgeStyle) => void;
  /** Falcon, 2026-09-05 ("no way i can snap a sketch to a node's
   * port"): pins a currently-floating end of an existing sketch to
   * the nearest free port, without redrawing it. Only ever called
   * when that end is actually unattached (the button isn't shown
   * otherwise). */
  onPinSketchEnd: (sketchId: string, end: 'from' | 'to') => void;
  /** Multi-select batch actions (Falcon, 2026-09-05: "i want to
   * convert as many in one go") -- only offered by MultiProperties
   * when the selection is ENTIRELY sketches (batch convert) or
   * ENTIRELY paths (batch restyle); a mixed selection just gets the
   * generic Duplicate/Delete below. */
  onBatchConvertSketches: (sketchIds: string[], style: EdgeStyle) => void;
  onBatchRestyleEdges: (edgeIds: string[], style: EdgeStyle) => void;
}

const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 600, color: theme.text2, display: 'block', marginBottom: 3 };
const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '5px 7px',
  borderRadius: 5,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.bgPanel2,
  color: theme.text1,
  boxSizing: 'border-box',
};
const rowStyle: CSSProperties = { marginBottom: 10 };
const sectionTitleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: theme.text3,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  margin: '14px 0 8px',
};

/**
 * Right-docked properties panel (design doc §4.6 — "every node type
 * has a properties panel that reads/writes its logic-layer config,"
 * FBP008's minimal-chrome resolution). Reads/writes GraphModel and
 * SkinConfig directly — they're the single source of truth (§4.6:
 * "never a second source of truth") — the canvas picks up any change
 * on its next animation frame with no extra plumbing needed.
 *
 * The parent keys this component on the selection identity, so every
 * field below can hold plain local state without worrying about
 * stale values from a previous selection.
 */
export function PropertiesPanel({
  selection,
  graph,
  skinConfig,
  floorLayout,
  sketchLayer,
  annotationLayer,
  onUpdateAnnotationLabel,
  customIconLibrary,
  objectRegistry,
  onDelete,
  onDuplicate,
  onConvertSketch,
  onPinSketchEnd,
  onBatchConvertSketches,
  onBatchRestyleEdges,
}: PropertiesPanelProps) {
  // Keys just the selection-editing block, not the whole panel — so
  // every field inside NodeProperties/EdgeProperties can hold plain
  // local state without worrying about stale values from a previous
  // selection, while the panel itself (and its idle placeholder)
  // stays permanently mounted.
  const selectionKey = selection
    ? selection.type === 'multi'
      ? `multi:${selection.nodeIds.join(',')}|${selection.edgeIds.join(',')}|${selection.sketchIds.join(',')}`
      : selection.type === 'sketch' && selection.segmentIndex !== undefined
        ? `sketch:${selection.id}:${selection.segmentIndex}`
        : `${selection.type}:${selection.id}`
    : 'none';

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        overflowY: 'auto',
        background: theme.bgPanel,
        borderLeft: `1px solid ${theme.border}`,
        padding: '12px 14px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: theme.text3,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 10,
        }}
      >
        Properties
      </div>
      <div key={selectionKey}>
        {selection === null && (
          <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
            Select a node or path to edit its properties.
          </p>
        )}
        {selection?.type === 'node' && (
          <NodeProperties
            nodeId={selection.id}
            graph={graph}
            skinConfig={skinConfig}
            floorLayout={floorLayout}
            objectRegistry={objectRegistry}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
        )}
        {selection?.type === 'multi' && (
          <MultiProperties
            nodeIds={selection.nodeIds}
            edgeIds={selection.edgeIds}
            sketchIds={selection.sketchIds}
            groupId={selection.groupId}
            graph={graph}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onBatchConvertSketches={onBatchConvertSketches}
            onBatchRestyleEdges={onBatchRestyleEdges}
          />
        )}
        {selection?.type === 'edge' && (
          <EdgeProperties
            edgeId={selection.id}
            graph={graph}
            skinConfig={skinConfig}
            floorLayout={floorLayout}
            onDelete={onDelete}
          />
        )}
        {selection?.type === 'sketch' && (
          <SketchProperties
            sketchId={selection.id}
            segmentIndex={selection.segmentIndex}
            sketchLayer={sketchLayer}
            graph={graph}
            onDelete={onDelete}
            onConvertSketch={onConvertSketch}
            onPinSketchEnd={onPinSketchEnd}
          />
        )}
        {selection?.type === 'annotation' && (
          <AnnotationProperties
            annotationId={selection.id}
            annotationLayer={annotationLayer}
            customIconLibrary={customIconLibrary}
            onUpdateLabel={onUpdateAnnotationLabel}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}

function ZOrderButtons({ nodeId, graph, skinConfig }: { nodeId: string; graph: GraphModel; skinConfig: SkinConfig }) {
  function bringToFront(): void {
    const maxZ = Math.max(0, ...graph.getAllNodes().map((n) => skinConfig.getNodeZIndex(n.id)));
    skinConfig.setNodeZIndex(nodeId, maxZ + 1);
  }
  function sendToBack(): void {
    const minZ = Math.min(0, ...graph.getAllNodes().map((n) => skinConfig.getNodeZIndex(n.id)));
    skinConfig.setNodeZIndex(nodeId, minZ - 1);
  }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button type="button" onClick={bringToFront} style={smallButtonStyle}>
        Bring to front
      </button>
      <button type="button" onClick={sendToBack} style={smallButtonStyle}>
        Send to back
      </button>
    </div>
  );
}

const smallButtonStyle: CSSProperties = {
  flex: 1,
  fontSize: 11,
  padding: '5px 6px',
  borderRadius: 5,
  border: '1px solid ' + theme.borderStrong,
  background: theme.bgPanel2,
  cursor: 'pointer',
};

function NodeProperties({
  nodeId,
  graph,
  skinConfig,
  floorLayout,
  objectRegistry,
  onDelete,
  onDuplicate,
}: {
  nodeId: string;
  graph: GraphModel;
  skinConfig: SkinConfig;
  floorLayout: FloorLayout;
  objectRegistry: ObjectRegistry;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const node = graph.getNode(nodeId);
  if (!node) return <p style={{ fontSize: 12, color: theme.danger }}>Node no longer exists.</p>;

  function patch(fields: Record<string, unknown>): void {
    graph.updateNodeConfig(nodeId, fields);
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize', marginBottom: 2 }}>{node.kind}</div>
      <div style={{ fontSize: 11, color: theme.text3, marginBottom: 4 }}>{node.id}</div>

      {node.kind === 'source' && <SourceFields node={node} graph={graph} onChange={patch} objectRegistry={objectRegistry} />}
      {node.kind === 'distributor' && <DistributorFields node={node} onChange={patch} graph={graph} />}
      {node.kind === 'merger' && (
        <p style={{ fontSize: 12, color: theme.text3 }}>
          Merger has nothing to configure — every arriving item forwards straight out its one output.
        </p>
      )}
      {node.kind === 'sorter' && <SorterFields node={node} onChange={patch} objectRegistry={objectRegistry} graph={graph} />}
      {node.kind === 'mixer' && <MixerFields node={node} onChange={patch} objectRegistry={objectRegistry} graph={graph} />}
      {node.kind === 'buffer' && <BufferFields node={node} onChange={patch} graph={graph} />}
      {node.kind === 'sink' && (
        <p style={{ fontSize: 12, color: theme.text3 }}>Sink has nothing to configure — it just consumes.</p>
      )}
      {node.kind === 'gate' && <GateFields nodeId={nodeId} graph={graph} />}
      {node.kind === 'sensor' && <SensorFields node={node} graph={graph} onChange={patch} />}
      {node.kind === 'counter' && <CounterFields node={node} graph={graph} onChange={patch} />}
      {node.kind === 'command' && <CommandFields node={node} graph={graph} onChange={patch} />}
      {node.kind === 'time' && <TimeFields node={node} graph={graph} onChange={patch} />}
      {node.kind === 'transform' && <TransformFields node={node} onChange={patch} objectRegistry={objectRegistry} />}

      <SingleOutputSidePicker nodeId={nodeId} kind={node.kind} graph={graph} floorLayout={floorLayout} />

      <div style={sectionTitleStyle}>Icon</div>
      <NodeIconFields nodeId={nodeId} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Z-order</div>
      <ZOrderButtons nodeId={nodeId} graph={graph} skinConfig={skinConfig} />

      <DockSection nodeId={nodeId} graph={graph} floorLayout={floorLayout} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Position</div>
      <LockToggle nodeId={nodeId} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Modify</div>
      <button type="button" onClick={onDuplicate} style={{ ...smallButtonStyle, width: '100%' }}>
        Duplicate node
      </button>

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: theme.danger, borderColor: theme.dangerSoft }}
      >
        Delete node
      </button>
    </div>
  );
}

/** Falcon, 2026-09-09 ("add icon on the node properties with the
 * same configuration [as annotations] ... never or conveniently
 * attach together the node and the icon"): a node-level override for
 * the same built-in glyph set annotations use, stored in SkinConfig
 * (skin-owned, purely cosmetic) and drawn on top of the node's own
 * octagon body by nodeSkin.ts's drawNode. "None" clears the override
 * back to the node kind's plain default icon. */
function NodeIconFields({ nodeId, skinConfig }: { nodeId: string; skinConfig: SkinConfig }) {
  const current = skinConfig.getNodeIcon(nodeId);
  const [icon, setIcon] = useState<AnnotationIconKind | ''>(current?.icon ?? '');
  const [iconSize, setIconSize] = useState(current?.iconSize ?? 22);
  const [badge, setBadge] = useState(current?.badge ?? false);
  const [badgeColor, setBadgeColor] = useState(current?.badgeColor ?? '#ffffff');
  const [label, setLabel] = useState(current?.label ?? '');
  const [fontSize, setFontSize] = useState(current?.fontSize ?? 14);
  const [fontFamily, setFontFamily] = useState(current?.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY);
  const [color, setColor] = useState(current?.color ?? '#1f2430');
  const [bold, setBold] = useState(current?.bold ?? false);
  const [italic, setItalic] = useState(current?.italic ?? false);

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>Glyph</label>
      <select
        value={icon}
        style={inputStyle}
        onChange={(e) => {
          const next = e.target.value as AnnotationIconKind | '';
          setIcon(next);
          if (next === '') skinConfig.removeNodeIcon(nodeId);
          else skinConfig.setNodeIcon(nodeId, { icon: next, iconSize, badge, badgeColor });
        }}
      >
        <option value="">None (kind default)</option>
        {ANNOTATION_ICON_ORDER.map((kind) => (
          <option key={kind} value={kind}>
            {ANNOTATION_ICON_LABEL[kind]}
          </option>
        ))}
      </select>

      {icon !== '' && (
        <>
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle}>Size</label>
            <input
              type="number"
              min={4}
              max={200}
              value={iconSize}
              style={inputStyle}
              onChange={(e) => {
                const n = Number(e.target.value);
                setIconSize(n);
                if (Number.isFinite(n) && n > 0) skinConfig.setNodeIcon(nodeId, { icon, iconSize: n });
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: badge ? 8 : 0 }}>
            <button
              type="button"
              onClick={() => {
                const next = !badge;
                setBadge(next);
                skinConfig.setNodeIcon(nodeId, { icon, badge: next });
              }}
              title="Show a colored badge circle behind the icon"
              style={{
                ...smallButtonStyle,
                flex: 1,
                fontWeight: 700,
                color: badge ? theme.accentStrong : theme.text1,
                borderColor: badge ? theme.accent : theme.borderStrong,
              }}
            >
              Badge {badge ? 'on' : 'off'}
            </button>
          </div>
          {badge && (
            <div>
              <label style={labelStyle}>Badge color</label>
              <input
                type="color"
                value={badgeColor}
                style={{ ...inputStyle, padding: 2, height: 30 }}
                onChange={(e) => {
                  setBadgeColor(e.target.value);
                  skinConfig.setNodeIcon(nodeId, { icon, badgeColor: e.target.value });
                }}
              />
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Label</label>
            <input
              type="text"
              value={label}
              placeholder="(no label)"
              style={inputStyle}
              onChange={(e) => {
                setLabel(e.target.value);
                skinConfig.setNodeIcon(nodeId, { icon, label: e.target.value });
              }}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <label style={labelStyle}>Font style</label>
            <select
              value={fontFamily}
              style={inputStyle}
              onChange={(e) => {
                setFontFamily(e.target.value);
                skinConfig.setNodeIcon(nodeId, { icon, fontFamily: e.target.value });
              }}
            >
              {ANNOTATION_FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Font size</label>
              <input
                type="number"
                min={4}
                max={200}
                value={fontSize}
                style={inputStyle}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setFontSize(n);
                  if (Number.isFinite(n) && n > 0) skinConfig.setNodeIcon(nodeId, { icon, fontSize: n });
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Font color</label>
              <input
                type="color"
                value={color}
                style={{ ...inputStyle, padding: 2, height: 30 }}
                onChange={(e) => {
                  setColor(e.target.value);
                  skinConfig.setNodeIcon(nodeId, { icon, color: e.target.value });
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                const next = !bold;
                setBold(next);
                skinConfig.setNodeIcon(nodeId, { icon, bold: next });
              }}
              title="Bold"
              style={{
                ...smallButtonStyle,
                flex: 1,
                fontWeight: 700,
                color: bold ? theme.accentStrong : theme.text1,
                borderColor: bold ? theme.accent : theme.borderStrong,
              }}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !italic;
                setItalic(next);
                skinConfig.setNodeIcon(nodeId, { icon, italic: next });
              }}
              title="Italic"
              style={{
                ...smallButtonStyle,
                flex: 1,
                fontStyle: 'italic',
                color: italic ? theme.accentStrong : theme.text1,
                borderColor: italic ? theme.accent : theme.borderStrong,
              }}
            >
              I
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** FBP014 (2026-09-05): the multi-select group's own properties view
 * — no per-field editing (each node kind's config differs too much to
 * show a merged form), just a manifest of what's selected plus the
 * same Duplicate/Delete actions the ribbon's MODIFY group offers. */
function MultiProperties({
  nodeIds,
  edgeIds,
  sketchIds,
  groupId,
  graph,
  onDelete,
  onDuplicate,
  onBatchConvertSketches,
  onBatchRestyleEdges,
}: {
  nodeIds: string[];
  edgeIds: string[];
  sketchIds: string[];
  /** FBP016 (2026-09-06): set when this multi selection is a
   * persisted GroupRegistry entry, not just a transient marquee/
   * quick-select group -- Ungroup lives in the ribbon's MODIFY group,
   * this is just a small indicator so it's clear which kind of
   * selection this is. */
  groupId?: string;
  graph: GraphModel;
  onDelete: () => void;
  onDuplicate: () => void;
  onBatchConvertSketches: (sketchIds: string[], style: EdgeStyle) => void;
  onBatchRestyleEdges: (edgeIds: string[], style: EdgeStyle) => void;
}) {
  const [batchStyle, setBatchStyle] = useState<EdgeStyle>('trace');
  const counts = new Map<string, number>();
  for (const id of nodeIds) {
    const node = graph.getNode(id);
    if (!node) continue;
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  }
  // Quick-select (2026-09-05) can build a mixed group — paths and
  // sketches count toward the total but have no per-kind config to
  // summarize the way node kinds do, so they're just one line each.
  const summaryParts = [...counts.entries()].map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`);
  if (edgeIds.length > 0) summaryParts.push(`${edgeIds.length} path${edgeIds.length === 1 ? '' : 's'}`);
  if (sketchIds.length > 0) summaryParts.push(`${sketchIds.length} sketch${sketchIds.length === 1 ? '' : 'es'}`);
  const total = nodeIds.length + edgeIds.length + sketchIds.length;
  const canDuplicate = nodeIds.length > 0;

  // Batch convert/restyle (Falcon, 2026-09-05: "the sketches only
  // options may have possible actions such as delete group/convert to
  // path, and or so for paths only ... will convert all also/delete
  // group") — only offered when the selection is ENTIRELY one kind;
  // a mixed group (nodes present, or paths+sketches together) falls
  // through to just Duplicate/Delete below.
  const sketchesOnly = nodeIds.length === 0 && edgeIds.length === 0 && sketchIds.length > 0;
  const pathsOnly = nodeIds.length === 0 && sketchIds.length === 0 && edgeIds.length > 0;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
        {total} items selected{groupId ? ' — grouped' : ''}
      </div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5, marginBottom: 10 }}>{summaryParts.join(', ')}</p>
      {groupId && (
        <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginBottom: 10 }}>
          This is a saved group — clicking any member selects the whole group again. Use Ungroup in the ribbon's
          Modify group to dissolve it.
        </p>
      )}
      {nodeIds.length > 0 && (
        <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
          Drag any selected node to move the whole group together.
        </p>
      )}

      {(sketchesOnly || pathsOnly) && (
        <>
          <div style={sectionTitleStyle}>{sketchesOnly ? 'Convert to path' : 'Convert all'}</div>
          <div style={rowStyle}>
            <label style={labelStyle}>Path style</label>
            <select value={batchStyle} style={inputStyle} onChange={(e) => setBatchStyle(e.target.value as EdgeStyle)}>
              <option value="transparent">Transparent</option>
              <option value="conveyor">Conveyor</option>
              <option value="glassTube">Glass tube</option>
              <option value="trace">Trace</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() =>
              sketchesOnly ? onBatchConvertSketches(sketchIds, batchStyle) : onBatchRestyleEdges(edgeIds, batchStyle)
            }
            style={{
              ...smallButtonStyle,
              width: '100%',
              color: theme.accentStrong,
              borderColor: theme.accent,
              marginBottom: 10,
            }}
          >
            {sketchesOnly
              ? `Convert ${sketchIds.length} sketch${sketchIds.length === 1 ? '' : 'es'} to path`
              : `Restyle ${edgeIds.length} path${edgeIds.length === 1 ? '' : 's'}`}
          </button>
          {sketchesOnly && (
            <p style={{ fontSize: 10, color: theme.text3, lineHeight: 1.4, marginTop: -6, marginBottom: 10 }}>
              Only sketches with both ends pinned to a port convert — the rest are skipped and reported.
            </p>
          )}
        </>
      )}

      <div style={sectionTitleStyle}>Modify</div>
      <button
        type="button"
        onClick={onDuplicate}
        disabled={!canDuplicate}
        title={canDuplicate ? undefined : 'Duplicate only clones nodes — this selection has none'}
        style={{ ...smallButtonStyle, width: '100%', opacity: canDuplicate ? 1 : 0.5, cursor: canDuplicate ? 'pointer' : 'not-allowed' }}
      >
        Duplicate group
      </button>

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: theme.danger, borderColor: theme.dangerSoft }}
      >
        Delete group
      </button>
    </div>
  );
}

/** "Toggle which side to output" (Falcon, 2026-09-03) — for a kind
 * whose nature caps it to exactly one output (source, mixer — see
 * portCapacity.ts), lets the user reassign that single output's
 * anchor directly instead of redoing the drag-to-wire gesture. Only
 * renders once the node actually has its one output wired — nothing
 * to point at a side before that. Compass layout matches
 * skin/octagon.ts's anchor convention (0=E,1=SE,2=S,3=SW,4=W,5=NW,
 * 6=N,7=NE) — labels now come straight from `compassLabel` there
 * instead of a locally-duplicated string list.
 *
 * 2026-09-10 ("the ports are named according to compass"): `pick`
 * used to only move the FLOOR-layer anchor — sourcePort was still a
 * decoupled logical number back then, so nothing here needed to touch
 * it. Now that sourcePort just IS the anchor (GraphModel.
 * updateEdgePorts's own doc comment), leaving it unsynced here would
 * have been the exact desync bug this whole feature exists to fix —
 * `graph.updateEdgePorts` is now called in the same click. */
function SingleOutputSidePicker({
  nodeId,
  kind,
  graph,
  floorLayout,
}: {
  nodeId: string;
  kind: NodeDef['kind'];
  graph: GraphModel;
  floorLayout: FloorLayout;
}) {
  const capacity = getPortCapacity(kind);
  const outputEdges = graph.outputEdges(nodeId);
  const [, forceRender] = useState(0);

  if (capacity.maxOutputs !== 1 || outputEdges.length !== 1) return null;
  const edge = outputEdges[0]!;
  const anchors = floorLayout.getEdgeAnchors(edge.id);
  if (!anchors) return null;

  // Grid cell -> anchor index, in visual reading order for a 3x3
  // compass grid, center cell left empty (null).
  const COMPASS_GRID: (number | null)[] = [5, 6, 7, 4, null, 0, 3, 2, 1];

  function pick(anchorIndex: number): void {
    const ok = floorLayout.reassignAnchor(edge!.id, 'source', anchorIndex);
    if (!ok) return;
    graph.updateEdgePorts(edge!.id, { sourcePort: anchorIndex });
    forceRender((n) => n + 1); // FloorLayout mutates directly (§4.6) — nudge this panel to reread it
  }

  return (
    <>
      <div style={sectionTitleStyle}>Output side</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, width: 108, marginBottom: 4 }}>
        {COMPASS_GRID.map((anchorIndex, i) => {
          if (anchorIndex === null) return <div key={`empty-${i}`} />;
          const label = compassLabel(anchorIndex);
          const active = anchorIndex === anchors.sourceAnchor;
          return (
            <button
              key={label}
              type="button"
              onClick={() => pick(anchorIndex)}
              style={{
                padding: '5px 0',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid ' + (active ? theme.accent : theme.borderStrong),
                background: active ? theme.accent : theme.bgPanel2,
                color: active ? theme.text1 : theme.text1,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Docking (design doc §5.6, 2026-09-09 — "attaching the node without
 * needing to add a path in between ... it will act and behave like a
 * single unit"): shown only when this node is one end of a `dock`
 * edge (created by FluxCanvas's drag-to-snap gesture, App.tsx's
 * handleDockNodes). Renders nothing for every ordinary node — the
 * common case — so it's always safe to drop into NodeProperties
 * unconditionally rather than gating it per-kind. Falcon, 2026-09-09
 * ("there will be something in between the node to indicate that
 * they are docked and on the properties panel just toggle detach (if
 * docked) to detach to prevent accidental dragging"): Detach lives
 * here rather than as a drag-apart gesture specifically so it can't
 * happen by accident. "Flip direction" isn't something Falcon asked
 * for directly, but handleDockNodes' own doc comment flags that its
 * source/target default (stationary = source) is a documented guess,
 * not an inferred intent — this is the one-click fix for when it
 * guessed the wrong way (e.g. a Gate docked as a Silo's out-gate when
 * an in-gate was meant), without needing to detach and redo the drag.
 *
 * Direct-mutation-plus-local-useState-mirror, same convention as
 * LockToggle just below — a click here changes graph/floorLayout/
 * skinConfig (the real stores) and bumps a local counter purely to
 * make THIS component re-render afterward (nothing else about
 * NodeProperties depends on React state for a store mutation like
 * this one). */
function DockSection({
  nodeId,
  graph,
  floorLayout,
  skinConfig,
}: {
  nodeId: string;
  graph: GraphModel;
  floorLayout: FloorLayout;
  skinConfig: SkinConfig;
}) {
  const [, forceUpdate] = useState(0);
  // Keyed off `docked`, not `edgeKind === 'dock'` (design doc §5.7) —
  // a Silo↔Sensor dock is `edgeKind: 'signal'` (it's a copper/watch
  // connection, never a real item edge) but is still `docked: true`,
  // so it still gets this section. See types.ts's `docked` doc
  // comment for why the two fields are orthogonal.
  const dockEdge = graph.getAllEdges().find((e) => e.docked && (e.source === nodeId || e.target === nodeId));
  if (!dockEdge) return null;

  const isSource = dockEdge.source === nodeId;
  const partnerId = isSource ? dockEdge.target : dockEdge.source;
  const partnerNode = graph.getNode(partnerId);

  function flipDirection(): void {
    const anchors = floorLayout.getEdgeAnchors(dockEdge!.id);
    if (!anchors) return;
    const oldSourceId = dockEdge!.source;
    const oldTargetId = dockEdge!.target;
    const newSourceNode = graph.getNode(oldTargetId);
    const newTargetNode = graph.getNode(oldSourceId);
    if (!newSourceNode || !newTargetNode) return;

    // Same silent-rejection convention as every other wiring check —
    // excludes the dock edge itself from its own pre-flip counts,
    // since flipping doesn't add a connection, it repurposes this one.
    const sourceCap = getPortCapacity(newSourceNode.kind);
    const targetCap = getPortCapacity(newTargetNode.kind);
    const otherOutputsFromNewSource = graph.outputEdges(oldTargetId).filter((e) => e.id !== dockEdge!.id).length;
    const otherInputsToNewTarget = graph.inputEdges(oldSourceId).filter((e) => e.id !== dockEdge!.id).length;
    if (sourceCap.maxOutputs !== undefined && otherOutputsFromNewSource >= sourceCap.maxOutputs) return;
    if (targetCap.maxInputs !== undefined && otherInputsToNewTarget >= targetCap.maxInputs) return;

    const skin = skinConfig.getEdgeSkin(dockEdge!.id);
    const oldEdgeKind = dockEdge!.edgeKind;
    graph.removeEdge(dockEdge!.id);
    floorLayout.removeEdgeCurve(dockEdge!.id);
    skinConfig.removeEdge(dockEdge!.id);

    const newId = `${dockEdge!.id}-flip-${Date.now()}`;
    // 2026-09-10 ("the ports are named according to compass"): the
    // flipped edge's ports are the same swapped anchors setEdgeCurve
    // re-attaches it at just below, not a hardcoded 0.
    graph.addEdge({
      id: newId,
      source: oldTargetId,
      target: oldSourceId,
      sourcePort: anchors.targetAnchor,
      targetPort: anchors.sourceAnchor,
      flowRate: dockEdge!.flowRate,
      active: dockEdge!.active,
      // Preserve whatever edgeKind this dock actually had (design doc
      // §5.7) — a Silo↔Sensor dock is 'signal', not 'dock' (see
      // types.ts's `docked` doc comment); flipping it must never
      // silently turn a copper/watch connection into a real item edge.
      edgeKind: oldEdgeKind,
      docked: true,
    });
    floorLayout.setEdgeCurve(newId, oldTargetId, oldSourceId, 0, {
      sourceAnchor: anchors.targetAnchor,
      targetAnchor: anchors.sourceAnchor,
    });
    skinConfig.setEdgeSkin(newId, skin);
    forceUpdate((n) => n + 1);
  }

  function detach(): void {
    graph.removeEdge(dockEdge!.id);
    floorLayout.removeEdgeCurve(dockEdge!.id);
    skinConfig.removeEdge(dockEdge!.id);
    forceUpdate((n) => n + 1);
  }

  // A Silo↔Sensor dock isn't item flow at all (design doc §5.7) — say
  // "watching"/"watched by" for that pair instead of the generic
  // "feed"/"from" wording, which reads like a physical item edge.
  const node = graph.getNode(nodeId);
  const isSensorWatchDock = node?.kind === 'sensor' || partnerNode?.kind === 'sensor';
  const relationLabel = isSensorWatchDock
    ? node?.kind === 'sensor'
      ? 'watching'
      : 'watched by'
    : isSource
      ? 'to feed'
      : 'from';

  return (
    <div>
      <div style={sectionTitleStyle}>Dock</div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5, marginBottom: 6 }}>
        Docked {relationLabel} {partnerNode?.kind ?? 'a node'} ({partnerId}) — moves as one unit; drag either one and
        both stay joined.
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={flipDirection} style={smallButtonStyle}>
          Flip direction
        </button>
        <button
          type="button"
          onClick={detach}
          style={{ ...smallButtonStyle, color: theme.danger, borderColor: theme.dangerSoft }}
        >
          Detach
        </button>
      </div>
    </div>
  );
}

function LockToggle({ nodeId, skinConfig }: { nodeId: string; skinConfig: SkinConfig }) {
  const [locked, setLocked] = useState(skinConfig.getNodeLocked(nodeId));
  return (
    <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={locked}
        onChange={(e) => {
          setLocked(e.target.checked);
          skinConfig.setNodeLocked(nodeId, e.target.checked);
        }}
      />
      Locked (drag-to-move disabled)
    </label>
  );
}

/** Shared item-type dropdown (FBP011, 2026-09-05) — used by every
 * field that references an `ItemType` string (source's spawned type,
 * a sorter rule's match type, a mixer recipe/output type), so all
 * three read from the same OBJECTS registry list instead of a
 * free-text field that could silently reference nothing renderable.
 * The current `value` is always included as an option even if it
 * isn't a registered type — a pre-existing save (or the demo graph's
 * 'widget') keeps working and keeps showing its actual value rather
 * than silently jumping to the first option in the list. `allowEmpty`
 * renders a leading blank option (sorter/mixer rows use '' to mean
 * "not yet filled in"). */
function ItemTypeSelect({
  value,
  objectRegistry,
  onChange,
  allowEmpty,
}: {
  value: string;
  objectRegistry: ObjectRegistry;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  const types = objectRegistry.list();
  const valueIsRegistered = value === '' || types.some((t) => t.id === value);
  return (
    <select value={value} style={inputStyle} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— none —</option>}
      {!valueIsRegistered && <option value={value}>{value} (unregistered)</option>}
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/** Shared compass-labeled port dropdown (2026-09-10, Falcon: "the
 * ports are named according to compass like the N,NE,SE,S,SW,W,NW") —
 * used by every field that references a sourcePort/targetPort number
 * (sorter rule/default ports, mixer recipe ports, buffer overflow/
 * output ports), same "read from what's actually there instead of a
 * free-typed number that could reference nothing real" fix
 * ItemTypeSelect above already gives item types. `edges` is whichever
 * real edges are relevant to this port's ROLE — a node's own
 * `outputEdges` (sourcePort) for an output-role port like buffer's
 * main/overflow or sorter's rule targets, its `inputEdges` (targetPort)
 * for an input-role port like a mixer recipe row — and `portOf` picks
 * which field off each. The current `value` is always included even
 * if no matching edge exists yet (a pre-existing save, or a port
 * picked before its wire was drawn), same "don't silently jump to a
 * different option" convention as ItemTypeSelect's unregistered-type
 * case. */
function PortSelect({
  edges,
  portOf,
  value,
  onChange,
}: {
  edges: EdgeDef[];
  portOf: (e: EdgeDef) => number;
  value: number;
  onChange: (port: number) => void;
}) {
  const ports = [...new Set(edges.map(portOf))].sort((a, b) => a - b);
  return (
    <select value={value} style={inputStyle} onChange={(e) => onChange(Number(e.target.value))}>
      {!ports.includes(value) && <option value={value}>{compassLabel(value)} (no wire yet)</option>}
      {ports.map((p) => (
        <option key={p} value={p}>
          {compassLabel(p)}
        </option>
      ))}
    </select>
  );
}

function SourceFields({
  node,
  graph,
  onChange,
  objectRegistry,
}: {
  node: NodeDef;
  graph: GraphModel;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
}) {
  const [cooldown, setCooldown] = useState(typeof node.config.cooldown === 'number' ? node.config.cooldown : 1);
  const [itemType, setItemType] = useState(typeof node.config.itemType === 'string' ? node.config.itemType : 'item');
  // Falcon, 2026-09-09 ("resize or sizing feature on the parameters
  // for the item"): a quick Size field right here rather than making
  // him open Objects registry every time. This intentionally edits
  // the shared ObjectRegistry entry's own `size` (objectRegistry is
  // the single source of truth for it, design doc §4.6) -- not a
  // per-source override -- so it also affects every other source that
  // references the same item type, and stays in sync with what
  // Objects registry itself shows. Local state just mirrors the
  // registry's current value for the input, same "direct mutation +
  // local useState mirror" convention as the Locked checkbox below.
  const [size, setSize] = useState(() => objectRegistry.resolve(itemType).size);

  // Falcon, 2026-09-09 ("off by default ... unless toggled on"), then
  // 2026-09-10 ("it deactivates and activates making it looks
  // blinking ... maybe i need gate node for this"): `active` used to
  // be a two-way flag SimEngine could also flip on its own (an
  // "auto-deactivated" state, resumed automatically once room opened
  // up) -- that self-toggling is exactly what read as blinking, so
  // Falcon's own call was to make it a PURE manual switch instead: the
  // system never writes to it again (see
  // SimEngine.sourceCanSpawnThisTick's doc comment). No room this tick
  // is now handled the same quiet way every other node's backpressure
  // already is -- that tick's spawn just doesn't happen, with no
  // config write and no dimming. A source that wants a real, visible
  // open/closed valve should get one from a Gate + Sensor pair
  // instead (design doc §4.8) -- that's what those nodes are for, not
  // this checkbox. `autoDeactivated` is no longer written or read
  // anywhere; a pre-existing save that happens to carry `true` on it
  // is simply inert now, not something this panel still needs to
  // poll for.
  const [active, setActive] = useState(node.config.active !== false);
  useEffect(() => {
    setActive(node.config.active !== false);
  }, [node]);

  // Spawn limit (2026-09-10 follow-up — Falcon: "i want the source
  // node to have a set or limited spawn feature like a switch like it
  // only outputs a user defined number of spawns or limited unlike the
  // default that is unlimited"): a THIRD, independent gate alongside
  // `active` and the Command signal above (SimEngine.
  // sourceCanSpawnThisTick ANDs all three) — off by default, so a
  // freshly placed or already-saved Source keeps spawning unbounded
  // exactly as before this shipped. `spawnLimit` stays disabled/greyed
  // whenever the switch is off, same "field only matters once its own
  // switch is on" shape the rest of the panel doesn't otherwise use,
  // but felt clearer here than hiding the field outright — it's still
  // right there to pre-fill before switching the limit on.
  const [spawnLimitEnabled, setSpawnLimitEnabled] = useState(node.config.spawnLimitEnabled === true);
  const [spawnLimit, setSpawnLimit] = useState(typeof node.config.spawnLimit === 'number' ? node.config.spawnLimit : 10);

  // Signal-gated spawning (2026-09-10 — Falcon: "i want to add
  // additional feature to source node like it will deactivate by
  // using sensor nodes condition"; revised same session — "sensor node
  // only senses and triggers signal[,] the command node is the one has
  // command on it"): a SECOND, independent gate layered on top of the
  // manual switch above (both must allow spawning — SimEngine's
  // sourceCanSpawnThisTick ANDs them), driven entirely by wiring rather
  // than anything in this panel to edit — same read-only status-line
  // treatment GateFields already uses for its own "is a Sensor actually
  // wired in" check, just reused here with `'command'` since the
  // underlying `hasSignalInput` helper is generic over both the target
  // node id and the required source kind. A Sensor may no longer target
  // a Source directly — only a Command node can, see App.tsx's
  // isSourceSignalTarget.
  //
  // Bumped to verb-aware (2026-09-11 follow-up, alongside the new
  // reset-Command slot below): `hasSignalInput` alone can't tell a
  // gate-purposed Command from a reset-purposed one any more, since a
  // Source can now have TWO incoming Command edges (portCapacity.ts's
  // maxInputs 1 -> 2) — so this reads the actual incoming Command
  // edges directly and splits them by that Command's own `verb`
  // (unset/anything-but-'reset' = gate, 'reset' = the new button's
  // Command-driven twin below).
  const incomingCommandEdges = graph
    .getAllEdges()
    .filter((e) => e.target === node.id && e.active && e.edgeKind === 'signal' && graph.getNode(e.source)?.kind === 'command');
  const signalGated = incomingCommandEdges.some((e) => graph.getNode(e.source)?.config.verb !== 'reset');
  const resetCommandWired = incomingCommandEdges.some((e) => graph.getNode(e.source)?.config.verb === 'reset');
  const resetSeq = typeof node.config.resetSeq === 'number' ? node.config.resetSeq : 0;

  return (
    <>
      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => {
            const v = e.target.checked;
            setActive(v);
            onChange({ active: v });
          }}
        />
        Active (spawning)
      </label>
      <div style={{ fontSize: 10, color: theme.text3, marginTop: -6, marginBottom: signalGated ? 4 : 10 }}>
        {active
          ? "Spawning every cooldown. If there's no room on a given tick, that spawn is just skipped — this switch stays on either way."
          : 'Not spawning. Turn this on to let it produce items.'}
      </div>
      {signalGated && (
        <p style={{ fontSize: 11, color: theme.text2, lineHeight: 1.5, marginTop: 0, marginBottom: 10 }}>
          Also wired to a Command node — this switch AND whatever that Command last relayed both have to allow it for
          spawning to actually happen.
        </p>
      )}
      <div style={rowStyle}>
        <label style={labelStyle}>Spawn cooldown (logic-seconds)</label>
        <input
          type="number"
          min={0}
          step={0.1}
          value={cooldown}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            setCooldown(v);
            onChange({ cooldown: v });
          }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Item type</label>
        <ItemTypeSelect
          value={itemType}
          objectRegistry={objectRegistry}
          onChange={(v) => {
            setItemType(v);
            onChange({ itemType: v });
            setSize(objectRegistry.resolve(v).size);
          }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Item size</label>
        <input
          type="number"
          min={2}
          max={40}
          value={size}
          style={inputStyle}
          title="Resizes the shared item type -- affects every source using it, and matches Objects registry."
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v > 0) {
              setSize(v);
              objectRegistry.update(itemType, { size: v });
            }
          }}
        />
      </div>
      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 6 }}>
        <input
          type="checkbox"
          checked={spawnLimitEnabled}
          onChange={(e) => {
            const v = e.target.checked;
            setSpawnLimitEnabled(v);
            onChange({ spawnLimitEnabled: v, spawnLimit });
          }}
        />
        Limit total spawns
      </label>
      <div style={{ ...rowStyle, opacity: spawnLimitEnabled ? 1 : 0.5 }}>
        <label style={labelStyle}>Spawn limit</label>
        <input
          type="number"
          min={0}
          step={1}
          value={spawnLimit}
          disabled={!spawnLimitEnabled}
          style={inputStyle}
          onChange={(e) => {
            const v = Math.max(0, Math.round(Number(e.target.value)));
            setSpawnLimit(v);
            onChange({ spawnLimit: v });
          }}
        />
      </div>
      <p style={{ fontSize: 10, color: theme.text3, marginTop: -6, marginBottom: 10 }}>
        {spawnLimitEnabled
          ? `Stops spawning once it has produced ${spawnLimit} item${spawnLimit === 1 ? '' : 's'} — the node's badge counts down from ${spawnLimit} to 0 as spawns remain, and dims the same way the switch above does. Use "Reset spawn count" below to start it over.`
          : 'Off — spawns without limit for as long as the switch above stays on.'}
      </p>
      {resetCommandWired && (
        <p style={{ fontSize: 11, color: theme.text2, lineHeight: 1.5, marginTop: 0, marginBottom: 8 }}>
          Also wired to a Command node set to "Reset spawn count" — it resets this tally on its own, independent of
          the button below.
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange({ resetSeq: resetSeq + 1 })}
        style={{ ...smallButtonStyle, width: '100%' }}
        title="Zeroes spawnedCount — resumes spawning immediately if Active and (when a limit is on) back under it."
      >
        Reset spawn count
      </button>
    </>
  );
}

/** Weighted round-robin (2026-09-10 follow-up — Falcon: "its a round
 * robin but set to a certain outflow in a certain way"): a third Mode
 * option alongside the existing two, plus a weight field per output
 * PORT (not per edge — matching how distributor.ts's own
 * `buildWeightedSequence` keys `config.weights`). Ports come from the
 * node's actual output edges (`graph.outputEdges`), deduplicated — a
 * distributor with several wires off the same octagon side shares one
 * weight field for it, same as it already shares one round-robin turn.
 *
 * Same-day follow-up (Falcon: "the ports are named according to
 * compass like the N,NE,SE,S,SW,W,NW"): sourcePort now just IS the
 * physical anchor a wire is drawn from (App.tsx's edge-creation sites)
 * — draw each output from a different octagon side and it gets its
 * own port, hence its own weight field here, with zero manual editing.
 * Sorted ascending (unchanged), which IS clockwise order (0=E round to
 * 7=NE — octagon.ts's own anchor convention), matching "distributor
 * should be clockwise". Labeled with `compassLabel` instead of the
 * raw index for the same reason every other port-based field now is. */
function DistributorFields({
  node,
  onChange,
  graph,
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  graph: GraphModel;
}) {
  const [mode, setMode] = useState(
    node.config.mode === 'broadcast' ? 'broadcast' : node.config.mode === 'weighted' ? 'weighted' : 'roundRobin',
  );
  const [weights, setWeights] = useState<Record<string, number>>(
    (node.config.weights as Record<string, number> | undefined) ?? {},
  );
  const outputPorts = [...new Set(graph.outputEdges(node.id).map((e) => e.sourcePort))].sort((a, b) => a - b);

  function setWeight(port: number, value: number): void {
    const next = { ...weights, [String(port)]: value };
    setWeights(next);
    onChange({ weights: next });
  }

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Mode</label>
        <select
          value={mode}
          style={inputStyle}
          onChange={(e) => {
            const v = e.target.value;
            setMode(v);
            onChange({ mode: v });
          }}
        >
          <option value="roundRobin">Round-robin</option>
          <option value="broadcast">Broadcast</option>
          <option value="weighted">Weighted round-robin</option>
        </select>
      </div>
      {mode === 'weighted' && (
        <>
          <p style={{ fontSize: 10, color: theme.text3, marginTop: -6, marginBottom: 8 }}>
            Each port gets its own number of turns per cycle — e.g. weights 1 / 3 / 5 send 5x more down the third port
            than the first. Blank/unset defaults to 1; 0 skips that port entirely.
          </p>
          {outputPorts.length === 0 && (
            <p style={{ fontSize: 11, color: theme.text3 }}>No output wires yet — wire this up first.</p>
          )}
          {outputPorts.map((port) => (
            <div key={port} style={rowStyle}>
              <label style={labelStyle}>{compassLabel(port)} weight</label>
              <input
                type="number"
                min={0}
                step={1}
                value={weights[String(port)] ?? 1}
                style={inputStyle}
                onChange={(e) => setWeight(port, Math.max(0, Math.round(Number(e.target.value))))}
              />
            </div>
          ))}
        </>
      )}
    </>
  );
}

/** Transform (2026-09-10, "now i want to introduce the transform
 * node"): one fixed A -> B rule, both picked from the same registered-
 * item-type dropdown SourceFields' own Item type field already uses --
 * `inputType` is a label only (shown here so the node reads clearly as
 * "A -> B"), never a filter transform.ts itself enforces; every
 * arriving item is relabeled to `outputType` regardless of what it
 * arrived as. */
function TransformFields({
  node,
  onChange,
  objectRegistry,
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
}) {
  const [inputType, setInputType] = useState(
    typeof node.config.inputType === 'string' ? node.config.inputType : 'widget',
  );
  const [outputType, setOutputType] = useState(
    typeof node.config.outputType === 'string' ? node.config.outputType : 'widget',
  );
  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Converts from</label>
        <ItemTypeSelect
          value={inputType}
          objectRegistry={objectRegistry}
          onChange={(v) => {
            setInputType(v);
            onChange({ inputType: v });
          }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Converts to</label>
        <ItemTypeSelect
          value={outputType}
          objectRegistry={objectRegistry}
          onChange={(v) => {
            setOutputType(v);
            onChange({ outputType: v });
          }}
        />
      </div>
      <p style={{ fontSize: 10, color: theme.text3, marginTop: -6, marginBottom: 10 }}>
        Every item arriving as "{inputType}" (or any other type) leaves this node relabeled "{outputType}" —
        instantly, no delay. "Converts from" is just this node's own label, not a filter.
      </p>
    </>
  );
}

interface SorterRuleRow {
  itemType: string;
  outputPort: number;
}

function SorterFields({
  node,
  onChange,
  objectRegistry,
  graph,
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
  graph: GraphModel;
}) {
  const initialRules = Array.isArray(node.config.rules) ? (node.config.rules as SorterRuleRow[]) : [];
  const [rules, setRules] = useState<SorterRuleRow[]>(initialRules.map((r) => ({ ...r })));
  const [defaultPort, setDefaultPort] = useState(
    typeof node.config.defaultPort === 'number' ? String(node.config.defaultPort) : '',
  );
  const [unmatchedPolicy, setUnmatchedPolicy] = useState(node.config.unmatchedPolicy === 'drop' ? 'drop' : 'hold');
  // 2026-09-10 ("the ports are named according to compass"): a
  // sorter's rule/default ports are all output-role (they pick which
  // OUTGOING wire an item leaves on), so both pull from the same set
  // of this node's actual outputEdges, compass-labeled by PortSelect.
  const outputEdges = graph.outputEdges(node.id);

  function commitRules(next: SorterRuleRow[]): void {
    setRules(next);
    onChange({ rules: next });
  }

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Rules (first match wins)</label>
        {outputEdges.length === 0 && (
          <p style={{ fontSize: 11, color: theme.text3, marginBottom: 4 }}>No output wires yet — wire this up first.</p>
        )}
        {rules.map((rule, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <div style={{ flex: 2 }}>
              <ItemTypeSelect
                value={rule.itemType}
                objectRegistry={objectRegistry}
                allowEmpty
                onChange={(v) => {
                  const next = rules.map((r, idx) => (idx === i ? { ...r, itemType: v } : r));
                  commitRules(next);
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <PortSelect
                edges={outputEdges}
                portOf={(e) => e.sourcePort}
                value={rule.outputPort}
                onChange={(v) => {
                  const next = rules.map((r, idx) => (idx === i ? { ...r, outputPort: v } : r));
                  commitRules(next);
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => commitRules(rules.filter((_, idx) => idx !== i))}
              style={{ ...smallButtonStyle, flex: '0 0 auto', padding: '5px 8px' }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => commitRules([...rules, { itemType: '', outputPort: outputEdges[0]?.sourcePort ?? 0 }])}
          style={smallButtonStyle}
        >
          + Add rule
        </button>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Default port (blank = none)</label>
        {defaultPort === '' ? (
          <button
            type="button"
            onClick={() => {
              const v = outputEdges[0]?.sourcePort ?? 0;
              setDefaultPort(String(v));
              onChange({ defaultPort: v });
            }}
            style={smallButtonStyle}
          >
            Set a default port
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ flex: 1 }}>
              <PortSelect
                edges={outputEdges}
                portOf={(e) => e.sourcePort}
                value={Number(defaultPort)}
                onChange={(v) => {
                  setDefaultPort(String(v));
                  onChange({ defaultPort: v });
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setDefaultPort('');
                onChange({ defaultPort: undefined });
              }}
              style={{ ...smallButtonStyle, flex: '0 0 auto', padding: '5px 8px' }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Unmatched policy</label>
        <select
          value={unmatchedPolicy}
          style={inputStyle}
          onChange={(e) => {
            setUnmatchedPolicy(e.target.value);
            onChange({ unmatchedPolicy: e.target.value });
          }}
        >
          <option value="hold">Hold (retry next tick)</option>
          <option value="drop">Drop</option>
        </select>
      </div>
    </>
  );
}

interface RecipeRow {
  port: number;
  itemType: string;
}

function MixerFields({
  node,
  onChange,
  objectRegistry,
  graph,
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
  graph: GraphModel;
}) {
  const recipeObj = (node.config.recipe ?? {}) as Record<number, string>;
  const [rows, setRows] = useState<RecipeRow[]>(
    Object.entries(recipeObj).map(([port, itemType]) => ({ port: Number(port), itemType: String(itemType) })),
  );
  const [outputType, setOutputType] = useState(
    typeof node.config.outputType === 'string' ? node.config.outputType : 'item',
  );
  const [bufferCapacity, setBufferCapacity] = useState(
    typeof node.config.bufferCapacity === 'number' ? String(node.config.bufferCapacity) : '',
  );
  // 2026-09-10 ("the ports are named according to compass"): a recipe
  // row's port is input-role (which INCOMING wire has to deliver a
  // matching item before the recipe can fire) — pulls from the
  // mixer's actual inputEdges, keyed by targetPort. Mixer's own single
  // output no longer has a separate "Output port" field here at all —
  // it's capped to exactly one real output edge (portCapacity.ts),
  // moved with the compass grid in NodeProperties' own "Output side"
  // section (SingleOutputSidePicker) instead of a second, easy-to-
  // desync config number pointed at the same thing (mixer.ts just
  // takes "the" active output edge directly now).
  const inputEdges = graph.inputEdges(node.id);

  function commitRows(next: RecipeRow[]): void {
    setRows(next);
    const recipe: Record<number, string> = {};
    for (const row of next) recipe[row.port] = row.itemType;
    onChange({ recipe });
  }

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Recipe (input port → item type)</label>
        {inputEdges.length === 0 && (
          <p style={{ fontSize: 11, color: theme.text3, marginBottom: 4 }}>No input wires yet — wire this up first.</p>
        )}
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <div style={{ flex: 1 }}>
              <PortSelect
                edges={inputEdges}
                portOf={(e) => e.targetPort}
                value={row.port}
                onChange={(v) => {
                  const next = rows.map((r, idx) => (idx === i ? { ...r, port: v } : r));
                  commitRows(next);
                }}
              />
            </div>
            <div style={{ flex: 2 }}>
              <ItemTypeSelect
                value={row.itemType}
                objectRegistry={objectRegistry}
                allowEmpty
                onChange={(v) => {
                  const next = rows.map((r, idx) => (idx === i ? { ...r, itemType: v } : r));
                  commitRows(next);
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => commitRows(rows.filter((_, idx) => idx !== i))}
              style={{ ...smallButtonStyle, flex: '0 0 auto', padding: '5px 8px' }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => commitRows([...rows, { port: inputEdges[0]?.targetPort ?? 0, itemType: '' }])}
          style={smallButtonStyle}
        >
          + Add input
        </button>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Output item type</label>
        <ItemTypeSelect
          value={outputType}
          objectRegistry={objectRegistry}
          onChange={(v) => {
            setOutputType(v);
            onChange({ outputType: v });
          }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Input buffer capacity (blank = unlimited)</label>
        <input
          type="number"
          value={bufferCapacity}
          style={inputStyle}
          onChange={(e) => {
            setBufferCapacity(e.target.value);
            onChange({ bufferCapacity: e.target.value === '' ? undefined : Number(e.target.value) });
          }}
        />
      </div>
    </>
  );
}

function BufferFields({ node, onChange, graph }: { node: NodeDef; onChange: (fields: Record<string, unknown>) => void; graph: GraphModel }) {
  const [capacity, setCapacity] = useState(
    typeof node.config.capacity === 'number' ? String(node.config.capacity) : '',
  );
  const [overflowPolicy, setOverflowPolicy] = useState(node.config.overflowPolicy === 'divert' ? 'divert' : 'block');
  const [overflowPort, setOverflowPort] = useState(
    typeof node.config.overflowPort === 'number' ? node.config.overflowPort : 1,
  );
  const [outputPort, setOutputPort] = useState(typeof node.config.outputPort === 'number' ? node.config.outputPort : 0);
  // 2026-09-10 ("the ports are named according to compass"): both of
  // Silo's two real output roles (main drain + optional overflow) are
  // output-role, so both pull from the same actual outputEdges set,
  // excluding a copper "watch" edge to a Sensor (design doc §5.7) —
  // that one's never a candidate for either role, same edgeKind !==
  // 'signal' exclusion buffer.ts's own onItemArrival already applies.
  const outputEdges = graph.outputEdges(node.id).filter((e) => e.edgeKind !== 'signal');

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Capacity (blank = unlimited)</label>
        <input
          type="number"
          value={capacity}
          style={inputStyle}
          onChange={(e) => {
            setCapacity(e.target.value);
            onChange({ capacity: e.target.value === '' ? undefined : Number(e.target.value) });
          }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Overflow policy</label>
        <select
          value={overflowPolicy}
          style={inputStyle}
          onChange={(e) => {
            setOverflowPolicy(e.target.value);
            onChange({ overflowPolicy: e.target.value });
          }}
        >
          <option value="block">Block (backpressure)</option>
          <option value="divert">Divert to overflow port</option>
        </select>
      </div>
      {overflowPolicy === 'divert' && (
        <div style={rowStyle}>
          <label style={labelStyle}>Overflow port</label>
          {outputEdges.length === 0 ? (
            <p style={{ fontSize: 11, color: theme.text3 }}>No output wires yet — wire this up first.</p>
          ) : (
            <PortSelect
              edges={outputEdges}
              portOf={(e) => e.sourcePort}
              value={overflowPort}
              onChange={(v) => {
                setOverflowPort(v);
                onChange({ overflowPort: v });
              }}
            />
          )}
        </div>
      )}
      <div style={rowStyle}>
        <label style={labelStyle}>Output port</label>
        {outputEdges.length === 0 ? (
          <p style={{ fontSize: 11, color: theme.text3 }}>No output wires yet — wire this up first.</p>
        ) : (
          <PortSelect
            edges={outputEdges}
            portOf={(e) => e.sourcePort}
            value={outputPort}
            onChange={(v) => {
              setOutputPort(v);
              onChange({ outputPort: v });
            }}
          />
        )}
      </div>
    </>
  );
}

/** Gate (design doc §4.8, 2026-09-09) — nothing in its OWN config to
 * edit; its in/out role comes from wiring, and whether it opens comes
 * entirely from a connected Sensor's signal. The one thing worth
 * surfacing here is the "mandatory Sensor connection" rule itself
 * (design doc §4.6's silent-rejection convention, applied to a read
 * rather than a write) -- `hasSignalInput` is the exact same pure
 * check the Logic layer itself relies on for correctness (gate.ts),
 * just re-used here to warn a person building the graph rather than
 * to change behavior. */
function GateFields({ nodeId, graph }: { nodeId: string; graph: GraphModel }) {
  // Explicit 'command' (2026-09-11, Command role-split finalization):
  // matches hasSignalInput's own default now, but named explicitly
  // here so this call reads correctly on its own regardless of what
  // that default happens to be — a Gate only ever listens to a
  // Command node now, never a Sensor directly (see gate.ts's own doc
  // comment and command.ts's evaluateSignals).
  const connected = hasSignalInput(nodeId, graph.getAllEdges(), graph.getAllNodes(), 'command');
  return (
    <div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
        Gate has nothing of its own to configure. It forwards an arriving item immediately while open, and refuses
        it while closed — only a Command wired to this Gate with an "Edge kind: Signal" connection can open it (see
        that edge's own Logic section, and that Command node's own properties for its Verb/Duration).
      </p>
      {connected ? (
        <p style={{ fontSize: 11, color: theme.success }}>✓ A Command is wired in — this Gate can open.</p>
      ) : (
        <p style={{ fontSize: 11, color: theme.danger }}>
          ⚠ No active Command connected via a Signal edge — this Gate can never open.
        </p>
      )}
    </div>
  );
}

/** Verb choices per attachable target kind (2026-09-11, Command
 * role-split finalization) — only Gate and Source have a real
 * open/close-shaped action with two directions; Counter and Time
 * always just reset on the rising edge, nothing to pick. Source's
 * third option, "Reset spawn count" (2026-09-11 same-session
 * follow-up — Falcon, after finding a spawn-limited Source could
 * never be reused: "why does the source can never get reused ... even
 * i tried to activate it back manually"), is its own separate
 * momentary action, not a third polarity of activate/deactivate — see
 * command.ts's own doc comment for why it needs a dedicated Command
 * (a second one, on Source's now-2-slot input) rather than sharing the
 * activate/deactivate one. */
const COMMAND_VERB_OPTIONS: Partial<Record<NodeDef['kind'], { value: string; label: string }[]>> = {
  gate: [
    { value: 'open', label: 'Open' },
    { value: 'close', label: 'Close' },
  ],
  source: [
    { value: 'activate', label: 'Activate' },
    { value: 'deactivate', label: 'Deactivate' },
    { value: 'reset', label: 'Reset spawn count' },
  ],
};

/** Command (2026-09-10 follow-up — Falcon: "sensor node only senses
 * and triggers signal[,] the command node is the one has command on
 * it ... it is compatible only with wire and dockable to source node
 * and sensor node"; extended the same day to a 3rd target — "i want
 * [the Counter] to count only role and can manually be resetable or
 * by a command when docked with command"; upgraded 2026-09-11 from a
 * dumb always-mirror-Sensor relay to a real actuator with its own
 * VERB + DURATION config — design doc trigger-system finalization,
 * Falcon: "toggle latch/pulse mode"):
 *
 *  - VERB: which direction the Sensor's condition maps to. Only shown
 *    for a Gate or Source target — Counter/Time have no verb, they
 *    always just reset (command.ts's evaluateSignals routes those two
 *    kinds straight through to the old signal-based reset regardless
 *    of this node's own config, same as before this upgrade).
 *    Defaults to `defaultVerbForTargetKind(targetKind)` the moment a
 *    target is first attached (open for Gate, activate for Source) —
 *    same "sensible default the instant it can be inferred" pattern
 *    SensorFields' watch-node picker already uses for its Metric
 *    field.
 *  - DURATION: Latch (hold until the Sensor's condition reverses —
 *    the exact old always-mirror behavior, just now named and
 *    reversible via verb) or Pulse (fire once on every rising edge,
 *    then auto-revert — "let exactly one item through" for a Gate,
 *    "force one spawn + reset cooldown" for a Source).
 *
 * A pre-existing Command node from before this upgrade has no
 * `verb`/`duration` in its config at all — command.ts's own defaults
 * (defaultVerbForTargetKind + 'latch') reproduce its old always-mirror
 * behavior exactly, so nothing changes for it until Falcon actually
 * opens this panel and picks something different. */
function CommandFields({
  node,
  graph,
  onChange,
}: {
  node: NodeDef;
  graph: GraphModel;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const sensorConnected = hasSignalInput(node.id, graph.getAllEdges(), graph.getAllNodes(), 'sensor');
  const attachedEdge = graph.outputEdges(node.id).find((e) => e.active && e.edgeKind === 'signal');
  const targetNode = attachedEdge ? graph.getNode(attachedEdge.target) : undefined;
  const targetKind = targetNode?.kind;

  const verb = typeof node.config.verb === 'string' ? node.config.verb : defaultVerbForTargetKind(targetKind);
  const duration = node.config.duration === 'pulse' ? 'pulse' : 'latch';
  const inverted = verb === 'close' || verb === 'deactivate';
  const verbOptions = targetKind ? COMMAND_VERB_OPTIONS[targetKind] : undefined;
  // Source's "Reset spawn count" verb (2026-09-11 follow-up): a
  // separate momentary action, same "duration doesn't apply" shape as
  // Counter/Time below — no Duration dropdown to show for it.
  const isSourceReset = targetKind === 'source' && verb === 'reset';

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
        Command relays whatever its Sensor last told it, every tick, onto whatever it's attached to. A Gate or
        Source target gets a configurable Verb + Duration below; a Counter or Time target always just resets on the
        signal's rising edge — nothing to configure for those two.
      </p>
      {sensorConnected ? (
        <p style={{ fontSize: 11, color: theme.success, marginBottom: 2 }}>
          ✓ A Sensor is wired in — this Command has something to relay.
        </p>
      ) : (
        <p style={{ fontSize: 11, color: theme.danger, marginBottom: 2 }}>
          ⚠ No active Sensor connected via a Signal edge — this Command has nothing to relay yet.
        </p>
      )}
      {targetNode ? (
        <p style={{ fontSize: 11, color: theme.success, marginBottom: 8 }}>
          ✓ Attached to {targetNode.id} ({targetKind}).
        </p>
      ) : (
        <p style={{ fontSize: 11, color: theme.danger, marginBottom: 8 }}>
          ⚠ Not attached to a Gate, Source, Counter, or Time node — this Command has nothing to act on.
        </p>
      )}
      {verbOptions ? (
        <>
          <div style={rowStyle}>
            <label style={labelStyle}>Verb</label>
            <select value={verb} style={inputStyle} onChange={(e) => onChange({ verb: e.target.value })}>
              {verbOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {isSourceReset ? (
            <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: -4 }}>
              Resets this Source's spawn count to 0 on every rising edge of the Sensor's condition — a separate,
              momentary action, same as Counter/Time's reset. No Duration to configure. Wire this Command to its own
              input slot, independent of any OTHER Command already wired for Activate/Deactivate on this same
              Source.
            </p>
          ) : (
            <>
              <div style={rowStyle}>
                <label style={labelStyle}>Duration</label>
                <select value={duration} style={inputStyle} onChange={(e) => onChange({ duration: e.target.value })}>
                  <option value="latch">Latch (hold until reversed)</option>
                  <option value="pulse">Pulse (apply once, then auto-revert)</option>
                </select>
              </div>
              <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: -4 }}>
                {duration === 'latch'
                  ? `Mirrors the Sensor's condition level: ${verb} while true, ${inverted ? 'the opposite' : 'reversed'} while false.`
                  : targetKind === 'gate'
                    ? 'Fires once on every rising edge of the Sensor’s condition — lets exactly one item through, then closes again.'
                    : 'Fires once on every rising edge of the Sensor’s condition — forces one spawn, resetting the cooldown from that point.'}
              </p>
            </>
          )}
        </>
      ) : (
        (targetKind === 'counter' || targetKind === 'time') && (
          <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5 }}>
            Resets on every rising edge of the Sensor's condition — no Verb or Duration to configure.
          </p>
        )
      )}
    </div>
  );
}

const SENSOR_COMPARATOR_LABEL: Record<string, string> = {
  gte: '≥ (at least)',
  lte: '≤ (at most)',
  gt: '> (more than)',
  lt: '< (less than)',
  eq: '= (exactly)',
};

/** Metric options (2026-09-10 follow-up — 'count' added alongside the
 * Counter node; see sensor.ts's readMetric). One shared metric for
 * every node this Sensor watches, same "one comparator+threshold for
 * all of them" simplification the design doc already committed to. */
const SENSOR_METRIC_LABEL: Record<string, string> = {
  queueLength: 'Queue length',
  count: 'Count (items passed)',
  timeValue: 'Time value (clock reading)',
  spawnedCount: 'Spawned count (Source)',
};

/** Sensor (design doc §4.8; auto-watch extended §5.7, 2026-09-09
 * follow-up — "the sensor nodes should auto-watch the node it is
 * connected to or docked to") — v1 condition config: which node(s) to
 * watch, and the shared comparator/threshold applied to each one's
 * queue length (the only metric implemented so far — see sensor.ts's
 * own doc comment).
 *
 * Fully automatic while connected (Falcon's own pick over "auto-filled
 * but overridable"): the moment this Sensor has at least one active
 * incoming copper/signal edge (hand-drawn OR docked — sensor.ts's
 * watchedNodeIds doesn't distinguish), that wiring is the ONLY thing
 * that decides what's watched — the manual dropdown is replaced with a
 * plain read-out of the live-wired node(s), and stays that way until
 * every such edge is gone. The dropdown reappears, unchanged from
 * before, the moment this Sensor has none — so an older graph built
 * before this existed keeps behaving exactly as it always did. */
function SensorFields({
  node,
  graph,
  onChange,
}: {
  node: NodeDef;
  graph: GraphModel;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const [watchNodeId, setWatchNodeId] = useState(
    typeof node.config.watchNodeId === 'string' ? node.config.watchNodeId : '',
  );
  const [comparator, setComparator] = useState(
    typeof node.config.comparator === 'string' ? node.config.comparator : 'gte',
  );
  const [threshold, setThreshold] = useState(typeof node.config.threshold === 'number' ? node.config.threshold : 0);
  const [metric, setMetric] = useState(typeof node.config.metric === 'string' ? node.config.metric : 'queueLength');
  // Test pulse (2026-09-10 follow-up — Falcon: "i want sensor node
  // with a temporary activate button for temporary and testing
  // purposes[,] this transmit power temporarily"): same "config bump,
  // a per-tick hook notices it" channel Counter's Reset button already
  // uses — see sensor.ts's evaluateSignals for the countdown itself.
  const [testPulseSeq, setTestPulseSeq] = useState(
    typeof node.config.testPulseSeq === 'number' ? node.config.testPulseSeq : 0,
  );
  const [testPulseDuration, setTestPulseDuration] = useState(
    typeof node.config.testPulseDuration === 'number' ? node.config.testPulseDuration : 2,
  );

  const candidates = graph.getAllNodes().filter((n) => n.id !== node.id);
  const liveWatched = watchedNodeIds(graph.inputEdges(node.id));

  return (
    <>
      {liveWatched.length > 0 ? (
        <div style={rowStyle}>
          <label style={labelStyle}>Watch node</label>
          <p style={{ fontSize: 12, color: theme.text2, lineHeight: 1.5, margin: 0 }}>
            {liveWatched
              .map((id) => {
                const n = graph.getNode(id);
                return `${id}${n ? ` (${n.kind})` : ''}`;
              })
              .join(', ')}
          </p>
          <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: 2 }}>
            Auto-watching whatever this Sensor is wired or docked to — a copper wire's direction decides this
            (ingoing = watched). Detach or delete that connection to pick a node manually again.
          </p>
        </div>
      ) : (
        <div style={rowStyle}>
          <label style={labelStyle}>Watch node</label>
          <select
            value={watchNodeId}
            style={inputStyle}
            onChange={(e) => {
              const id = e.target.value;
              setWatchNodeId(id);
              // Falcon, 2026-09-10 (Counter follow-up): a manually-
              // picked Counter defaults the metric to 'count' rather
              // than the old blanket 'queueLength' -- still just a
              // convenience default, the dropdown below can always
              // override it either way. Extended 2026-09-11 for Time
              // ('timeValue') and, same-session follow-up, Source
              // ('spawnedCount' -- Sensor watching a Source directly,
              // the "2nd wire port" addition), same reasoning both times.
              const picked = candidates.find((n) => n.id === id);
              const nextMetric =
                picked?.kind === 'counter'
                  ? 'count'
                  : picked?.kind === 'time'
                    ? 'timeValue'
                    : picked?.kind === 'source'
                      ? 'spawnedCount'
                      : 'queueLength';
              setMetric(nextMetric);
              onChange({ watchNodeId: id || undefined, metric: nextMetric });
            }}
          >
            <option value="">— none selected —</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} ({n.kind})
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={rowStyle}>
        <label style={labelStyle}>Metric</label>
        <select
          value={metric}
          style={inputStyle}
          onChange={(e) => {
            setMetric(e.target.value);
            onChange({ metric: e.target.value });
          }}
        >
          {Object.entries(SENSOR_METRIC_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Condition</label>
        <select
          value={comparator}
          style={inputStyle}
          onChange={(e) => {
            setComparator(e.target.value);
            onChange({ comparator: e.target.value });
          }}
        >
          {Object.entries(SENSOR_COMPARATOR_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Threshold</label>
        <input
          type="number"
          value={threshold}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            setThreshold(v);
            onChange({ threshold: v });
          }}
        />
      </div>
      <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: -4 }}>
        Fires a signal every tick, re-evaluated live: {liveWatched.length > 1 ? 'ANY watched node\'s' : 'watched'}{' '}
        {(SENSOR_METRIC_LABEL[metric] ?? metric).toLowerCase()} {SENSOR_COMPARATOR_LABEL[comparator]} {threshold}.
        Wire this Sensor to a Gate — or, as of 2026-09-10, a Source — with an "Edge kind: Signal" edge (see that
        edge's Logic section); it stays open/spawning for as long as this condition holds.
      </p>
      <div style={sectionTitleStyle}>Test / Debug</div>
      <div style={rowStyle}>
        <label style={labelStyle}>Pulse duration (seconds)</label>
        <input
          type="number"
          min={0.1}
          step={0.5}
          value={testPulseDuration}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTestPulseDuration(v);
            onChange({ testPulseDuration: v });
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          const next = testPulseSeq + 1;
          setTestPulseSeq(next);
          onChange({ testPulseSeq: next });
        }}
        style={{ ...smallButtonStyle, width: '100%' }}
      >
        Force ON ({testPulseDuration}s)
      </button>
      <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: 4 }}>
        Temporarily broadcasts a "true" signal for {testPulseDuration}s, regardless of the actual condition above —
        for testing a downstream Gate/Command/Counter without needing the real condition to trip. Pressing again
        while it's still counting down restarts the timer instead of stacking. Purely a debug aid; the real
        condition resumes on its own once the pulse ends.
      </p>
    </>
  );
}

/** Counter (2026-09-10 — Falcon: "a new counter node this node only
 * acts as a counter ... it only counts what pass to it") — nothing to
 * configure about HOW it counts: every arrival always counts, same "no
 * per-port routing" simplicity Gate's single real output already has,
 * and — confirmed again the same day, after Falcon asked why a
 * Sensor+Command pair stopped a Source — a Counter is never itself
 * gated or paused by anything; that was always the SOURCE stopping,
 * never this node refusing on its own account. The live count itself
 * isn't shown here — it's already the canvas badge (nodeSkin.ts's
 * getBadgeCount), the same live-runtime-state badge Buffer's queue
 * length already uses, so there's no separate read-out to duplicate.
 *
 * Reset, two independent ways (Falcon confirmed "resettable" via
 * AskUserQuestion, then the same day: "can manually be resetable or by
 * a command when docked with command"):
 *  - Manual (the button below): PropertiesPanel has no direct line to
 *    NodeRuntimeStateStore — config is the only thing any Fields
 *    component here ever mutates — so rather than open a new
 *    UI->runtime channel just for one button, this rides the existing
 *    config channel instead: bumping `resetSeq` is an ordinary config
 *    write, and counter.ts's own per-tick hook (onTick) notices the
 *    bump and zeroes `state.count` the very next tick — checked every
 *    tick, not just on the node's next arrival, so it applies even
 *    while nothing is currently flowing through it.
 *  - Command-driven (new, no UI control here — it's wiring, not a
 *    config field): dock or wire a Command node onto this Counter's
 *    new signal-only input slot and it fires the exact same reset,
 *    triggered by its Sensor's condition instead of a click — see
 *    counter.ts's own onTick doc comment for the full rising-edge
 *    mechanism and its `true`-fires-reset polarity. The status line
 *    below just reports whether one is actually wired in, same
 *    read-only treatment GateFields/CommandFields already use for
 *    their own "is X actually connected" checks. */
function CounterFields({
  node,
  graph,
  onChange,
}: {
  node: NodeDef;
  graph: GraphModel;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const resetSeq = typeof node.config.resetSeq === 'number' ? node.config.resetSeq : 0;
  const commandWired = hasSignalInput(node.id, graph.getAllEdges(), graph.getAllNodes(), 'command');
  return (
    <div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
        Counts every item that passes through — nothing else to configure. The running total shows as the badge on
        the node itself. Dock or wire a Sensor to it to read that count elsewhere ("Metric: Count").
      </p>
      {commandWired && (
        <p style={{ fontSize: 11, color: theme.text2, lineHeight: 1.5, marginTop: 0, marginBottom: 8 }}>
          Also wired to a Command node — it resets this count on its own, independent of the button below.
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange({ resetSeq: resetSeq + 1 })}
        style={{ ...smallButtonStyle, width: '100%' }}
      >
        Reset count
      </button>
    </div>
  );
}

/** Time (design doc trigger-system finalization, 2026-09-11) — a
 * clock/timer node: counts down from `duration` seconds to zero, or
 * up from zero indefinitely, purely for something else to watch
 * (time.ts's onTick has no evaluateSignals at all — see NodeKind's
 * own doc comment in types.ts). Reset is Command-only, same
 * "no UI control here, it's wiring" treatment CounterFields already
 * gives its Command-driven reset — the status line just reports
 * whether one is actually wired in. */
function TimeFields({
  node,
  graph,
  onChange,
}: {
  node: NodeDef;
  graph: GraphModel;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const mode = node.config.mode === 'countup' ? 'countup' : 'countdown';
  const duration = typeof node.config.duration === 'number' && node.config.duration > 0 ? node.config.duration : 10;
  const commandWired = hasSignalInput(node.id, graph.getAllEdges(), graph.getAllNodes(), 'command');

  return (
    <div>
      <div style={rowStyle}>
        <label style={labelStyle}>Mode</label>
        <select value={mode} style={inputStyle} onChange={(e) => onChange({ mode: e.target.value })}>
          <option value="countdown">Countdown (to zero)</option>
          <option value="countup">Count up (from zero)</option>
        </select>
      </div>
      {mode === 'countdown' && (
        <div style={rowStyle}>
          <label style={labelStyle}>Duration (seconds)</label>
          <input
            type="number"
            min={0.1}
            step={1}
            value={duration}
            style={inputStyle}
            onChange={(e) => onChange({ duration: Number(e.target.value) })}
          />
        </div>
      )}
      <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: -4 }}>
        {mode === 'countdown'
          ? `Starts at ${duration}s and ticks down to 0, then holds.`
          : 'Starts at 0 and ticks up indefinitely.'}{' '}
        Watched, not emitting — wire a Sensor to it ("Metric: Time value") to act on its reading elsewhere.
      </p>
      {commandWired ? (
        <p style={{ fontSize: 11, color: theme.success }}>✓ A Command is wired in — it can reset this clock.</p>
      ) : (
        <p style={{ fontSize: 11, color: theme.danger }}>
          ⚠ No active Command connected via a Signal edge — this clock can only be reset by wiring one in.
        </p>
      )}
    </div>
  );
}

/** Sketches are pure planning scratch, not GraphModel data (see
 * sketchLayer.ts) — no simulation meaning of their own. Falcon,
 * 2026-09-05: either end can now be pinned to a real node's port
 * (drawn as a filled dot on the canvas, vs. a hollow ring for a
 * floating end) — once BOTH ends are pinned, this panel offers
 * "Convert to path" to turn the sketch into a real GraphModel edge. */
function SketchProperties({
  sketchId,
  segmentIndex,
  sketchLayer,
  graph,
  onDelete,
  onConvertSketch,
  onPinSketchEnd,
}: {
  sketchId: string;
  /** Falcon, 2026-09-05 ("click directly on that segment"): set only
   * when a specific leg of a multi-segment sketch is drilled into
   * (FluxCanvas's sketch-down click handling) -- undefined shows the
   * whole-sketch view below, same as every sketch had before
   * multi-segment existed. */
  segmentIndex?: number;
  sketchLayer: SketchLayer;
  graph: GraphModel;
  onDelete: () => void;
  onConvertSketch: (sketchId: string, style: EdgeStyle) => void;
  onPinSketchEnd: (sketchId: string, end: 'from' | 'to') => void;
}) {
  const [style, setStyle] = useState<EdgeStyle>('trace');
  const sketch = sketchLayer.get(sketchId);
  if (!sketch) return <p style={{ fontSize: 12, color: theme.danger }}>Sketch no longer exists.</p>;

  if (segmentIndex !== undefined && sketch.segments[segmentIndex]) {
    return (
      <SketchSegmentProperties
        sketchId={sketchId}
        segmentIndex={segmentIndex}
        sketch={sketch}
        sketchLayer={sketchLayer}
        onDelete={onDelete}
      />
    );
  }

  const bothAttached = Boolean(sketch.fromAttachment && sketch.toAttachment);
  const isMultiSegment = sketch.segments.length > 1;

  function describeEnd(attachment: { nodeId: string; anchorIndex: number } | null | undefined): string {
    if (!attachment) return 'not attached — a floating planning point';
    const node = graph.getNode(attachment.nodeId);
    return `attached to ${node ? `${node.kind} (${attachment.nodeId})` : attachment.nodeId}, port ${attachment.anchorIndex}`;
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
        Sketch{isMultiSegment ? ` — ${sketch.segments.length} segments` : ''}
      </div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
        A planning guide — no simulation meaning until converted. Start or end a sketch drag right on a node's port
        dot to pin that end to it.
      </p>
      {isMultiSegment && (
        <p style={{ fontSize: 11, color: theme.text2, lineHeight: 1.5, marginTop: 6 }}>
          Click a segment on the canvas to edit its own curve (or convert it to an arc).
        </p>
      )}

      <div style={sectionTitleStyle}>Attachments</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <p style={{ fontSize: 11, color: theme.text2, lineHeight: 1.5, flex: 1, margin: 0 }}>
          Start: {describeEnd(sketch.fromAttachment)}
        </p>
        {!sketch.fromAttachment && (
          <button
            type="button"
            onClick={() => onPinSketchEnd(sketchId, 'from')}
            style={{ ...smallButtonStyle, flexShrink: 0 }}
          >
            Pin
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <p style={{ fontSize: 11, color: theme.text2, lineHeight: 1.5, flex: 1, margin: 0 }}>
          End: {describeEnd(sketch.toAttachment)}
        </p>
        {!sketch.toAttachment && (
          <button
            type="button"
            onClick={() => onPinSketchEnd(sketchId, 'to')}
            style={{ ...smallButtonStyle, flexShrink: 0 }}
          >
            Pin
          </button>
        )}
      </div>

      {bothAttached ? (
        <>
          <div style={sectionTitleStyle}>Convert to path</div>
          <div style={rowStyle}>
            <label style={labelStyle}>Path style</label>
            <select value={style} style={inputStyle} onChange={(e) => setStyle(e.target.value as EdgeStyle)}>
              <option value="transparent">Transparent</option>
              <option value="conveyor">Conveyor</option>
              <option value="glassTube">Glass tube</option>
              <option value="trace">Trace</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => onConvertSketch(sketchId, style)}
            style={{ ...smallButtonStyle, width: '100%', color: theme.accentStrong, borderColor: theme.accent, marginBottom: 10 }}
          >
            Convert to path
          </button>
        </>
      ) : (
        <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginBottom: 10 }}>
          Pin both ends to a node's port to convert this into a real path.
        </p>
      )}

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: theme.danger, borderColor: theme.dangerSoft }}
      >
        Delete sketch
      </button>
    </div>
  );
}

/** Falcon, 2026-09-05 ("then the middle path was converted to arc/
 * curve path"): the drilled-into view for ONE segment of a multi-
 * segment sketch — a scoped-down mirror of PathShapeField's Linear/
 * Curve control, but writing to SketchLayer's own per-segment bow
 * instead of FloorLayout (sketches carry no GraphModel meaning at
 * all, multi-segment ones doubly so — see the "can't convert yet"
 * note one level up). Deliberately NOT tangent-continuous with its
 * neighboring segments (Falcon, 2026-09-05: that's explicitly a LATER
 * idea) — converting this one leg to an arc never reshapes the
 * others. */
function SketchSegmentProperties({
  sketchId,
  segmentIndex,
  sketch,
  sketchLayer,
  onDelete,
}: {
  sketchId: string;
  segmentIndex: number;
  sketch: Sketch;
  sketchLayer: SketchLayer;
  onDelete: () => void;
}) {
  const initialBow = sketch.segments[segmentIndex]!.bow;
  // Falcon, 2026-09-05 ("whenever i try to replace or try to reduce
  // the value... whenever it hits zero its gets reset to linear
  // type... adds so much friction"): segmentType used to be DERIVED
  // straight from bow===0, so any transient zero while editing --
  // clearing the box to retype, or just passing through 0 on the way
  // to a negative number -- yanked the dropdown back to Linear and
  // unmounted this very input mid-keystroke. It's now its own state,
  // flipped only by the dropdown itself (or, deliberately, by
  // actually settling on 0 -- see handleBowBlur, which keeps the
  // original "typing 0 IS Linear" intent, just applied once the user
  // is done typing instead of on every keystroke). bowText is a
  // separate raw-text buffer for the same reason: "-", ".", or an
  // emptied box are all valid, unfinished states a real number can't
  // represent, and committing Number(text) straight into the model on
  // every keystroke (the old behavior) could and did write NaN into a
  // segment's bow the instant one of those was typed.
  const [bow, setBow] = useState(initialBow);
  const [bowText, setBowText] = useState(String(initialBow));
  const [segmentType, setSegmentType] = useState<'linear' | 'curve'>(initialBow === 0 ? 'linear' : 'curve');

  function commitBow(nextBow: number): void {
    setBow(nextBow);
    const segments = sketch.segments.map((seg, i) => (i === segmentIndex ? { bow: nextBow } : seg));
    sketchLayer.update(sketchId, { segments });
  }

  function handleTypeChange(nextType: 'linear' | 'curve'): void {
    setSegmentType(nextType);
    const nextBow = nextType === 'linear' ? 0 : INITIAL_CURVE_BOW;
    setBowText(String(nextBow));
    commitBow(nextBow);
  }

  function handleBowTextChange(text: string): void {
    setBowText(text);
    const parsed = Number(text);
    if (text.trim() !== '' && Number.isFinite(parsed)) {
      commitBow(parsed);
    }
  }

  function handleBowBlur(): void {
    const parsed = Number(bowText);
    if (bowText.trim() === '' || !Number.isFinite(parsed)) {
      // Left it mid-edit (just "-", or emptied) -- snap the text back
      // to whatever's actually committed rather than leaving a
      // broken-looking field.
      setBowText(String(bow));
      return;
    }
    if (parsed === 0) {
      setSegmentType('linear');
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
        Segment {segmentIndex + 1} of {sketch.segments.length}
      </div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5, marginBottom: 10 }}>
        One leg of this sketch — purely visual, same as the sketch as a whole. Changing its shape doesn't affect its
        neighbors.
      </p>

      <div style={sectionTitleStyle}>Shape</div>
      <div style={rowStyle}>
        <label style={labelStyle}>Segment type</label>
        <select
          value={segmentType}
          style={inputStyle}
          onChange={(e) => handleTypeChange(e.target.value as 'linear' | 'curve')}
        >
          <option value="linear">Linear (straight)</option>
          <option value="curve">Curve (arc)</option>
        </select>
      </div>
      {segmentType === 'curve' && (
        <div style={rowStyle}>
          <label style={labelStyle}>Curvature</label>
          <input
            type="number"
            step={0.05}
            value={bowText}
            style={inputStyle}
            onChange={(e) => handleBowTextChange(e.target.value)}
            onBlur={handleBowBlur}
          />
        </div>
      )}

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: theme.danger, borderColor: theme.dangerSoft }}
      >
        Delete whole sketch
      </button>
    </div>
  );
}

/** INSERT tab (Falcon, 2026-09-09, scoped to "free-floating on canvas
 * for now"): a canvas annotation's own properties -- which icon it
 * uses, its free-text label, and delete. Reads/writes AnnotationLayer
 * directly (design doc §4.6's "single source of truth" convention,
 * same as SketchProperties reads/writes SketchLayer) except for the
 * label, which is bounced through App.tsx's onUpdateLabel just so
 * every keystroke doesn't need its own local-state dance here -- kept
 * as local state anyway so typing feels immediate rather than
 * re-reading the store on every render. */
function AnnotationProperties({
  annotationId,
  annotationLayer,
  customIconLibrary,
  onUpdateLabel,
  onDelete,
}: {
  annotationId: string;
  annotationLayer: AnnotationLayer;
  customIconLibrary: CustomIconLibrary;
  onUpdateLabel: (id: string, label: string) => void;
  onDelete: () => void;
}) {
  const annotation = annotationLayer.get(annotationId);
  const [label, setLabel] = useState(annotation?.label ?? '');
  const [fontSize, setFontSize] = useState(annotation?.fontSize ?? 14);
  const [fontFamily, setFontFamily] = useState(annotation?.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY);
  const [color, setColor] = useState(annotation?.color ?? '#1f2430');
  const [bold, setBold] = useState(annotation?.bold ?? false);
  const [italic, setItalic] = useState(annotation?.italic ?? false);
  // Falcon, 2026-09-09 ("resize icon feature" / "toggle icon badge"):
  const [iconSize, setIconSize] = useState(annotation?.iconSize ?? 18);
  const [badge, setBadge] = useState(annotation?.badge ?? false);
  const [badgeColor, setBadgeColor] = useState(annotation?.badgeColor ?? '#ffffff');

  if (!annotation) return <p style={{ fontSize: 12, color: theme.danger }}>Annotation no longer exists.</p>;

  const isText = annotation.kind === 'text';
  const isCustom = annotation.kind === 'custom';
  const customEntry = isCustom && annotation.customIconId ? customIconLibrary.get(annotation.customIconId) : undefined;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
        {isText ? 'Text box' : isCustom ? 'Custom icon' : 'Annotation'}
      </div>
      <p style={{ fontSize: 12, color: theme.text3, lineHeight: 1.5 }}>
        {isText
          ? 'A free-floating text box — purely explanatory, no simulation meaning.'
          : isCustom
            ? customEntry
              ? `A free-floating "${customEntry.name}" custom icon — purely explanatory, no simulation meaning.`
              : 'This custom icon was removed from the shared library — showing a placeholder. Pick a different icon from the INSERT tab, or delete this annotation.'
            : `A free-floating ${ANNOTATION_ICON_LABEL[annotation.icon ?? 'marker']} marker — purely explanatory, no simulation meaning.`}
      </p>

      {isCustom && customEntry && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <img src={customEntry.dataUrl} alt={customEntry.name} style={{ width: 48, height: 48, objectFit: 'contain' }} />
        </div>
      )}

      {!isText && (
        <>
          {/* Falcon, 2026-09-09 ("remove the icon property remove the
              other options or icons on the property"): the built-in
              icon SWITCHER grid that used to live here is gone --
              Size and Badge below are what replaced it. Applies to
              both 'icon' and 'custom' kinds now, not just built-ins,
              since resizing/badging an imported image is the same
              idea. */}
          <div style={sectionTitleStyle}>Icon</div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Size</label>
            <input
              type="number"
              min={4}
              max={200}
              value={iconSize}
              style={inputStyle}
              onChange={(e) => {
                const n = Number(e.target.value);
                setIconSize(n);
                if (Number.isFinite(n) && n > 0) annotationLayer.update(annotationId, { iconSize: n });
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: badge ? 8 : 10 }}>
            <button
              type="button"
              onClick={() => {
                const next = !badge;
                setBadge(next);
                annotationLayer.update(annotationId, { badge: next });
              }}
              title="Show a colored badge circle behind the icon"
              style={{
                ...smallButtonStyle,
                flex: 1,
                fontWeight: 700,
                color: badge ? theme.accentStrong : theme.text1,
                borderColor: badge ? theme.accent : theme.borderStrong,
              }}
            >
              Badge {badge ? 'on' : 'off'}
            </button>
          </div>
          {badge && (
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Badge color</label>
              <input
                type="color"
                value={badgeColor}
                style={{ ...inputStyle, padding: 2, height: 30 }}
                onChange={(e) => {
                  setBadgeColor(e.target.value);
                  annotationLayer.update(annotationId, { badgeColor: e.target.value });
                }}
              />
            </div>
          )}
        </>
      )}

      <div style={rowStyle}>
        <label style={labelStyle}>{isText ? 'Text' : 'Label'}</label>
        <input
          type="text"
          value={label}
          placeholder={isText ? 'Type your text…' : '(no label)'}
          autoFocus={isText && !annotation.label}
          style={inputStyle}
          onChange={(e) => {
            setLabel(e.target.value);
            onUpdateLabel(annotationId, e.target.value);
          }}
        />
      </div>

      <div style={sectionTitleStyle}>Font</div>
      <div style={rowStyle}>
        <label style={labelStyle}>Style</label>
        <select
          value={fontFamily}
          style={inputStyle}
          onChange={(e) => {
            setFontFamily(e.target.value);
            annotationLayer.update(annotationId, { fontFamily: e.target.value });
          }}
        >
          {ANNOTATION_FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Size</label>
          <input
            type="number"
            min={4}
            max={200}
            value={fontSize}
            style={inputStyle}
            onChange={(e) => {
              const n = Number(e.target.value);
              setFontSize(n);
              if (Number.isFinite(n) && n > 0) annotationLayer.update(annotationId, { fontSize: n });
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Color</label>
          <input
            type="color"
            value={color}
            style={{ ...inputStyle, padding: 2, height: 30 }}
            onChange={(e) => {
              setColor(e.target.value);
              annotationLayer.update(annotationId, { color: e.target.value });
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => {
            const next = !bold;
            setBold(next);
            annotationLayer.update(annotationId, { bold: next });
          }}
          title="Bold"
          style={{
            ...smallButtonStyle,
            flex: 1,
            fontWeight: 700,
            color: bold ? theme.accentStrong : theme.text1,
            borderColor: bold ? theme.accent : theme.borderStrong,
          }}
        >
          B
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !italic;
            setItalic(next);
            annotationLayer.update(annotationId, { italic: next });
          }}
          title="Italic"
          style={{
            ...smallButtonStyle,
            flex: 1,
            fontStyle: 'italic',
            color: italic ? theme.accentStrong : theme.text1,
            borderColor: italic ? theme.accent : theme.borderStrong,
          }}
        >
          I
        </button>
      </div>

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: theme.danger, borderColor: theme.dangerSoft }}
      >
        Delete {isText ? 'text box' : 'annotation'}
      </button>
    </div>
  );
}


function EdgeProperties({
  edgeId,
  graph,
  skinConfig,
  floorLayout,
  onDelete,
}: {
  edgeId: string;
  graph: GraphModel;
  skinConfig: SkinConfig;
  floorLayout: FloorLayout;
  onDelete: () => void;
}) {
  const edge = graph.getEdge(edgeId);
  if (!edge) return <p style={{ fontSize: 12, color: theme.danger }}>Edge no longer exists.</p>;

  // Falcon, 2026-09-05 ("one continuous path... treating it as simple
  // paths connected as one"): an edge converted from a multi-segment
  // sketch carries a real shape (FloorLayout.getEdgeInteriorPoints),
  // not just a single bow -- PathShapeField's Linear/Curve dropdown
  // only ever edits that single bow, so showing it here would look
  // like it does something and silently do nothing. Read-only info
  // instead for now; per-leg editing (mirroring SketchSegmentProperties)
  // is a natural follow-up, not required for the path to actually work.
  const interiorPoints = floorLayout.getEdgeInteriorPoints(edgeId);
  const isMultiSegmentPath = Boolean(interiorPoints && interiorPoints.length > 0);

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Edge</div>
      <div style={{ fontSize: 11, color: theme.text3, marginBottom: 4 }}>
        {edge.source} → {edge.target}
      </div>

      <div style={sectionTitleStyle}>Logic (design doc §5.4)</div>
      <EdgeLogicFields edge={edge} graph={graph} floorLayout={floorLayout} />

      <div style={sectionTitleStyle}>Path shape (design doc §5.1)</div>
      {isMultiSegmentPath ? (
        <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5 }}>
          Multi-segment path — {(interiorPoints?.length ?? 0) + 1} legs, converted from a sketch shape. Per-leg
          curvature editing isn't available here yet.
        </p>
      ) : (
        <PathShapeField edgeId={edgeId} floorLayout={floorLayout} />
      )}

      <div style={sectionTitleStyle}>Skin (design doc §5.2, §5.3)</div>
      <EdgeSkinFields edgeId={edgeId} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: theme.danger, borderColor: theme.dangerSoft }}
      >
        Delete edge
      </button>
    </div>
  );
}

/** Path type (Falcon, 2026-09-03: "the basic one is the linear type
 * (straight line) and curve type") — a floor-layer geometry choice
 * (design doc §5.1's curveBetween `bow` parameter), not a skin
 * concern: bow=0 is a dead-straight line, any other value ("curve")
 * is a bend of that exact magnitude/direction. Picking "Curve" from
 * the dropdown starts a fresh curve at INITIAL_CURVE_BOW (a visibly-
 * curved starting point — bow=0 would render identically to Linear,
 * defeating the point of picking Curve at all) rather than
 * remembering whatever custom bow a path had before switching away
 * from Curve and back.
 *
 * Falcon, 2026-09-05: "for curve paths i now want radius option on
 * its properties to adjust its curvature" — the numeric field below
 * (shown only once Curve is selected) exposes that SAME bow value
 * directly for fine control, rather than being locked to the one
 * fixed starting magnitude. Deliberately labeled "Curvature", not
 * "Radius" — this is the existing bow fraction (design doc §5.1: "a
 * fraction of the direct distance, offset perpendicular to it"), not
 * a literal geometric arc radius (today's curves are cubic beziers,
 * not circular arcs, so there's no single radius that describes one
 * exactly). Typing 0 here is equivalent to picking "Linear" again —
 * the dropdown above reflects that on the very next render, same as
 * it always has (pathType is DERIVED from bow, not tracked
 * separately). */
const INITIAL_CURVE_BOW = 0.15;

function PathShapeField({ edgeId, floorLayout }: { edgeId: string; floorLayout: FloorLayout }) {
  const initialBow = floorLayout.getEdgeBow(edgeId);
  // Falcon, 2026-09-05: same friction fix as SketchSegmentProperties
  // (identical bow/INITIAL_CURVE_BOW pattern) -- pathType is its own
  // state now, flipped by the dropdown or by actually settling on 0
  // on blur, not by every transient value the number input passes
  // through while typing (e.g. clearing the box to type a negative
  // curvature used to bounce straight back to "Linear" and hide this
  // very field). bowText is a raw-text buffer so "-", ".", or an
  // emptied box can exist on screen without writing NaN into the
  // edge's bow.
  const [bow, setBow] = useState(initialBow);
  const [bowText, setBowText] = useState(String(initialBow));
  const [pathType, setPathType] = useState<'linear' | 'curve'>(initialBow === 0 ? 'linear' : 'curve');

  function commitBow(nextBow: number): void {
    setBow(nextBow);
    floorLayout.setEdgeBow(edgeId, nextBow);
  }

  function handleTypeChange(nextType: 'linear' | 'curve'): void {
    setPathType(nextType);
    const nextBow = nextType === 'linear' ? 0 : INITIAL_CURVE_BOW;
    setBowText(String(nextBow));
    commitBow(nextBow);
  }

  function handleBowTextChange(text: string): void {
    setBowText(text);
    const parsed = Number(text);
    if (text.trim() !== '' && Number.isFinite(parsed)) {
      commitBow(parsed);
    }
  }

  function handleBowBlur(): void {
    const parsed = Number(bowText);
    if (bowText.trim() === '' || !Number.isFinite(parsed)) {
      setBowText(String(bow));
      return;
    }
    if (parsed === 0) {
      setPathType('linear');
    }
  }

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Path type</label>
        <select
          value={pathType}
          style={inputStyle}
          onChange={(e) => handleTypeChange(e.target.value as 'linear' | 'curve')}
        >
          <option value="linear">Linear (straight)</option>
          <option value="curve">Curve</option>
        </select>
      </div>
      {pathType === 'curve' && (
        <div style={rowStyle}>
          <label style={labelStyle}>Curvature</label>
          <input
            type="number"
            step={0.05}
            value={bowText}
            style={inputStyle}
            onChange={(e) => handleBowTextChange(e.target.value)}
            onBlur={handleBowBlur}
          />
        </div>
      )}
    </>
  );
}

/** Compass-labeled "which side of the node is this wire's end plugged
 * into" dropdown for an ORDINARY edge (2026-09-10, Falcon: "the ports
 * are named according to compass ... how can i set it in the
 * properties which port?") — the generic sibling of
 * SingleOutputSidePicker above, usable on EITHER end of any edge, not
 * just a maxOutputs-1 kind's single output. Moving it reassigns the
 * REAL floor-layer anchor (`floorLayout.reassignAnchor`) and keeps
 * GraphModel's sourcePort/targetPort in lockstep in the same click
 * (`graph.updateEdgePorts`) — the two are never allowed to drift apart
 * post-2026-09-10 (see GraphModel.updateEdgePorts's own doc comment).
 * A side already taken by a DIFFERENT edge on this node is disabled
 * rather than silently rejected on click (reassignAnchor would refuse
 * it anyway; disabling tells the user why up front). */
function EdgeSideSelect({
  edgeId,
  nodeId,
  end,
  value,
  graph,
  floorLayout,
  onChange,
}: {
  edgeId: string;
  nodeId: string;
  end: 'source' | 'target';
  value: number;
  graph: GraphModel;
  floorLayout: FloorLayout;
  onChange: (v: number) => void;
}) {
  return (
    <select
      value={value}
      style={inputStyle}
      onChange={(e) => {
        const v = Number(e.target.value);
        const ok = floorLayout.reassignAnchor(edgeId, end, v);
        if (!ok) return;
        graph.updateEdgePorts(edgeId, end === 'source' ? { sourcePort: v } : { targetPort: v });
        onChange(v);
      }}
    >
      {Array.from({ length: 8 }, (_, i) => i).map((i) => (
        <option key={i} value={i} disabled={i !== value && floorLayout.isAnchorOccupied(nodeId, i)}>
          {compassLabel(i)}
        </option>
      ))}
    </select>
  );
}

/** Speed (Falcon, 2026-09-03: "why does a longer path make the
 * object seem to travel faster?" — because `flowRate` is progress-
 * per-second, edge-length-independent by design (design doc §5.1: an
 * item always takes exactly `1 / flowRate` seconds to cross an edge,
 * whatever its length, so a longer edge covers more pixels in that
 * same fixed time). SimEngine (logic) is deliberately headless and
 * never touches geometry, so it can only ever consume that abstract
 * progress-per-second number — it has no way to know a path's real
 * length. "Speed" is a friendlier UNIT for editing the very same
 * `flowRate`, converted using the edge's CURRENT path length (a
 * floor-layer fact this panel already has, via `floorLayout`) — this
 * is a UI-layer convenience conversion only, not a new stored field
 * or a change to SimEngine/GraphModel. Both fields write the same
 * `edge.flowRate`, kept in sync live so editing either updates the
 * other's display. Caveat: this is a one-time conversion at the
 * moment you type a value — if the node is later dragged and the
 * path gets longer/shorter, `flowRate` itself doesn't auto-adjust
 * (same as it never has), so the item's actual speed will drift
 * again and Speed will need re-entering to pin it back down. */
function EdgeLogicFields({
  edge,
  graph,
  floorLayout,
}: {
  edge: EdgeDef;
  graph: GraphModel;
  floorLayout: FloorLayout;
}) {
  const [sourcePort, setSourcePort] = useState(edge.sourcePort);
  const [targetPort, setTargetPort] = useState(edge.targetPort);
  const [flowRate, setFlowRate] = useState(edge.flowRate);
  const [active, setActive] = useState(edge.active);
  const [speedLocked, setSpeedLocked] = useState(edge.speedLocked ?? false);
  const [respectItemSize, setRespectItemSize] = useState(edge.respectItemSize !== false);
  const [edgeKind, setEdgeKind] = useState<'item' | 'signal'>(edge.edgeKind === 'signal' ? 'signal' : 'item');

  const pathLength = floorLayout.getEdgeCurve(edge.id)?.totalLength ?? 0;
  const [speed, setSpeed] = useState(flowRate * pathLength);

  // Falcon, 2026-09-05 ("Option D"): App.tsx's own poll keeps
  // rewriting this edge's flowRate in the background while it's
  // locked, any time the path's length changes elsewhere (dragging a
  // node, adjusting curvature) -- this mirrors that same resync here
  // so the fields stay visibly accurate without needing to reselect
  // the path.
  useEffect(() => {
    if (!speedLocked) return;
    const id = window.setInterval(() => {
      const current = graph.getEdge(edge.id);
      if (!current) return;
      const currentLength = floorLayout.getEdgeCurve(edge.id)?.totalLength ?? 0;
      setFlowRate(current.flowRate);
      setSpeed(current.flowRate * currentLength);
    }, 250);
    return () => window.clearInterval(id);
  }, [speedLocked, edge.id, graph, floorLayout]);

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Source side</label>
          <EdgeSideSelect
            edgeId={edge.id}
            nodeId={edge.source}
            end="source"
            value={sourcePort}
            graph={graph}
            floorLayout={floorLayout}
            onChange={setSourcePort}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Target side</label>
          <EdgeSideSelect
            edgeId={edge.id}
            nodeId={edge.target}
            end="target"
            value={targetPort}
            graph={graph}
            floorLayout={floorLayout}
            onChange={setTargetPort}
          />
        </div>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Edge kind (design doc \u00a75.5)</label>
        <select
          value={edgeKind}
          style={inputStyle}
          onChange={(e) => {
            const v = e.target.value as 'item' | 'signal';
            setEdgeKind(v);
            graph.setEdgeKind(edge.id, v);
          }}
        >
          <option value="item">Item (physical, default)</option>
          <option value="signal">Signal (Sensor \u2192 Gate pulse)</option>
        </select>
      </div>
      {edgeKind === 'signal' ? (
        <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, marginTop: -4, marginBottom: 10 }}>
          A signal edge carries a Sensor's on/off condition, not a physical item \u2014 speed/flow rate don't apply.
          Only "Active" below still matters: an inactive signal edge is skipped entirely, same as a real Sensor
          connection that doesn't exist.
        </p>
      ) : (
        <>
          <div style={rowStyle}>
            <label style={labelStyle}>Speed (world units / second)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={Math.round(speed * 100) / 100}
              style={inputStyle}
              disabled={pathLength <= 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                if (pathLength > 0) {
                  const nextFlowRate = v / pathLength;
                  setFlowRate(nextFlowRate);
                  graph.setEdgeFlowRate(edge.id, nextFlowRate);
                  if (speedLocked) graph.setEdgeSpeedLock(edge.id, true, v);
                }
              }}
            />
          </div>
          <label
            style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: -4 }}
          >
            <input
              type="checkbox"
              checked={speedLocked}
              disabled={pathLength <= 0}
              onChange={(e) => {
                const locked = e.target.checked;
                setSpeedLocked(locked);
                graph.setEdgeSpeedLock(edge.id, locked, locked ? speed : undefined);
              }}
            />
            Lock apparent speed
          </label>
          <div style={rowStyle}>
            <label style={labelStyle}>Flow rate (progress / logic-second)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={flowRate}
              style={inputStyle}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFlowRate(v);
                setSpeed(v * pathLength);
                graph.setEdgeFlowRate(edge.id, v);
                if (speedLocked && pathLength > 0) graph.setEdgeSpeedLock(edge.id, true, v * pathLength);
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: theme.text3, marginTop: -6, marginBottom: 10 }}>
            {speedLocked
              ? "This path's speed stays pinned as it's resized \u2014 flow rate above is kept in sync automatically."
              : "Speed is converted to flow rate using this path's current length \u2014 if you drag a connected node afterward, the path's length changes but flow rate doesn't auto-adjust, so re-enter speed to keep it pinned (or turn on Lock apparent speed above)."}
          </div>
          {edge.edgeKind !== 'dock' && (
            <>
              <label
                style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: -4 }}
              >
                <input
                  type="checkbox"
                  checked={respectItemSize}
                  disabled={pathLength <= 0}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setRespectItemSize(enabled);
                    graph.setEdgeItemSpacing(edge.id, enabled);
                    if (enabled && pathLength > 0) graph.setEdgePathLength(edge.id, pathLength);
                  }}
                />
                Respect item size (no overlap)
              </label>
              <div style={{ fontSize: 10, color: theme.text3, marginTop: -6, marginBottom: 10 }}>
                {respectItemSize
                  ? "Items on this path keep at least their own size of clearance from whichever item is ahead of them \u2014 they queue like physical objects instead of stacking (on by default)."
                  : 'Turned off for this path \u2014 items can catch up to and visually stack on top of one another. Check this back on to keep them spaced out by size again.'}
              </div>
            </>
          )}
        </>
      )}
      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => {
            setActive(e.target.checked);
            graph.setEdgeActive(edge.id, e.target.checked);
          }}
        />
        Active (gate open)
      </label>
    </>
  );
}

function EdgeSkinFields({ edgeId, skinConfig }: { edgeId: string; skinConfig: SkinConfig }) {
  const current = skinConfig.getEdgeSkin(edgeId);
  const [style, setStyle] = useState<EdgeStyle>(current.style);
  const [color, setColor] = useState(current.color);
  const [strokeWidth, setStrokeWidth] = useState(current.strokeWidth);
  const [itemOrientation, setItemOrientation] = useState<ItemOrientationMode>(current.itemOrientation);
  const [spinSpeed, setSpinSpeed] = useState(current.spinSpeed);

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Path style</label>
        <select
          value={style}
          style={inputStyle}
          onChange={(e) => {
            const v = e.target.value as EdgeStyle;
            setStyle(v);
            skinConfig.setEdgeSkin(edgeId, { style: v });
          }}
        >
          <option value="transparent">Transparent</option>
          <option value="conveyor">Conveyor</option>
          <option value="glassTube">Glass tube</option>
          <option value="trace">Trace</option>
          {/* Copper (design doc §5.5) isn't offered as a free pick --
              App.tsx applies it automatically to a Sensor's signal
              connections. Listed only so a copper edge's OWN dropdown
              shows its real current value instead of falling through
              to nothing selected. */}
          {style === 'copper' && <option value="copper">Copper (auto — Sensor signal path)</option>}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Color</label>
          <input
            type="color"
            value={color}
            style={{ ...inputStyle, padding: 2, height: 30 }}
            onChange={(e) => {
              setColor(e.target.value);
              skinConfig.setEdgeSkin(edgeId, { color: e.target.value });
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Width</label>
          <input
            type="number"
            min={1}
            value={strokeWidth}
            style={inputStyle}
            onChange={(e) => {
              const v = Number(e.target.value);
              setStrokeWidth(v);
              skinConfig.setEdgeSkin(edgeId, { strokeWidth: v });
            }}
          />
        </div>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Item orientation</label>
        <select
          value={itemOrientation}
          style={inputStyle}
          onChange={(e) => {
            const v = e.target.value as ItemOrientationMode;
            setItemOrientation(v);
            skinConfig.setEdgeSkin(edgeId, { itemOrientation: v });
          }}
        >
          <option value="static">Static</option>
          <option value="parallel">Parallel (follows curve)</option>
          <option value="circling">Circling (spins)</option>
        </select>
      </div>
      {itemOrientation === 'circling' && (
        <div style={rowStyle}>
          <label style={labelStyle}>Spin speed (radians/sec)</label>
          <input
            type="number"
            step={0.1}
            value={spinSpeed}
            style={inputStyle}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpinSpeed(v);
              skinConfig.setEdgeSkin(edgeId, { spinSpeed: v });
            }}
          />
        </div>
      )}
    </>
  );
}
