import { createSignal, Show } from 'solid-js';
import { Files, GitBranch, X } from 'lucide-solid';
import {
  IconButton,
  WorkbenchPanelChrome,
  WorkbenchRail,
  WorkbenchRailButton,
  WorkbenchShell,
  workbenchEmbeddedPanelClass,
} from '@peri/ui';
import { DEMO_STAGED, DEMO_UNTRACKED, DEMO_WORKING } from './git-demo-data';
import { SourceControlLayout } from './SourceControlLayout';
import { WorkbenchExplorerLayout } from './WorkbenchExplorerLayout';
import { WorkbenchPreviewLayout } from './WorkbenchPreviewLayout';
import { DEFAULT_WORKBENCH_PREVIEW, type WorkbenchPreview } from './workbench-preview-data';

type WorkbenchView = 'explorer' | 'scm';

function panelTitle(view: WorkbenchView) {
  return view === 'explorer' ? 'Explorer' : 'Source Control';
}

/** Tier 4 · Workbench：左侧预览 + 右侧 Explorer / SCM 浮层与 rail。 */
export function ResourceWorkbenchLayout() {
  const [view, setView] = createSignal<WorkbenchView>('explorer');
  const [preview, setPreview] = createSignal<WorkbenchPreview>(DEFAULT_WORKBENCH_PREVIEW);
  const scmCount = () => DEMO_STAGED.length + DEMO_WORKING.length + DEMO_UNTRACKED.length;

  const openFilePreview = (path: string) => setPreview({ kind: 'file', path });
  const openDiffPreview = (path: string) => setPreview({ kind: 'diff', path });

  return (
    <div
      class="flex h-(--workbench-frame-height) w-full overflow-hidden rounded-lg border border-border-subtle bg-surface-canvas"
      aria-label="Resource workbench"
    >
      <section class="min-w-0 flex-1 overflow-hidden" aria-label="File preview">
        <WorkbenchPreviewLayout preview={preview()} />
      </section>

      <WorkbenchShell
        class="flex-row-reverse shrink-0 border-l border-border-subtle"
        rail={(
          <WorkbenchRail class="border-l border-border-subtle">
            <WorkbenchRailButton
              label="Explorer"
              layout="catalog"
              indicatorSide="right"
              active={view() === 'explorer'}
              onClick={() => setView('explorer')}
            >
              <Files size={17} strokeWidth={1.7} />
            </WorkbenchRailButton>
            <WorkbenchRailButton
              label="Source Control"
              layout="catalog"
              indicatorSide="right"
              badge={scmCount()}
              active={view() === 'scm'}
              onClick={() => setView('scm')}
            >
              <GitBranch size={17} strokeWidth={1.7} />
            </WorkbenchRailButton>
          </WorkbenchRail>
        )}
      >
        <div class={workbenchEmbeddedPanelClass}>
          <WorkbenchPanelChrome
            title={panelTitle(view())}
            actions={
              <IconButton size="sm" label="Close panel" class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary">
                <X size={14} strokeWidth={1.8} />
              </IconButton>
            }
          >
            <Show when={view() === 'explorer'}>
              <WorkbenchExplorerLayout
                selectedPath={preview().kind === 'file' ? preview().path : ''}
                onSelectPath={openFilePreview}
              />
            </Show>
            <Show when={view() === 'scm'}>
              <SourceControlLayout embedded onPreviewPath={openDiffPreview} />
            </Show>
          </WorkbenchPanelChrome>
        </div>
      </WorkbenchShell>
    </div>
  );
}
