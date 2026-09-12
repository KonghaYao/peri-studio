export type SandboxRoute =
  | 'tokens'
  | 'components'
  | 'components-forms'
  | 'components-overlays'
  | 'components-ai'
  | 'components-markdown'
  | 'components-shell'
  | 'components-composer'
  | 'components-explorer'
  | 'components-git';

/** @deprecated 旧路由 #/components2，解析时重定向到 components-forms */
export const LEGACY_COMPONENTS2_ROUTE = 'components2';

/** @deprecated 旧路由 #/layers，按 section 重定向到组合页 */
export const LEGACY_LAYERS_ROUTE = 'layers';

/** @deprecated 旧路由 #/blocks，按 section 重定向到组合页 */
export const LEGACY_BLOCKS_ROUTE = 'blocks';

/** @deprecated 旧路由 #/components-code，重定向到 components-markdown */
export const LEGACY_CODE_ROUTE = 'components-code';

/** @deprecated 旧路由 #/components-chat，重定向到 components-ai */
export const LEGACY_CHAT_ROUTE = 'components-chat';

/** @deprecated 旧路由 #/components-resource，重定向到 components-explorer */
export const LEGACY_RESOURCE_ROUTE = 'components-resource';

export const SANDBOX_ROUTES: SandboxRoute[] = [
  'tokens',
  'components',
  'components-forms',
  'components-overlays',
  'components-ai',
  'components-markdown',
  'components-shell',
  'components-composer',
  'components-explorer',
  'components-git',
];

export const ROUTE_META: Record<SandboxRoute, { tier: string; label: string }> = {
  tokens: { tier: 'T1', label: 'Tokens' },
  components: { tier: 'T2', label: 'Core' },
  'components-forms': { tier: 'T2', label: 'Forms' },
  'components-overlays': { tier: 'T2', label: 'Overlays' },
  'components-ai': { tier: 'T2', label: 'AI' },
  'components-markdown': { tier: 'T2', label: 'Markdown' },
  'components-shell': { tier: 'Comp', label: 'Shell' },
  'components-composer': { tier: 'Comp', label: 'Composer' },
  'components-explorer': { tier: 'Comp', label: 'Explorer' },
  'components-git': { tier: 'Comp', label: 'Git' },
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
      title: 'Palette & semantics',
      items: [
        { id: 'palette', label: 'Color palettes' },
        { id: 'semantic', label: 'Semantic colors' },
      ],
    },
    {
      title: 'Layout & type',
      items: [
        { id: 'spacing', label: 'Spacing' },
        { id: 'radius', label: 'Radius' },
        { id: 'typography', label: 'Typography' },
      ],
    },
    {
      title: 'Chrome & motion',
      items: [
        { id: 'shell', label: 'Shell & header' },
        { id: 'elevation', label: 'Elevation & motion' },
        { id: 'component-tokens', label: 'Component tokens' },
      ],
    },
  ],
  components: [
    {
      title: 'Actions',
      items: [
        { id: 'button', label: 'Button' },
        { id: 'icon-button', label: 'IconButton' },
        { id: 'button-group', label: 'ButtonGroup' },
      ],
    },
    {
      title: 'Inputs',
      items: [
        { id: 'input', label: 'Input & Textarea' },
        { id: 'select', label: 'Select & forms' },
      ],
    },
    {
      title: 'Feedback',
      items: [
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
      title: 'Controls',
      items: [
        { id: 'switch', label: 'Switch & label' },
        { id: 'input-group', label: 'Input group' },
        { id: 'combobox', label: 'Combobox & command' },
      ],
    },
    {
      title: 'Structure',
      items: [
        { id: 'typography', label: 'Typography & select' },
        { id: 'resizable', label: 'Resizable & OTP' },
        { id: 'calendar', label: 'Calendar' },
        { id: 'date-picker', label: 'Date picker' },
        { id: 'form', label: 'Form' },
        { id: 'field', label: 'Field' },
      ],
    },
    {
      title: 'Data',
      items: [
        { id: 'data-table', label: 'Data table' },
        { id: 'questionnaire', label: 'Questionnaire' },
      ],
    },
  ],
  'components-overlays': [
    {
      title: 'Surfaces',
      items: [
        { id: 'card', label: 'Card & alert' },
        { id: 'accordion', label: 'Accordion & toggle' },
        { id: 'empty', label: 'Empty' },
        { id: 'item', label: 'Item' },
      ],
    },
    {
      title: 'Feedback & data',
      items: [
        { id: 'progress', label: 'Progress & slider' },
        { id: 'table', label: 'Table & popover' },
      ],
    },
    {
      title: 'Overlays',
      items: [
        { id: 'overlay', label: 'Alert dialog & sheet' },
        { id: 'drawer', label: 'Drawer' },
        { id: 'menus', label: 'Context & hover' },
      ],
    },
    {
      title: 'Navigation',
      items: [
        { id: 'breadcrumb', label: 'Breadcrumb & pagination' },
        { id: 'menubar', label: 'Menubar & nav' },
        { id: 'carousel', label: 'Carousel' },
      ],
    },
    {
      title: 'Utilities',
      items: [
        { id: 'direction', label: 'Direction' },
        { id: 'sidebar', label: 'Sidebar', status: 'not-implemented' },
      ],
    },
  ],
  'components-ai': [
    {
      title: 'Chat primitives',
      items: [
        { id: 'conversation', label: 'Conversation' },
        { id: 'message', label: 'Message branches' },
      ],
    },
    {
      title: 'AI elements',
      items: [
        { id: 'suggestion', label: 'Suggestion' },
        { id: 'sources', label: 'Sources' },
        { id: 'citation', label: 'Inline citation' },
        { id: 'plan', label: 'Plan' },
        { id: 'task', label: 'Tool activity' },
        { id: 'decision', label: 'Decision surfaces' },
        { id: 'confirmation', label: 'Questionnaire' },
        { id: 'queue', label: 'Queue' },
        { id: 'snippet', label: 'Snippet' },
      ],
    },
  ],
  'components-markdown': [
    {
      title: 'Markdown',
      items: [
        { id: 'markdown-render', label: 'Render' },
        { id: 'markdown-mermaid', label: 'Mermaid' },
      ],
    },
    {
      title: 'Code block',
      items: [
        { id: 'code-block-default', label: 'Default' },
        { id: 'code-block-composable', label: 'Composable header' },
        { id: 'code-block-line-numbers', label: 'Line numbers' },
      ],
    },
  ],
  'components-shell': [
    {
      title: 'Sidebar',
      items: [
        { id: 'project-sidebar', label: 'Project sidebar' },
        { id: 'session-row-accessory', label: 'Session row accessory' },
        { id: 'project-row-accessory', label: 'Project row accessory' },
      ],
    },
    {
      title: 'Chat chrome',
      items: [
        { id: 'chat-header', label: 'Chat header' },
        { id: 'chat-shell', label: 'Chat shell' },
        { id: 'chat-transcript', label: 'Chat transcript' },
      ],
    },
    {
      title: 'Work status',
      items: [
        { id: 'status-area', label: 'Status area' },
      ],
    },
    {
      title: 'Terminal',
      items: [
        { id: 'terminal-dock', label: 'Terminal dock' },
      ],
    },
  ],
  'components-composer': [
    {
      title: 'Composer',
      items: [
        { id: 'composer', label: 'Composer' },
        { id: 'composer-upload', label: 'Upload tiles' },
        { id: 'slash-menu', label: 'Slash menu' },
        { id: 'token-usage', label: 'Token usage' },
      ],
    },
  ],
  'components-explorer': [
    {
      title: 'Explorer',
      items: [
        { id: 'explorer-panel', label: 'File tree' },
        { id: 'explorer-upload-drop', label: 'Upload drop' },
        { id: 'explorer-mutations', label: 'Mutations' },
      ],
    },
    {
      title: 'Workbench',
      items: [
        { id: 'workbench', label: 'Workbench layout' },
      ],
    },
  ],
  'components-git': [
    {
      title: 'Panels',
      items: [
        { id: 'source-control', label: 'Source control' },
        { id: 'git-graph', label: 'Git graph' },
      ],
    },
    {
      title: 'Building blocks',
      items: [
        { id: 'git-change-row', label: 'Change tree' },
        { id: 'git-commit-bar', label: 'Commit bar' },
        { id: 'git-graph-row', label: 'Graph panel' },
        { id: 'git-diff-panel', label: 'Diff panel' },
      ],
    },
  ],
};

const LEGACY_ROUTE_REDIRECT: Record<string, SandboxRoute> = {
  [LEGACY_COMPONENTS2_ROUTE]: 'components-forms',
  [LEGACY_CODE_ROUTE]: 'components-markdown',
  [LEGACY_CHAT_ROUTE]: 'components-ai',
  [LEGACY_RESOURCE_ROUTE]: 'components-explorer',
};

const LEGACY_EXPLORER_SECTION_IDS: Record<string, string> = {
  'resource-panel': 'explorer-panel',
};

const LEGACY_MARKDOWN_SECTION_IDS: Record<string, string> = {
  'markdown-static': 'markdown-render',
  'markdown-streaming': 'markdown-render',
};

const LEGACY_BLOCKS_SECTION_ROUTES: Record<string, SandboxRoute> = {
  'slash-menu': 'components-composer',
  'token-usage': 'components-composer',
  'git-change-row': 'components-git',
  'git-commit-bar': 'components-git',
  'git-graph-row': 'components-git',
  'git-diff-panel': 'components-git',
};

/** 原 #/components-ai 下已迁入 Shell 的章节。 */
const LEGACY_AI_SHELL_SECTIONS = new Set([
  'chat-header',
  'chat-shell',
  'chat-transcript',
  'session-row-accessory',
  'project-row-accessory',
]);

const LEGACY_LAYER_SECTION_ROUTES: Record<string, SandboxRoute> = {
  'project-sidebar': 'components-shell',
  'session-row-accessory': 'components-shell',
  'project-row-accessory': 'components-shell',
  'status-area': 'components-shell',
  'chat-header': 'components-shell',
  'chat-shell': 'components-shell',
  'chat-transcript': 'components-shell',
  'terminal-dock': 'components-shell',
  composer: 'components-composer',
  'composer-upload': 'components-composer',
  decision: 'components-ai',
  confirmation: 'components-ai',
  'resource-panel': 'components-explorer',
  'explorer-panel': 'components-explorer',
  'explorer-upload-drop': 'components-explorer',
  'explorer-mutations': 'components-explorer',
  workbench: 'components-explorer',
  'source-control': 'components-git',
  'git-graph': 'components-git',
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

  if (routePart === LEGACY_LAYERS_ROUTE) {
    const mappedRoute = section ? (LEGACY_LAYER_SECTION_ROUTES[section] ?? 'components-shell') : 'components-shell';
    return { route: mappedRoute, section: section || undefined };
  }

  if (routePart === LEGACY_BLOCKS_ROUTE) {
    const mappedRoute = section ? (LEGACY_BLOCKS_SECTION_ROUTES[section] ?? 'components-composer') : 'components-composer';
    return { route: mappedRoute, section: section || undefined };
  }

  const route = resolveRoute(routePart ?? '');
  if (section && route === 'components-ai' && LEGACY_AI_SHELL_SECTIONS.has(section)) {
    return { route: 'components-shell', section };
  }

  let normalizedSection = section;
  if (section && route === 'components-markdown') {
    normalizedSection = LEGACY_MARKDOWN_SECTION_IDS[section] ?? section;
  } else if (section && route === 'components-explorer') {
    normalizedSection = LEGACY_EXPLORER_SECTION_IDS[section] ?? section;
  }
  return { route, section: normalizedSection || undefined };
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
