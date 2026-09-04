import type { CSSProperties } from 'react';
import type { NodeKind } from '../core/types';
import type { EdgeStyle } from '../skin/pathSkin';
import { NodePalette } from './NodePalette';
import { PathPalette } from './PathPalette';
import { FileTab } from './FileTab';
import type { ProjectMeta } from './persistence';

export type LeftPanelTab = 'nodes' | 'paths' | 'objects' | 'file';

interface LeftPanelProps {
  activeTab: LeftPanelTab;
  onTabChange: (tab: LeftPanelTab) => void;

  armedKind: NodeKind | null;
  onArmKind: (kind: NodeKind | null) => void;

  armedEdgeStyle: EdgeStyle | null;
  onArmEdgeStyle: (style: EdgeStyle | null) => void;

  sketchArmed: boolean;
  onArmSketch: (armed: boolean) => void;

  /** FILE tab (Falcon, 2026-09-03: "the file tab... on the top") —
   * create/manage/switch between multiple saved projects. State and
   * the actual disk I/O both live in App.tsx (persistence.ts); this
   * panel is purely a view over it, same pattern as everything else
   * here. */
  projects: ProjectMeta[];
  activeProjectId: string | null;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
}

const TABS: { tab: LeftPanelTab; label: string }[] = [
  { tab: 'nodes', label: 'Nodes' },
  { tab: 'paths', label: 'Paths' },
  { tab: 'objects', label: 'Objects' },
  { tab: 'file', label: 'File' },
];

/**
 * Left-docked chrome from Falcon's wireframe (claude/build-log.md):
 * the NODES / PATHS / OBJECTS / FILE row are tabs for THIS panel's
 * content, not four separate palettes on screen at once — clicking a
 * tab swaps what's shown below it. NODES shows the existing
 * NodePalette; PATHS shows the new PathPalette (arm an edge style,
 * click an existing edge to apply it); OBJECTS is a placeholder —
 * Falcon explicitly said the item-type registry it should hold still
 * needs more spec before it's buildable; FILE shows the project list
 * (create/switch/rename/delete — persistence.ts's multi-project
 * layer).
 */
export function LeftPanel({
  activeTab,
  onTabChange,
  armedKind,
  onArmKind,
  armedEdgeStyle,
  onArmEdgeStyle,
  sketchArmed,
  onArmSketch,
  projects,
  activeProjectId,
  onSwitchProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
}: LeftPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100%' }}>
      <div style={{ display: 'flex', borderRight: '1px solid #e5e4e7', flexShrink: 0 }}>
        {TABS.map(({ tab, label }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            style={tabButtonStyle(activeTab === tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {/* flex:1/minHeight:0 so whichever palette is active fills the
          remaining height below the tab row — each palette component
          was originally written to stretch as a direct row-flex child
          (default cross-axis stretch); nested one level deeper inside
          this column container, that has to be explicit instead. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {activeTab === 'nodes' && <NodePalette armedKind={armedKind} onArm={onArmKind} />}
        {activeTab === 'paths' && (
          <PathPalette
            armedStyle={armedEdgeStyle}
            onArm={onArmEdgeStyle}
            sketchArmed={sketchArmed}
            onArmSketch={onArmSketch}
          />
        )}
        {activeTab === 'objects' && <ObjectsComingSoon />}
        {activeTab === 'file' && (
          <FileTab
            projects={projects}
            activeProjectId={activeProjectId}
            onSwitch={onSwitchProject}
            onCreate={onCreateProject}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
          />
        )}
      </div>
    </div>
  );
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '8px 4px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    background: active ? '#eaf1ff' : '#fafafb',
    color: active ? '#2563eb' : '#8a8a93',
    cursor: 'pointer',
  };
}

function ObjectsComingSoon() {
  return (
    <div style={{ width: 116, flexShrink: 0, borderRight: '1px solid #e5e4e7', padding: '10px 8px' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#8a8a93',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          padding: '0 4px',
          marginBottom: 8,
        }}
      >
        Objects
      </div>
      <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5, padding: '0 4px' }}>
        Coming soon — an object-type registry (shape, size, starting with the built-in round default) for the items
        that travel on paths. Not built yet.
      </p>
    </div>
  );
}
