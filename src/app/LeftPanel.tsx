import type { ProjectMeta } from './persistence';
import { FileTab } from './FileTab';
import { IconLibraryPanel } from './IconLibraryPanel';
import { NodesOverflowPanel, PathsOverflowPanel, ModifyOverflowPanel, type QuickSelectKind } from './Ribbon';
import type { NodeKind } from '../core/types';
import type { EdgeStyle } from '../skin/pathSkin';
import type { SketchStyle } from './FluxCanvas';
import { theme } from './theme';

interface LeftPanelProps {
  /** Projects (Falcon, 2026-09-03: "the file tab... on the top"; then
   * 2026-09-04, approving the ribbon-shell mockup: "MODIFY group...
   * ribbon = quick actions, left rail = just Projects now" -- NODES/
   * PATHS/OBJECTS moved fully into the Ribbon's HOME tab, so this
   * rail's only remaining job is project switching). State and the
   * actual disk I/O both live in App.tsx (persistence.ts); this panel
   * is purely a view over it, same as before. */
  projects: ProjectMeta[];
  activeProjectId: string | null;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  /** Falcon, 2026-09-09 ("i want the icons to be in the left side
   * pannel never to collapse the ribbon in order to not scroll
   * sideward"): this rail now swaps between the Projects list and the
   * full built-in icon library (IconLibraryPanel) -- 'icons' only
   * when the INSERT tab's "More" tile was clicked (App.tsx owns
   * `leftPanelView` and resets it back to 'projects' on tab change). */
  /** Falcon, 2026-09-09 ("the same from nodes sections, paths and
   * modify... for uniformity"): each HOME-tab group's own "More" tile
   * now swaps this rail to its own full-list view, same mechanism the
   * Icons view already established. */
  view: 'projects' | 'icons' | 'nodes' | 'paths' | 'modify';
  onBackToProjects: () => void;

  armedKind: NodeKind | null;
  onArmKind: (kind: NodeKind | null) => void;
  armedEdgeStyle: EdgeStyle | null;
  onArmEdgeStyle: (style: EdgeStyle | null) => void;
  sketchArmed: boolean;
  onArmSketch: (armed: boolean) => void;
  sketchStyle: SketchStyle;
  onSketchStyleChange: (style: SketchStyle) => void;
  canDelete: boolean;
  onDeleteSelection: () => void;
  multiSelectArmed: boolean;
  onArmMultiSelect: (armed: boolean) => void;
  onQuickSelect: (kind: QuickSelectKind) => void;
  canDuplicate: boolean;
  onDuplicateSelection: () => void;
  moveArmed: boolean;
  onArmMove: (armed: boolean) => void;
  rotateArmed: boolean;
  onArmRotate: (armed: boolean) => void;
  canFlip: boolean;
  onFlipSelection: (axis: 'horizontal' | 'vertical') => void;
  canGroup: boolean;
  onGroupSelection: () => void;
  canUngroup: boolean;
  onUngroupSelection: () => void;
}

/**
 * Left-docked rail. Used to be a 4-way NODES/PATHS/OBJECTS/FILE tab
 * switcher (SES026); the ribbon port (Falcon, 2026-09-04) absorbed
 * NODES/PATHS/OBJECTS into the Ribbon's HOME tab, leaving just the
 * Projects list -- until 2026-09-09, when Falcon asked for the full
 * built-in icon set to live here too (rather than the ribbon's INSERT
 * tab needing horizontal scroll), reachable via a "More" tile there.
 * `view` picks which of the two shows; App.tsx owns that state.
 */
export function LeftPanel({
  projects,
  activeProjectId,
  onSwitchProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  view,
  onBackToProjects,
  armedKind,
  onArmKind,
  armedEdgeStyle,
  onArmEdgeStyle,
  sketchArmed,
  onArmSketch,
  sketchStyle,
  onSketchStyleChange,
  canDelete,
  onDeleteSelection,
  multiSelectArmed,
  onArmMultiSelect,
  onQuickSelect,
  canDuplicate,
  onDuplicateSelection,
  moveArmed,
  onArmMove,
  rotateArmed,
  onArmRotate,
  canFlip,
  onFlipSelection,
  canGroup,
  onGroupSelection,
  canUngroup,
  onUngroupSelection,
}: LeftPanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        // Falcon, 2026-09-09 ("i cant scroll the options panel" /
        // "the buttom was truncated"): without minHeight: 0 here, a
        // flex item's default min-height is its content's own height
        // ("auto"), not the height this panel was actually given --
        // so a long child (IconLibraryPanel's 19 rows) just overflows
        // past this panel's real bottom edge instead of being clipped
        // and scrolled internally. Classic flexbox nested-scroll gotcha.
        minHeight: 0,
        background: theme.bgPanel,
        borderRight: `1px solid ${theme.border}`,
      }}
    >
      {view === 'icons' && <IconLibraryPanel onBack={onBackToProjects} />}
      {view === 'nodes' && <NodesOverflowPanel armedKind={armedKind} onArmKind={onArmKind} onBack={onBackToProjects} />}
      {view === 'paths' && (
        <PathsOverflowPanel
          armedEdgeStyle={armedEdgeStyle}
          onArmEdgeStyle={onArmEdgeStyle}
          sketchArmed={sketchArmed}
          onArmSketch={onArmSketch}
          sketchStyle={sketchStyle}
          onSketchStyleChange={onSketchStyleChange}
          onBack={onBackToProjects}
        />
      )}
      {view === 'modify' && (
        <ModifyOverflowPanel
          canDelete={canDelete}
          onDeleteSelection={onDeleteSelection}
          multiSelectArmed={multiSelectArmed}
          onArmMultiSelect={onArmMultiSelect}
          onQuickSelect={onQuickSelect}
          canDuplicate={canDuplicate}
          onDuplicateSelection={onDuplicateSelection}
          moveArmed={moveArmed}
          onArmMove={onArmMove}
          rotateArmed={rotateArmed}
          onArmRotate={onArmRotate}
          canFlip={canFlip}
          onFlipSelection={onFlipSelection}
          canGroup={canGroup}
          onGroupSelection={onGroupSelection}
          canUngroup={canUngroup}
          onUngroupSelection={onUngroupSelection}
          onBack={onBackToProjects}
        />
      )}
      {view === 'projects' && (
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
  );
}
