import { useState, type CSSProperties } from 'react';
import type { ProjectMeta } from './persistence';
import { theme } from './theme';
import { InfoTooltip } from './InfoTooltip';

interface FileTabProps {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Projects list (Falcon, 2026-09-03: "the file tab ( create new
 * projects, manages, and contains the existing/saved projects) on the
 * top"). Lists every project the manifest knows about (persistence.ts),
 * newest-opened first; clicking a non-active one switches to it
 * (App.tsx flushes the current project's autosave first, so nothing
 * is lost). Rename/delete use plain `window.prompt`/`window.confirm`
 * — a real native dialog, not a mockup — since a whole custom modal
 * for two rarely-used actions wasn't worth building yet. Delete is
 * disabled for the currently active project (App.tsx never has to
 * handle "what replaces the open canvas mid-delete" as a result).
 *
 * Retheme (Falcon, 2026-09-04, ribbon port): dark panel to match the
 * approved mockup; the rename/delete pencil and trash emoji became
 * plain SVG glyphs so they render crisply at any zoom, same reasoning
 * as everywhere else emoji got replaced this pass.
 */
export function FileTab({ projects, activeProjectId, onSwitch, onCreate, onRename, onDelete }: FileTabProps) {
  const [pending, setPending] = useState(false);
  const sorted = [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        // Falcon, 2026-09-09: same nested-flex-scroll fix applied to
        // IconLibraryPanel (LeftPanel.tsx's other view) -- a long
        // enough project list would hit the identical "can't scroll,
        // bottom rows hidden" bug without these, it just hadn't shown
        // up here yet because project lists have stayed short so far.
        flex: 1,
        minHeight: 0,
        padding: '12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={sectionLabelStyle}>Projects</div>
        <InfoTooltip
          align="left"
          text="Each project autosaves on its own — switching flushes the current one first. Persists only inside the real desktop app (npm run tauri:dev), not a plain browser dev tab."
        />
      </div>
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
        <PlusIcon /> New project
      </button>

      {projects.length === 0 && <p style={{ fontSize: 11, color: theme.text3, padding: '4px' }}>Loading…</p>}

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
                <PencilIcon />
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
                <TrashIcon />
              </button>
            </div>
          </div>
        );
      })}

    </div>
  );
}

function PlusIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M6 7.5v4M10 7.5v4" />
      <path d="M3.5 4.5 4.2 13a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-8.5" />
    </svg>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: theme.text3,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '0 4px',
  marginBottom: 2,
};

const newButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 8px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'system-ui, sans-serif',
  borderRadius: 6,
  border: `1px solid ${theme.accent}`,
  background: theme.accentSoft,
  color: theme.accentStrong,
  cursor: 'pointer',
  textAlign: 'left',
};

function rowStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    border: '1px solid ' + (active ? theme.accent : theme.border),
    background: active ? theme.accentSoft : theme.bgPanel2,
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
    color: active ? theme.accentStrong : theme.text1,
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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  background: theme.bgElevated,
  color: theme.text2,
  cursor: 'pointer',
};
