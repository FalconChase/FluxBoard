import { useState, type CSSProperties } from 'react';
import { GraphModel } from '../core/GraphModel';
import type { EdgeDef, NodeDef } from '../core/types';
import type { SkinConfig } from '../skin/SkinConfig';
import type { EdgeStyle, ItemOrientationMode } from '../skin/pathSkin';
import type { Selection } from './selection';

interface PropertiesPanelProps {
  selection: Selection | null;
  graph: GraphModel;
  skinConfig: SkinConfig;
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
export function PropertiesPanel({ selection, graph, skinConfig }: PropertiesPanelProps) {
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
      {selection === null && (
        <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5 }}>
          Select a node or edge on the canvas to edit it, or choose a kind from the palette to add one.
        </p>
      )}
      {selection?.type === 'node' && <NodeProperties nodeId={selection.id} graph={graph} skinConfig={skinConfig} />}
      {selection?.type === 'edge' && <EdgeProperties edgeId={selection.id} graph={graph} skinConfig={skinConfig} />}
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
  border: '1px solid #d8d7dd',
  background: '#f6f6f8',
  cursor: 'pointer',
};

function NodeProperties({ nodeId, graph, skinConfig }: { nodeId: string; graph: GraphModel; skinConfig: SkinConfig }) {
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
      {node.kind === 'sorter' && <SorterFields node={node} onChange={patch} />}
      {node.kind === 'mixer' && <MixerFields node={node} onChange={patch} />}
      {node.kind === 'buffer' && <BufferFields node={node} onChange={patch} />}
      {node.kind === 'sink' && (
        <p style={{ fontSize: 12, color: '#8a8a93' }}>Sink has nothing to configure — it just consumes.</p>
      )}

      <div style={sectionTitleStyle}>Z-order</div>
      <ZOrderButtons nodeId={nodeId} graph={graph} skinConfig={skinConfig} />
    </div>
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

function EdgeProperties({ edgeId, graph, skinConfig }: { edgeId: string; graph: GraphModel; skinConfig: SkinConfig }) {
  const edge = graph.getEdge(edgeId);
  if (!edge) return <p style={{ fontSize: 12, color: '#c0392b' }}>Edge no longer exists.</p>;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Edge</div>
      <div style={{ fontSize: 11, color: '#8a8a93', marginBottom: 4 }}>
        {edge.source} → {edge.target}
      </div>

      <div style={sectionTitleStyle}>Logic (design doc §5.4)</div>
      <EdgeLogicFields edge={edge} graph={graph} />

      <div style={sectionTitleStyle}>Skin (design doc §5.2, §5.3)</div>
      <EdgeSkinFields edgeId={edgeId} skinConfig={skinConfig} />
    </div>
  );
}

function EdgeLogicFields({ edge, graph }: { edge: EdgeDef; graph: GraphModel }) {
  const [sourcePort, setSourcePort] = useState(edge.sourcePort);
  const [targetPort, setTargetPort] = useState(edge.targetPort);
  const [flowRate, setFlowRate] = useState(edge.flowRate);
  const [active, setActive] = useState(edge.active);

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
            graph.setEdgeFlowRate(edge.id, v);
          }}
        />
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
