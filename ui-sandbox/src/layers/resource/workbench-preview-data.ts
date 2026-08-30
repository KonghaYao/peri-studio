export type WorkbenchPreview =
  | { kind: 'file'; path: string }
  | { kind: 'diff'; path: string };

export type PreviewLine = { kind: 'plain' | 'add' | 'del'; text: string };

const COMPOSER_TSX = [
  'import { ComposerLayout } from \'./ComposerLayout\';',
  '',
  'export function Composer() {',
  '  return (',
  '    <section aria-label="Composer">',
  '      <ComposerLayout />',
  '    </section>',
  '  );',
  '}',
];

const STATUS_AREA_TSX = [
  'export function StatusAreaLayout() {',
  '  return (',
  '    <aside class="flex flex-col" aria-label="Status">',
  '      <StatusTabs />',
  '    </aside>',
  '  );',
  '}',
];

const FILE_SAMPLES: Record<string, string[]> = {
  'src/web/Composer.tsx': COMPOSER_TSX,
  'src/web/StatusArea.tsx': STATUS_AREA_TSX,
};

const DIFF_SAMPLES: Record<string, PreviewLine[]> = {
  'server/src/control/resource_service.rs': [
    { kind: 'del', text: '- pub async fn load_repo(id: &str) -> Repo {' },
    { kind: 'add', text: '+ pub async fn load_repository(id: &str) -> Repo {' },
    { kind: 'plain', text: '    let snapshot = store.read(id)?;' },
  ],
  'web/src/widgets/resource/SourceControlPanel.tsx': [
    { kind: 'add', text: '+ export function openGitDiffPreview(repoId: string) {' },
    { kind: 'add', text: '+   return requestDiff(payload);' },
    { kind: 'del', text: '- export function openDiff() {' },
    { kind: 'plain', text: '  // unified diff projection' },
  ],
  'docs/design/remote-fs-git-protocol.md': [
    { kind: 'add', text: '+ ## Git graph preview surface' },
    { kind: 'plain', text: '  Remote FS exposes read-only file trees.' },
  ],
  'web/src/panel/lib/resource-view.ts': [
    { kind: 'add', text: '+ export type ResourcePreviewOrigin = {' },
    { kind: 'add', text: '+   view: \'explorer\' | \'scm\';' },
    { kind: 'add', text: '+   key: string;' },
    { kind: 'add', text: '+ };' },
  ],
};

export const DEFAULT_WORKBENCH_PREVIEW: WorkbenchPreview = {
  kind: 'file',
  path: 'src/web/Composer.tsx',
};

export function resolveWorkbenchPreview(preview: WorkbenchPreview | null): {
  path: string;
  mode: 'text' | 'diff';
  lines: PreviewLine[];
} | null {
  if (!preview) return null;

  if (preview.kind === 'file') {
    const sample = FILE_SAMPLES[preview.path];
    return {
      path: preview.path,
      mode: 'text',
      lines: sample?.map((text) => ({ kind: 'plain', text })) ?? [{ kind: 'plain', text: '// No preview available in sandbox demo.' }],
    };
  }

  return {
    path: preview.path,
    mode: 'diff',
    lines: DIFF_SAMPLES[preview.path] ?? [
      { kind: 'add', text: '+ // sandbox diff preview' },
      { kind: 'plain', text: '  // select a changed file in Source Control' },
    ],
  };
}
