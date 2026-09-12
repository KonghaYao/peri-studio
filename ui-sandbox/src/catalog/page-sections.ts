export type SandboxRoute = 'tokens' | 'components' | 'components2' | 'blocks' | 'layers';

export const SANDBOX_ROUTES: SandboxRoute[] = ['tokens', 'components', 'components2', 'blocks', 'layers'];

export const ROUTE_META: Record<SandboxRoute, { tier: string; label: string }> = {
  tokens: { tier: 'T1', label: 'Tokens' },
  components: { tier: 'T2', label: 'Base UI' },
  components2: { tier: 'T2', label: 'Base UI 2' },
  blocks: { tier: 'T3', label: 'Blocks' },
  layers: { tier: 'T4', label: 'Layers' },
};

export type CatalogItem = { id: string; label: string };
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
  components2: [
    {
      title: 'Form & input',
      items: [
        { id: 'switch', label: 'Switch & label' },
        { id: 'input-group', label: 'Input group' },
        { id: 'combobox', label: 'Combobox & command' },
        { id: 'typography', label: 'Typography & select' },
        { id: 'resizable', label: 'Resizable & OTP' },
      ],
    },
    {
      title: 'Surfaces',
      items: [
        { id: 'progress', label: 'Progress & slider' },
        { id: 'card', label: 'Card & alert' },
        { id: 'accordion', label: 'Accordion & toggle' },
        { id: 'table', label: 'Table & overlay' },
      ],
    },
    {
      title: 'Navigation & menus',
      items: [
        { id: 'breadcrumb', label: 'Breadcrumb & pagination' },
        { id: 'overlay', label: 'Alert dialog & sheet' },
        { id: 'menus', label: 'Context & hover' },
        { id: 'menubar', label: 'Menubar & nav' },
      ],
    },
    {
      title: 'Round 2 · shadcn',
      items: [
        { id: 'calendar', label: 'Calendar' },
        { id: 'date-picker', label: 'Date picker' },
        { id: 'carousel', label: 'Carousel' },
        { id: 'form', label: 'Form' },
        { id: 'item', label: 'Item' },
      ],
    },
    {
      title: 'Round 3 · shadcn',
      items: [
        { id: 'field', label: 'Field' },
        { id: 'empty', label: 'Empty' },
        { id: 'drawer', label: 'Drawer' },
        { id: 'sidebar', label: 'Sidebar' },
        { id: 'direction', label: 'Direction' },
      ],
    },
    {
      title: 'Round 4 · Chat / AI',
      items: [
        { id: 'scroll-utils', label: 'scroll-fade · shimmer' },
        { id: 'marker', label: 'Marker' },
        { id: 'bubble', label: 'Bubble' },
        { id: 'message', label: 'Message' },
        { id: 'conversation', label: 'Conversation' },
        { id: 'reasoning', label: 'Reasoning' },
        { id: 'tool', label: 'Tool' },
        { id: 'chain-of-thought', label: 'Chain of thought' },
        { id: 'prompt-input', label: 'Prompt input' },
        { id: 'attachments', label: 'Attachments' },
      ],
    },
    {
      title: 'Round 5 · AI Elements',
      items: [
        { id: 'suggestion', label: 'Suggestion' },
        { id: 'sources', label: 'Sources' },
        { id: 'citation', label: 'Inline citation' },
        { id: 'plan', label: 'Plan' },
        { id: 'task', label: 'Task' },
        { id: 'confirmation', label: 'Confirmation' },
        { id: 'queue', label: 'Queue' },
        { id: 'code-block', label: 'Code block' },
        { id: 'snippet', label: 'Snippet' },
        { id: 'typeset', label: 'Typeset' },
        { id: 'data-table', label: 'Data table' },
        { id: 'questionnaire', label: 'Questionnaire' },
      ],
    },
  ],
  blocks: [
    {
      title: 'Chat',
      items: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'user-bubble', label: 'User bubble' },
        { id: 'tool-activity', label: 'Tool activity' },
        { id: 'resource-cite', label: 'Resource cite' },
      ],
    },
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
      title: 'Decision',
      items: [{ id: 'decision-card', label: 'Decision card' }],
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

export function isSandboxRoute(value: string): value is SandboxRoute {
  return SANDBOX_ROUTES.includes(value as SandboxRoute);
}

export function parseSandboxHash(hash = window.location.hash): { route: SandboxRoute; section?: string } {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [routePart, section] = path.split('/').filter(Boolean);
  const route: SandboxRoute = isSandboxRoute(routePart ?? '') ? (routePart as SandboxRoute) : 'tokens';
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
