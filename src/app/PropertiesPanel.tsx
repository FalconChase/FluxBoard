import { useEffect, useState, type CSSProperties } from 'react';
import { GraphModel } from '../core/GraphModel';
import type { EdgeDef, NodeDef } from '../core/types';
import { getPortCapacity } from '../core/nodes/portCapacity';
import type { FloorLayout } from '../floor/floorLayout';
import type { SkinConfig } from '../skin/SkinConfig';
import type { EdgeStyle, ItemOrientationMode } from '../skin/pathSkin';
import type { ObjectRegistry } from '../skin/ObjectRegistry';
import type { Selection } from './selection';
import type { Sketch, SketchLayer } from './sketchLayer';
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

      {node.kind === 'source' && <SourceFields node={node} onChange={patch} objectRegistry={objectRegistry} />}
      {node.kind === 'distributor' && <DistributorFields node={node} onChange={patch} />}
      {node.kind === 'merger' && (
        <p style={{ fontSize: 12, color: theme.text3 }}>
          Merger has nothing to configure — every arriving item forwards straight out its one output.
        </p>
      )}
      {node.kind === 'sorter' && <SorterFields node={node} onChange={patch} objectRegistry={objectRegistry} />}
      {node.kind === 'mixer' && <MixerFields node={node} onChange={patch} objectRegistry={objectRegistry} />}
      {node.kind === 'buffer' && <BufferFields node={node} onChange={patch} />}
      {node.kind === 'sink' && (
        <p style={{ fontSize: 12, color: theme.text3 }}>Sink has nothing to configure — it just consumes.</p>
      )}

      <SingleOutputSidePicker nodeId={nodeId} kind={node.kind} graph={graph} floorLayout={floorLayout} />

      <div style={sectionTitleStyle}>Z-order</div>
      <ZOrderButtons nodeId={nodeId} graph={graph} skinConfig={skinConfig} />

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
 * 6=N,7=NE). */
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

  // [label, anchorIndex] in visual reading order for a 3x3 compass
  // grid, center cell left empty.
  const COMPASS: (readonly [string, number] | null)[] = [
    ['NW', 5], ['N', 6], ['NE', 7],
    ['W', 4], null, ['E', 0],
    ['SW', 3], ['S', 2], ['SE', 1],
  ];

  function pick(anchorIndex: number): void {
    floorLayout.reassignAnchor(edge!.id, 'source', anchorIndex);
    forceRender((n) => n + 1); // FloorLayout mutates directly (§4.6) — nudge this panel to reread it
  }

  return (
    <>
      <div style={sectionTitleStyle}>Output side</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, width: 108, marginBottom: 4 }}>
        {COMPASS.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />;
          const [label, anchorIndex] = cell;
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

function SourceFields({
  node,
  onChange,
  objectRegistry,
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
}) {
  const [cooldown, setCooldown] = useState(typeof node.config.cooldown === 'number' ? node.config.cooldown : 1);
  const [itemType, setItemType] = useState(typeof node.config.itemType === 'string' ? node.config.itemType : 'item');
  return (
    <>
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
          }}
        />
      </div>
    </>
  );
}

function DistributorFields({ node, onChange }: { node: NodeDef; onChange: (fields: Record<string, unknown>) => void }) {
  const [mode, setMode] = useState(node.config.mode === 'broadcast' ? 'broadcast' : 'roundRobin');
  return (
    <div style={rowStyle}>
      <label style={labelStyle}>Mode</label>
      <select
        value={mode}
        style={inputStyle}
        onChange={(e) => {
          setMode(e.target.value);
          onChange({ mode: e.target.value });
        }}
      >
        <option value="roundRobin">Round-robin</option>
        <option value="broadcast">Broadcast</option>
      </select>
    </div>
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
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
}) {
  const initialRules = Array.isArray(node.config.rules) ? (node.config.rules as SorterRuleRow[]) : [];
  const [rules, setRules] = useState<SorterRuleRow[]>(initialRules.map((r) => ({ ...r })));
  const [defaultPort, setDefaultPort] = useState(
    typeof node.config.defaultPort === 'number' ? String(node.config.defaultPort) : '',
  );
  const [unmatchedPolicy, setUnmatchedPolicy] = useState(node.config.unmatchedPolicy === 'drop' ? 'drop' : 'hold');

  function commitRules(next: SorterRuleRow[]): void {
    setRules(next);
    onChange({ rules: next });
  }

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Rules (first match wins)</label>
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
            <input
              type="number"
              placeholder="port"
              value={rule.outputPort}
              style={{ ...inputStyle, flex: 1 }}
              onChange={(e) => {
                const next = rules.map((r, idx) => (idx === i ? { ...r, outputPort: Number(e.target.value) } : r));
                commitRules(next);
              }}
            />
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
          onClick={() => commitRules([...rules, { itemType: '', outputPort: 0 }])}
          style={smallButtonStyle}
        >
          + Add rule
        </button>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Default port (blank = none)</label>
        <input
          type="number"
          value={defaultPort}
          style={inputStyle}
          onChange={(e) => {
            setDefaultPort(e.target.value);
            onChange({ defaultPort: e.target.value === '' ? undefined : Number(e.target.value) });
          }}
        />
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
}: {
  node: NodeDef;
  onChange: (fields: Record<string, unknown>) => void;
  objectRegistry: ObjectRegistry;
}) {
  const recipeObj = (node.config.recipe ?? {}) as Record<number, string>;
  const [rows, setRows] = useState<RecipeRow[]>(
    Object.entries(recipeObj).map(([port, itemType]) => ({ port: Number(port), itemType: String(itemType) })),
  );
  const [outputPort, setOutputPort] = useState(typeof node.config.outputPort === 'number' ? node.config.outputPort : 0);
  const [outputType, setOutputType] = useState(
    typeof node.config.outputType === 'string' ? node.config.outputType : 'item',
  );
  const [bufferCapacity, setBufferCapacity] = useState(
    typeof node.config.bufferCapacity === 'number' ? String(node.config.bufferCapacity) : '',
  );

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
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input
              type="number"
              placeholder="port"
              value={row.port}
              style={{ ...inputStyle, flex: 1 }}
              onChange={(e) => {
                const next = rows.map((r, idx) => (idx === i ? { ...r, port: Number(e.target.value) } : r));
                commitRows(next);
              }}
            />
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
        <button type="button" onClick={() => commitRows([...rows, { port: rows.length, itemType: '' }])} style={smallButtonStyle}>
          + Add input
        </button>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Output port</label>
        <input
          type="number"
          value={outputPort}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            setOutputPort(v);
            onChange({ outputPort: v });
          }}
        />
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

function BufferFields({ node, onChange }: { node: NodeDef; onChange: (fields: Record<string, unknown>) => void }) {
  const [capacity, setCapacity] = useState(
    typeof node.config.capacity === 'number' ? String(node.config.capacity) : '',
  );
  const [overflowPolicy, setOverflowPolicy] = useState(node.config.overflowPolicy === 'divert' ? 'divert' : 'block');
  const [overflowPort, setOverflowPort] = useState(
    typeof node.config.overflowPort === 'number' ? node.config.overflowPort : 1,
  );
  const [outputPort, setOutputPort] = useState(typeof node.config.outputPort === 'number' ? node.config.outputPort : 0);

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
          <input
            type="number"
            value={overflowPort}
            style={inputStyle}
            onChange={(e) => {
              const v = Number(e.target.value);
              setOverflowPort(v);
              onChange({ overflowPort: v });
            }}
          />
        </div>
      )}
      <div style={rowStyle}>
        <label style={labelStyle}>Output port</label>
        <input
          type="number"
          value={outputPort}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            setOutputPort(v);
            onChange({ outputPort: v });
          }}
        />
      </div>
    </>
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
          <label style={labelStyle}>Source port</label>
          <input
            type="number"
            value={sourcePort}
            style={inputStyle}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSourcePort(v);
              graph.updateEdgePorts(edge.id, { sourcePort: v });
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Target port</label>
          <input
            type="number"
            value={targetPort}
            style={inputStyle}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTargetPort(v);
              graph.updateEdgePorts(edge.id, { targetPort: v });
            }}
          />
        </div>
      </div>
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
