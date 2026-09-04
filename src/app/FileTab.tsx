import { useState, type CSSProperties } from 'react';
import type { ProjectMeta } from './persistence';

interface FileTabProps {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * FILE tab (Falcon, 2026-09-03: "the file tab ( create new projects,
 * manages, and contains the existing/saved projects) on the top").
 * Lists every project the manifest knows about (persistence.ts),
 * newest-opened first; clicking a non-active one switches to it
 * (App.tsx flushes the current project's autosave first, so nothing
 * is lost). Rename/delete use plain `window.prompt`/`window.confirm`
 * — a real native dialog, not a mockup — since a whole custom modal
 * for two rarely-used actions wasn't worth building yet. Delete is
 * disabled for the currently active project (App.tsx never has to
 * handle "what replaces the open canvas mid-delete" as a result).
 */
export function FileTab({ projects, activeProjectId, onSwitch, onCreate, onRename, onDelete }: FileTabProps) {
  const [pending, setPending] = useState(false);
  const sorted = [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  return (
    <div
      style={{
        width: 180,
        flexShrink: 0,
        borderRight: '1px solid #e5e4e7',
        padding: '10px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflowY: 'auto',
      }}
    >
      <div style={sectionLabelStyle}>Projects</div>
      <button
        type="button"
        onClick={() => {
          const name = window.prompt('New project name', 'Untitled Project');
          if (!name || !name.trim() || pending) return;
          setPending(true);
          try {
            onCreate(name.trim());
          } finally {
            setPending(false);
          }
        }}
        style={newButtonStyle}
      >
        + New project
      </button>

      {projects.length === 0 && <p style={{ fontSize: 11, color: '#8a8a93', padding: '4px' }}>Loading…</p>}

      {sorted.map((p) => {
        const active = p.id === activeProjectId;
        return (
          <div key={p.id} style={rowStyle(active)}>
            <button
              type="button"
              onClick={() => !active && onSwitch(p.id)}
              style={rowNameButtonStyle(active)}
              title={active ? 'Current project' : `Switch to "${p.name}"`}
            >
              {p.name}
            </button>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt('Rename project', p.name);
                  if (name && name.trim()) onRename(p.id, name.trim());
                }}
                style={iconButtonStyle}
                title="Rename"
              >
                ✎
              </button>
              <button
                type="button"
                disabled={active}
                onClick={() => {
                  if (window.confirm(`Delete "${p.name}"? This can't be undone.`)) onDelete(p.id);
                }}
                style={{ ...iconButtonStyle, opacity: active ? 0.3 : 1, cursor: active ? 'not-allowed' : 'pointer' }}
                title={active ? 'Switch away from this project first to delete it' : 'Delete'}
              >
                🗑
              </button>
            </div>
          </div>
        );
      })}

      <p style={{ fontSize: 10, color: '#8a8a93', lineHeight: 1.4, marginTop: 8, padding: '0 2px' }}>
        Each project autosaves on its own — switching flushes the current one first. Persists only inside the real
        desktop app (npm run tauri:dev), not a plain browser dev tab.
      </p>
    </div>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#8a8a93',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '0 4px',
  marginBottom: 2,
};

const newButtonStyle: CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'system-ui, sans-serif',
  borderRadius: 6,
  border: '1px solid #2563eb',
  background: '#eaf1ff',
  color: '#2563eb',
  cursor: 'pointer',
  textAlign: 'left',
};

function rowStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    border: '1px solid ' + (active ? '#2563eb' : '#e5e4e7'),
    background: active ? '#eaf1ff' : '#fafafb',
    padding: '2px 2px 2px 6px',
  };
}

function rowNameButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    padding: '5px 2px',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    color: active ? '#2563eb' : '#3c3c43',
    border: 'none',
    background: 'transparent',
    cursor: active ? 'default' : 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

const iconButtonStyle: CSSProperties = {
  width: 20,
  height: 20,
  fontSize: 11,
  lineHeight: '20px',
  padding: 0,
  border: '1px solid #e5e4e7',
  borderRadius: 4,
  background: '#fff',
  color: '#6b6b73',
  cursor: 'pointer',
};
