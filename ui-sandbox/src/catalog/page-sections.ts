export type SandboxRoute =
  | 'tokens'
  | 'components'
  | 'components-forms'
  | 'components-overlays'
  | 'components-chat'
  | 'components-ai'
  | 'components-code'
  | 'blocks'
  | 'layers';

/** @deprecated 旧路由 #/components2，解析时重定向到 components-forms */
export const LEGACY_COMPONENTS2_ROUTE = 'components2';

export const SANDBOX_ROUTES: SandboxRoute[] = [
  'tokens',
  'components',
  'components-forms',
  'components-overlays',
  'components-chat',
  'components-ai',
  'components-code',
  'blocks',
  'layers',
];

export const ROUTE_META: Record<SandboxRoute, { tier: string; label: string }> = {
  tokens: { tier: 'T1', label: 'Tokens' },
  components: { tier: 'T2', label: 'Core' },
  'components-forms': { tier: 'T2', label: 'Forms' },
  'components-overlays': { tier: 'T2', label: 'Overlays' },
  'components-chat': { tier: 'T2', label: 'Chat' },
  'components-ai': { tier: 'T2', label: 'AI' },
  'components-code': { tier: 'T2', label: 'Code' },
  blocks: { tier: 'T3', label: 'Blocks' },
  layers: { tier: 'T4', label: 'Layers' },
};

export type CatalogItemStatus = 'not-implemented';

export type CatalogItem = {
  id: string;
  label: string;
  /** Catalog 占位：无 T2 demo，仅保留导航与说明。 */
  status?: CatalogItemStatus;
};
export type CatalogGroup = { title?: string; items: CatalogItem[] };

export const PAGE_CATALOG: Record<SandboxRoute, CatalogGroup[]> = {
  tokens: [
    {
      items: [
        { id: 'palette', label: 'Color palettes' },
        { id: 'semantic', label: 'Semantic colors' },
        { id: 'spacing', label: 'Spacing' },
        { id: 'radius', label: 'Radius' },
        { id: 'typography', label: 'Typography' },
        { id: 'shell', label: 'Shell & header' },
        { id: 'elevation', label: 'Elevation & motion' },
        { id: 'component-tokens', label: 'Component tokens' },
      ],
    },
  ],
  components: [
    {
      items: [
        { id: 'button', label: 'Button' },
        { id: 'icon-button', label: 'IconButton' },
        { id: 'button-group', label: 'ButtonGroup' },
        { id: 'input', label: 'Input & Textarea' },
        { id: 'select', label: 'Select & forms' },
        { id: 'badge', label: 'Badge & Status' },
        { id: 'tabs', label: 'Tabs' },
        { id: 'dialog', label: 'Dialog & menu' },
        { id: 'inline-notice', label: 'InlineNotice' },
        { id: 'spinner', label: 'Spinner & empty' },
      ],
    },
  ],
  'components-forms': [
    {
      items: [
        { id: 'switch', label: 'Switch & label' },
        { id: 'input-group', label: 'Input group' },
        { id: 'combobox', label: 'Combobox & command' },
        { id: 'typography', label: 'Typography & select' },
        { id: 'resizable', label: 'Resizable & OTP' },
        { id: 'calendar', label: 'Calendar' },
        { id: 'date-picker', label: 'Date picker' },
        { id: 'form', label: 'Form' },
        { id: 'field', label: 'Field' },
        { id: 'data-table', label: 'Data table' },
        { id: 'questionnaire', label: 'Questionnaire' },
      ],
    },
  ],
  'components-overlays': [
    {
      items: [
        { id: 'progress', label: 'Progress & slider' },
        { id: 'card', label: 'Card & alert' },
        { id: 'accordion', label: 'Accordion & toggle' },
        { id: 'table', label: 'Table & overlay' },
        { id: 'breadcrumb', label: 'Breadcrumb & pagination' },
        { id: 'overlay', label: 'Alert dialog & sheet' },
        { id: 'menus', label: 'Context & hover' },
        { id: 'menubar', label: 'Menubar & nav' },
        { id: 'carousel', label: 'Carousel' },
        { id: 'item', label: 'Item' },
        { id: 'empty', label: 'Empty' },
        { id: 'drawer', label: 'Drawer' },
        { id: 'sidebar', label: 'Sidebar', status: 'not-implemented' },
        { id: 'direction', label: 'Direction' },
      ],
    },
  ],
  'components-chat': [
    {
      items: [
        { id: 'conversation', label: 'Conversation' },
        { id: 'message', label: 'Message branches' },
      ],
    },
  ],
  'components-ai': [
    {
      items: [
        { id: 'suggestion', label: 'Suggestion' },
        { id: 'sources', label: 'Sources' },
        { id: 'citation', label: 'Inline citation' },
        { id: 'plan', label: 'Plan' },
        { id: 'task', label: 'Tool activity' },
        { id: 'confirmation', label: 'Decision card' },
        { id: 'queue', label: 'Queue' },
        { id: 'snippet', label: 'Snippet' },
        { id: 'markdown', label: 'Markdown' },
      ],
    },
  ],
  'components-code': [
    {
      items: [
        { id: 'code-block-default', label: 'Default' },
        { id: 'code-block-composable', label: 'Composable header' },
        { id: 'code-block-highlight', label: 'Syntax highlighting' },
        { id: 'code-block-line-numbers', label: 'Line numbers' },
      ],
    },
  ],
  blocks: [
    {
      title: 'Composer',
      items: [
        { id: 'slash-menu', label: 'Slash menu' },
        { id: 'token-usage', label: 'Token usage' },
      ],
    },
    {
      title: 'Chrome',
      items: [{ id: 'chat-header', label: 'Chat header' }, { id: 'session-row-accessory', label: 'Session row accessory' }, { id: 'project-row-accessory', label: 'Project row accessory' }],
    },
    {
      title: 'Git',
      items: [
        { id: 'git-change-row', label: 'Git change tree' },
        { id: 'git-commit-bar', label: 'Git commit bar' },
        { id: 'git-graph-row', label: 'Git graph panel' },
        { id: 'git-diff-panel', label: 'Git diff panel' },
      ],
    },
  ],
  layers: [
    {
      title: 'Shell',
      items: [{ id: 'project-sidebar', label: 'Project sidebar' }],
    },
    {
      title: 'Chat',
      items: [
        { id: 'chat-shell', label: 'Chat shell' },
        { id: 'chat-transcript', label: 'Chat transcript' },
      ],
    },
    {
      title: 'Composer',
      items: [{ id: 'composer', label: 'Composer' }],
    },
    {
      title: 'Decision',
      items: [{ id: 'decision', label: 'Decision surfaces' }],
    },
    {
      title: 'Status',
      items: [{ id: 'status-area', label: 'Status area' }],
    },
    {
      title: 'Resource',
      items: [{ id: 'resource-panel', label: 'Explorer panel' }],
    },
    {
      title: 'Git',
      items: [
        { id: 'source-control', label: 'Source control' },
        { id: 'git-graph', label: 'Git graph' },
      ],
    },
    {
      title: 'Workbench',
      items: [{ id: 'workbench', label: 'Workbench' }],
    },
  ],
};

const LEGACY_ROUTE_REDIRECT: Record<string, SandboxRoute> = {
  [LEGACY_COMPONENTS2_ROUTE]: 'components-forms',
};

export function isSandboxRoute(value: string): value is SandboxRoute {
  return SANDBOX_ROUTES.includes(value as SandboxRoute);
}

function resolveRoute(routePart: string): SandboxRoute {
  if (isSandboxRoute(routePart)) return routePart;
  return LEGACY_ROUTE_REDIRECT[routePart] ?? 'tokens';
}

export function parseSandboxHash(hash = window.location.hash): { route: SandboxRoute; section?: string } {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [routePart, section] = path.split('/').filter(Boolean);
  const route = resolveRoute(routePart ?? '');
  return { route, section: section || undefined };
}

export function sandboxHref(route: SandboxRoute, section?: string) {
  return section ? `#/${route}/${section}` : `#/${route}`;
}

export function scrollToSection(sectionId: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
