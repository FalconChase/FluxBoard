import { useState, type CSSProperties } from 'react';
import { GraphModel } from '../core/GraphModel';
import type { EdgeDef, NodeDef } from '../core/types';
import { getPortCapacity } from '../core/nodes/portCapacity';
import type { FloorLayout } from '../floor/floorLayout';
import type { SkinConfig } from '../skin/SkinConfig';
import type { EdgeStyle, ItemOrientationMode } from '../skin/pathSkin';
import type { Selection } from './selection';
import type { SketchLayer } from './sketchLayer';

interface PropertiesPanelProps {
  selection: Selection | null;
  graph: GraphModel;
  skinConfig: SkinConfig;
  floorLayout: FloorLayout;
  sketchLayer: SketchLayer;
  /** Deletes whatever is currently selected (node — cascading to its
   * edges — or edge). App.tsx owns the actual GraphModel/FloorLayout/
   * SkinConfig cleanup and the Delete/Backspace shortcut; this panel
   * only offers the same action as a button, and doesn't need to know
   * the selection's id since App.tsx already has it. */
  onDelete: () => void;

  /** Canvas & Simulation section (wireframe's second properties-panel
   * zone): global settings, not tied to any selection — App.tsx owns
   * the actual state (FluxCanvas/App-level, not GraphModel/SkinConfig,
   * since neither the grid nor the tick rate is part of the saved
   * graph). Always rendered, regardless of what's selected. */
  gridSpacing: number;
  onGridSpacingChange: (spacing: number) => void;
  tickIntervalMs: number;
  onTickIntervalMsChange: (ms: number) => void;
}

const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b6b73', display: 'block', marginBottom: 3 };
const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '5px 7px',
  borderRadius: 5,
  border: '1px solid #d8d7dd',
  boxSizing: 'border-box',
};
const rowStyle: CSSProperties = { marginBottom: 10 };
const sectionTitleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#8a8a93',
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
  onDelete,
  gridSpacing,
  onGridSpacingChange,
  tickIntervalMs,
  onTickIntervalMsChange,
}: PropertiesPanelProps) {
  // Keys just the selection-editing block below, not this whole
  // component — so every field inside NodeProperties/EdgeProperties
  // can hold plain local state without worrying about stale values
  // from a previous selection (the reason this key exists at all),
  // while the CanvasSettingsSection underneath stays mounted and
  // doesn't lose focus/scroll position every time selection changes.
  const selectionKey = selection ? `${selection.type}:${selection.id}` : 'none';

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        borderLeft: '1px solid #e5e4e7',
        padding: '12px 14px',
        overflowY: 'auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#8a8a93',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 10,
        }}
      >
        Properties
      </div>
      <div key={selectionKey}>
        {selection === null && (
          <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5 }}>
            Select a node or edge on the canvas to edit it, or choose a kind from the palette to add one.
          </p>
        )}
        {selection?.type === 'node' && (
          <NodeProperties nodeId={selection.id} graph={graph} skinConfig={skinConfig} floorLayout={floorLayout} onDelete={onDelete} />
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
          <SketchProperties sketchId={selection.id} sketchLayer={sketchLayer} onDelete={onDelete} />
        )}
      </div>

      <div style={{ borderTop: '1px solid #e5e4e7', marginTop: 16, paddingTop: 4 }}>
        <div style={sectionTitleStyle}>Canvas & simulation</div>
        <CanvasSettingsSection
          gridSpacing={gridSpacing}
          onGridSpacingChange={onGridSpacingChange}
          tickIntervalMs={tickIntervalMs}
          onTickIntervalMsChange={onTickIntervalMsChange}
        />
      </div>
    </div>
  );
}

/** Global canvas/simulation controls — not tied to any node or edge
 * selection, so this section stays visible and doesn't remount when
 * selection changes (see the selectionKey comment above). */
function CanvasSettingsSection({
  gridSpacing,
  onGridSpacingChange,
  tickIntervalMs,
  onTickIntervalMsChange,
}: {
  gridSpacing: number;
  onGridSpacingChange: (spacing: number) => void;
  tickIntervalMs: number;
  onTickIntervalMsChange: (ms: number) => void;
}) {
  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle}>Grid spacing (world units)</label>
        <input
          type="number"
          min={4}
          step={4}
          value={gridSpacing}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v > 0) onGridSpacingChange(v);
          }}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Sim tick interval (ms)</label>
        <input
          type="number"
          min={10}
          step={10}
          value={tickIntervalMs}
          style={inputStyle}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v > 0) onTickIntervalMsChange(v);
          }}
        />
      </div>
    </>
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
  border: '1px solid #d8d7dd',
  background: '#f6f6f8',
  cursor: 'pointer',
};

function NodeProperties({
  nodeId,
  graph,
  skinConfig,
  floorLayout,
  onDelete,
}: {
  nodeId: string;
  graph: GraphModel;
  skinConfig: SkinConfig;
  floorLayout: FloorLayout;
  onDelete: () => void;
}) {
  const node = graph.getNode(nodeId);
  if (!node) return <p style={{ fontSize: 12, color: '#c0392b' }}>Node no longer exists.</p>;

  function patch(fields: Record<string, unknown>): void {
    graph.updateNodeConfig(nodeId, fields);
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize', marginBottom: 2 }}>{node.kind}</div>
      <div style={{ fontSize: 11, color: '#8a8a93', marginBottom: 4 }}>{node.id}</div>

      {node.kind === 'source' && <SourceFields node={node} onChange={patch} />}
      {node.kind === 'distributor' && <DistributorFields node={node} onChange={patch} />}
      {node.kind === 'merger' && (
        <p style={{ fontSize: 12, color: '#8a8a93' }}>
          Merger has nothing to configure — every arriving item forwards straight out its one output.
        </p>
      )}
      {node.kind === 'sorter' && <SorterFields node={node} onChange={patch} />}
      {node.kind === 'mixer' && <MixerFields node={node} onChange={patch} />}
      {node.kind === 'buffer' && <BufferFields node={node} onChange={patch} />}
      {node.kind === 'sink' && (
        <p style={{ fontSize: 12, color: '#8a8a93' }}>Sink has nothing to configure — it just consumes.</p>
      )}

      <SingleOutputSidePicker nodeId={nodeId} kind={node.kind} graph={graph} floorLayout={floorLayout} />

      <div style={sectionTitleStyle}>Z-order</div>
      <ZOrderButtons nodeId={nodeId} graph={graph} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Position</div>
      <LockToggle nodeId={nodeId} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: '#c0392b', borderColor: '#e3b0aa' }}
      >
        Delete node
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
                border: '1px solid ' + (active ? '#2563eb' : '#d8d7dd'),
                background: active ? '#2563eb' : '#f6f6f8',
                color: active ? '#fff' : '#3c3c43',
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

function SourceFields({ node, onChange }: { node: NodeDef; onChange: (fields: Record<string, unknown>) => void }) {
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
        <input
          type="text"
          value={itemType}
          style={inputStyle}
          onChange={(e) => {
            setItemType(e.target.value);
            onChange({ itemType: e.target.value });
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

function SorterFields({ node, onChange }: { node: NodeDef; onChange: (fields: Record<string, unknown>) => void }) {
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
            <input
              type="text"
              placeholder="item type"
              value={rule.itemType}
              style={{ ...inputStyle, flex: 2 }}
              onChange={(e) => {
                const next = rules.map((r, idx) => (idx === i ? { ...r, itemType: e.target.value } : r));
                commitRules(next);
              }}
            />
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

function MixerFields({ node, onChange }: { node: NodeDef; onChange: (fields: Record<string, unknown>) => void }) {
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
            <input
              type="text"
              placeholder="item type"
              value={row.itemType}
              style={{ ...inputStyle, flex: 2 }}
              onChange={(e) => {
                const next = rows.map((r, idx) => (idx === i ? { ...r, itemType: e.target.value } : r));
                commitRows(next);
              }}
            />
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
        <input
          type="text"
          value={outputType}
          style={inputStyle}
          onChange={(e) => {
            setOutputType(e.target.value);
            onChange({ outputType: e.target.value });
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
 * sketchLayer.ts) — no logic/skin fields to edit, just a note and a
 * delete button. */
function SketchProperties({
  sketchId,
  sketchLayer,
  onDelete,
}: {
  sketchId: string;
  sketchLayer: SketchLayer;
  onDelete: () => void;
}) {
  const sketch = sketchLayer.get(sketchId);
  if (!sketch) return <p style={{ fontSize: 12, color: '#c0392b' }}>Sketch no longer exists.</p>;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Sketch</div>
      <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5 }}>
        A planning guide only — no simulation meaning, not connected to any node. Replace it with a real path once
        the nodes it connects exist.
      </p>

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: '#c0392b', borderColor: '#e3b0aa' }}
      >
        Delete sketch
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
  if (!edge) return <p style={{ fontSize: 12, color: '#c0392b' }}>Edge no longer exists.</p>;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Edge</div>
      <div style={{ fontSize: 11, color: '#8a8a93', marginBottom: 4 }}>
        {edge.source} → {edge.target}
      </div>

      <div style={sectionTitleStyle}>Logic (design doc §5.4)</div>
      <EdgeLogicFields edge={edge} graph={graph} floorLayout={floorLayout} />

      <div style={sectionTitleStyle}>Path shape (design doc §5.1)</div>
      <PathShapeField edgeId={edgeId} floorLayout={floorLayout} />

      <div style={sectionTitleStyle}>Skin (design doc §5.2, §5.3)</div>
      <EdgeSkinFields edgeId={edgeId} skinConfig={skinConfig} />

      <div style={sectionTitleStyle}>Danger zone</div>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...smallButtonStyle, width: '100%', color: '#c0392b', borderColor: '#e3b0aa' }}
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
 * is the gentle bend paths have always rendered with. Restoring
 * "curve" uses curveBetween's own 0.15 cosmetic default rather than
 * remembering whatever custom bow a path had before — there's no UI
 * for arbitrary bow amounts yet, just the two named types Falcon
 * asked for. */
function PathShapeField({ edgeId, floorLayout }: { edgeId: string; floorLayout: FloorLayout }) {
  const [bow, setBow] = useState(floorLayout.getEdgeBow(edgeId));
  const pathType = bow === 0 ? 'linear' : 'curve';

  return (
    <div style={rowStyle}>
      <label style={labelStyle}>Path type</label>
      <select
        value={pathType}
        style={inputStyle}
        onChange={(e) => {
          const nextBow = e.target.value === 'linear' ? 0 : 0.15;
          setBow(nextBow);
          floorLayout.setEdgeBow(edgeId, nextBow);
        }}
      >
        <option value="linear">Linear (straight)</option>
        <option value="curve">Curve</option>
      </select>
    </div>
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

  const pathLength = floorLayout.getEdgeCurve(edge.id)?.totalLength ?? 0;
  const [speed, setSpeed] = useState(flowRate * pathLength);

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
            }
          }}
        />
      </div>
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
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#8a8a93', marginTop: -6, marginBottom: 10 }}>
        Speed is converted to flow rate using this path's current length —
        if you drag a connected node afterward, the path's length changes
        but flow rate doesn't auto-adjust, so re-enter speed to keep it pinned.
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
