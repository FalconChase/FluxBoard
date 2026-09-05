import { useState, type CSSProperties, type ReactNode } from 'react';
import { ObjectRegistry, type ObjectShape, type ObjectTypeDef, DEFAULT_OBJECT_TYPE_ID } from '../skin/ObjectRegistry';
import { darkenHex } from '../skin/canvasUtil';
import { theme } from './theme';

interface ObjectRegistryManagerProps {
  objectRegistry: ObjectRegistry;
  /** True if the given type id is still referenced by something in
   * the graph (a source's itemType, a sorter rule, a mixer recipe/
   * output) — App.tsx computes this against the live GraphModel, kept
   * out of this component and out of ObjectRegistry itself so the
   * skin layer never has to import core/logic (design doc §2). */
  isTypeInUse: (id: string) => boolean;
  onClose: () => void;
}

const SHAPES: ObjectShape[] = ['circle', 'square', 'triangle'];
const SWATCH_COLORS = ['#2ecc71', '#3d7fff', '#f2a93c', '#ff5d5d', '#8a5cf6', '#17b3a3', '#c026d3', '#6b7280'];

/**
 * OBJECTS tab content (FBP011, first-pass scope confirmed 2026-09-05):
 * create/edit/delete item TYPES — shape, size, color — that a
 * source's spawned type, a sorter rule, or a mixer recipe can then
 * reference by name. A modal overlay rather than a ribbon-strip
 * group: unlike node/path kinds, a type isn't "armed then placed" on
 * the canvas — it's a library entry referenced from elsewhere, so a
 * focused manager view fits better than squeezing a CRUD form into
 * the ribbon's 84px-tall group strip.
 *
 * Mutates `objectRegistry` directly (design doc §4.6: never a second
 * source of truth) — `forceRender` nudges this component to reread it
 * after each mutation, the same convention SingleOutputSidePicker
 * already uses for FloorLayout.
 */
export function ObjectRegistryManager({ objectRegistry, isTypeInUse, onClose }: ObjectRegistryManagerProps) {
  const [, forceRender] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const types = objectRegistry.list();

  function refresh(): void {
    forceRender((n) => n + 1);
  }

  function handleCreate(): void {
    const entry = objectRegistry.create({ name: 'New object', shape: 'circle', size: 7, color: '#3d7fff' });
    refresh();
    setEditingId(entry.id);
  }

  function handleDelete(id: string): void {
    if (id === DEFAULT_OBJECT_TYPE_ID || isTypeInUse(id)) return;
    objectRegistry.remove(id);
    if (editingId === id) setEditingId(null);
    refresh();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 480,
          maxHeight: '78vh',
          display: 'flex',
          flexDirection: 'column',
          background: theme.bgPanel,
          border: `1px solid ${theme.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.text1 }}>Objects registry</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={{ padding: '10px 16px', overflowY: 'auto', flex: 1 }}>
          <p style={{ fontSize: 11, color: theme.text3, lineHeight: 1.5, margin: '0 0 10px' }}>
            Item types travelling on paths — shape, size, and color. Reference one by name from a source's Item
            type, a sorter rule, or a mixer recipe/output.
          </p>
          {types.map((t) => (
            <ObjectTypeRow
              key={t.id}
              def={t}
              editing={editingId === t.id}
              locked={t.id === DEFAULT_OBJECT_TYPE_ID}
              inUse={isTypeInUse(t.id)}
              onEdit={() => setEditingId(editingId === t.id ? null : t.id)}
              onDelete={() => handleDelete(t.id)}
              onChange={(fields) => {
                objectRegistry.update(t.id, fields);
                refresh();
              }}
            />
          ))}
          <button type="button" onClick={handleCreate} style={{ ...addButtonStyle, marginTop: 6 }}>
            + New object type
          </button>
        </div>
      </div>
    </div>
  );
}

function ObjectTypeRow({
  def,
  editing,
  locked,
  inUse,
  onEdit,
  onDelete,
  onChange,
}: {
  def: ObjectTypeDef;
  editing: boolean;
  locked: boolean;
  inUse: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onChange: (fields: Partial<Omit<ObjectTypeDef, 'id'>>) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${theme.borderSoft}`,
        borderRadius: 8,
        marginBottom: 8,
        background: theme.bgPanel2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
        <ShapePreview shape={def.shape} color={def.color} size={def.size} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {def.name}
          </div>
          <div style={{ fontSize: 10, color: theme.text3 }}>
            id: {def.id} · {def.shape} · size {def.size}
          </div>
        </div>
        <button type="button" onClick={onEdit} style={smallButtonStyle}>
          {editing ? 'Done' : 'Edit'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={locked || inUse}
          title={locked ? "Can't delete the built-in default type" : inUse ? 'Still referenced by something in this project' : 'Delete'}
          style={{ ...smallButtonStyle, color: locked || inUse ? theme.text3 : theme.danger, cursor: locked || inUse ? 'not-allowed' : 'pointer', opacity: locked || inUse ? 0.5 : 1 }}
        >
          Delete
        </button>
      </div>

      {editing && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={fieldLabelStyle}>
            Name
            <input
              type="text"
              value={def.name}
              onChange={(e) => onChange({ name: e.target.value })}
              style={fieldInputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            Shape
            <div style={{ display: 'flex', gap: 6 }}>
              {SHAPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ shape: s })}
                  title={s}
                  style={{
                    ...smallButtonStyle,
                    flex: 1,
                    borderColor: def.shape === s ? theme.accent : theme.borderStrong,
                    background: def.shape === s ? theme.accentSoft : theme.bgPanel2,
                    textTransform: 'capitalize',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </label>

          <label style={fieldLabelStyle}>
            Size
            <input
              type="number"
              min={2}
              max={40}
              value={def.size}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) onChange({ size: v });
              }}
              style={fieldInputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            Color
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="color"
                value={def.color}
                onChange={(e) => onChange({ color: e.target.value })}
                style={{ width: 30, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              />
              {SWATCH_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => onChange({ color: c })}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: def.color === c ? `2px solid ${theme.text1}` : `1px solid ${theme.borderStrong}`,
                    background: c,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

function ShapePreview({ shape, color, size }: { shape: ObjectShape; color: string; size: number }) {
  const box = 28;
  const scale = Math.min(1, (box * 0.4) / Math.max(4, size));
  const r = size * scale;
  const stroke = darkenHex(color, 0.32);
  let inner: ReactNode;
  if (shape === 'square') {
    const half = r * 0.86;
    inner = <rect x={-half} y={-half} width={half * 2} height={half * 2} fill={color} stroke={stroke} strokeWidth={1.4} />;
  } else if (shape === 'triangle') {
    inner = (
      <polygon
        points={`0,${-r} ${r * 0.87},${r * 0.62} ${-r * 0.87},${r * 0.62}`}
        fill={color}
        stroke={stroke}
        strokeWidth={1.4}
      />
    );
  } else {
    inner = <circle cx={0} cy={0} r={r} fill={color} stroke={stroke} strokeWidth={1.4} />;
  }
  return (
    <svg width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} style={{ flexShrink: 0 }}>
      {inner}
    </svg>
  );
}

const closeButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: theme.text2,
  cursor: 'pointer',
  fontSize: 13,
};

const smallButtonStyle: CSSProperties = {
  fontSize: 11,
  padding: '5px 8px',
  borderRadius: 5,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.bgPanel2,
  color: theme.text1,
  cursor: 'pointer',
};

const addButtonStyle: CSSProperties = {
  width: '100%',
  fontSize: 12,
  fontWeight: 600,
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px dashed ${theme.borderStrong}`,
  background: 'transparent',
  color: theme.accentStrong,
  cursor: 'pointer',
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: theme.text2,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const fieldInputStyle: CSSProperties = {
  fontSize: 12,
  padding: '5px 7px',
  borderRadius: 5,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.bgPanel,
  color: theme.text1,
  boxSizing: 'border-box',
};
