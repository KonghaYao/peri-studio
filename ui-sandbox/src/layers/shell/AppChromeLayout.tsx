import {
  Activity,
  BarChart3,
  Database,
  Gauge,
  KeyRound,
  Layers,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-solid';
import { createSignal, onMount } from 'solid-js';
import {
  Button,
  CommandPaletteShell,
  PageHeaderShell,
  ShortcutsDialogShell,
  bindCommandPaletteHotkey,
  bindShortcutsHelpHotkey,
  type CommandPaletteItem,
  type ShortcutEntry,
} from '@peri/ui';

const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['⌘', 'K'], label: 'Open command palette' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['Esc'], label: 'Close dialog' },
];

const PALETTE_ITEMS: CommandPaletteItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    hint: 'Overview',
    icon: <Gauge size={14} />,
    keywords: 'home overview metrics',
    onSelect: () => undefined,
  },
  {
    id: 'traces',
    label: 'Traces',
    hint: 'List',
    icon: <Activity size={14} />,
    keywords: 'telemetry spans',
    onSelect: () => undefined,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    icon: <Workflow size={14} />,
    keywords: 'conversation runs',
    onSelect: () => undefined,
  },
  {
    id: 'observations',
    label: 'Observations',
    icon: <Layers size={14} />,
    keywords: 'spans events tree',
    onSelect: () => undefined,
  },
  {
    id: 'scores',
    label: 'Scores',
    icon: <BarChart3 size={14} />,
    keywords: 'evaluations ratings',
    onSelect: () => undefined,
  },
  {
    id: 'datasets',
    label: 'Datasets',
    icon: <Database size={14} />,
    keywords: 'eval data',
    onSelect: () => undefined,
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: <ScrollText size={14} />,
    keywords: 'templates versions',
    onSelect: () => undefined,
  },
  {
    id: 'users',
    label: 'Users',
    icon: <Users size={14} />,
    keywords: 'members access',
    onSelect: () => undefined,
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    icon: <KeyRound size={14} />,
    keywords: 'tokens credentials',
    onSelect: () => undefined,
  },
  {
    id: 'playground',
    label: 'Playground',
    icon: <Sparkles size={14} />,
    keywords: 'experiment sandbox',
    onSelect: () => undefined,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings size={14} />,
    keywords: 'preferences configuration',
    onSelect: () => undefined,
  },
  {
    id: 'billing',
    label: 'Billing',
    hint: 'Coming soon',
    disabled: true,
    keywords: 'plans invoices',
    onSelect: () => undefined,
  },
];

/** T4 · peri-fuse 风格 app chrome：PageHeader + Command palette + Shortcuts。 */
export function AppChromeLayout() {
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);

  onMount(() => {
    const cleanPalette = bindCommandPaletteHotkey(() => setPaletteOpen((open) => !open));
    const cleanShortcuts = bindShortcutsHelpHotkey(() => setShortcutsOpen(true));
    return () => {
      cleanPalette();
      cleanShortcuts();
    };
  });

  return (
    <div class="overflow-hidden rounded-8 border border-border-subtle bg-surface">
      <PageHeaderShell
        title="Traces"
        description="Langfuse-compatible telemetry"
        actions={(
          <>
            <Button size="sm" variant="secondary" onClick={() => setPaletteOpen(true)}>
              Command palette
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShortcutsOpen(true)}>
              Shortcuts
            </Button>
          </>
        )}
      />
      <div class="space-y-8 p-24 text-12 text-content-muted">
        <p>
          Press <kbd class="rounded-4 border border-border-subtle px-6 py-2 font-mono text-11">⌘K</kbd>
          or use the button to open the palette. Press <kbd class="rounded-4 border border-border-subtle px-6 py-2 font-mono text-11">?</kbd>
          for shortcuts.
        </p>
        <p>
          Demo: 12 commands including a disabled item; type <span class="font-mono text-content-secondary">billing</span>
          to see a disabled row, or <span class="font-mono text-content-secondary">zzzzz</span> for an empty filter.
        </p>
      </div>

      <CommandPaletteShell
        open={paletteOpen()}
        onOpenChange={setPaletteOpen}
        emptyMessage="No matching commands. Try a different search."
        items={PALETTE_ITEMS}
      />

      <ShortcutsDialogShell
        open={shortcutsOpen()}
        onOpenChange={setShortcutsOpen}
        shortcuts={SHORTCUTS}
      />
    </div>
  );
}
