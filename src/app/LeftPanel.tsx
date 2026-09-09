import type { ProjectMeta } from './persistence';
import { FileTab } from './FileTab';
import { IconLibraryPanel } from './IconLibraryPanel';
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
  view: 'projects' | 'icons';
  onBackToProjects: () => void;
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
}: LeftPanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        background: theme.bgPanel,
        borderRight: `1px solid ${theme.border}`,
      }}
    >
      {view === 'icons' ? (
        <IconLibraryPanel onBack={onBackToProjects} />
      ) : (
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
