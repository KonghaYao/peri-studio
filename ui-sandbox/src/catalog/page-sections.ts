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

export type NavClusterId = 'foundation' | 'components' | 'compositions';

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

export const ROUTE_META: Record<SandboxRoute, { tier: string; label: string; description: string }> = {
  tokens: { tier: 'T1', label: 'Tokens', description: '颜色、间距、排版与组件 token' },
  components: { tier: 'T2', label: 'Core', description: '按钮、输入、反馈等基础原语' },
  'components-forms': { tier: 'T2', label: 'Forms', description: '表单、选择与数据表' },
  'components-overlays': { tier: 'T2', label: 'Overlays', description: '浮层、导航与布局容器' },
  'components-ai': { tier: 'T2', label: 'AI', description: '会话原语与 AI Elements' },
  'components-markdown': { tier: 'T2', label: 'Markdown', description: '富文本与代码块' },
  'components-shell': { tier: 'T4', label: 'Shell', description: '侧栏、状态区、会话壳层' },
  'components-composer': { tier: 'T4', label: 'Composer', description: '输入区与 slash 命令' },
  'components-explorer': { tier: 'T4', label: 'Explorer', description: '文件树与 workbench' },
  'components-git': { tier: 'T4', label: 'Git', description: 'SCM 与 Git graph' },
};

export type NavCluster = {
  id: NavClusterId;
  label: string;
  tier: string;
  description: string;
  routes: SandboxRoute[];
};

/** 顶栏三级信息架构：Foundation → Components → Compositions。 */
export const NAV_CLUSTERS: NavCluster[] = [
  {
    id: 'foundation',
    label: 'Foundation',
    tier: 'T1',
    description: '设计 token 与语义刻度',
    routes: ['tokens'],
  },
  {
    id: 'components',
    label: 'Components',
    tier: 'T2',
    description: '@peri/ui 无业务语义原语',
    routes: ['components', 'components-forms', 'components-overlays', 'components-ai', 'components-markdown'],
  },
  {
    id: 'compositions',
    label: 'Compositions',
    tier: 'T3–T4',
    description: '产品壳层与场景组合',
    routes: ['components-shell', 'components-composer', 'components-explorer', 'components-git'],
  },
];

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
      title: 'Progress & surfaces',
      items: [
        { id: 'progress', label: 'Progress & slider' },
        { id: 'card', label: 'Card & alert' },
        { id: 'accordion', label: 'Accordion & toggle' },
        { id: 'table', label: 'Table & overlay' },
      ],
    },
    {
      title: 'Navigation',
      items: [
        { id: 'breadcrumb', label: 'Breadcrumb & pagination' },
        { id: 'overlay', label: 'Alert dialog & sheet' },
        { id: 'menus', label: 'Context & hover' },
        { id: 'menubar', label: 'Menubar & nav' },
        { id: 'carousel', label: 'Carousel' },
      ],
    },
    {
      title: 'Layout utilities',
      items: [
        { id: 'item', label: 'Item' },
        { id: 'empty', label: 'Empty' },
        { id: 'drawer', label: 'Drawer' },
        { id: 'sidebar', label: 'Sidebar', status: 'not-implemented' },
        { id: 'direction', label: 'Direction' },
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

const ROUTE_CLUSTER = Object.fromEntries(
  NAV_CLUSTERS.flatMap((cluster) => cluster.routes.map((route) => [route, cluster.id])),
) as Record<SandboxRoute, NavClusterId>;

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

export function clusterForRoute(route: SandboxRoute): NavClusterId {
  return ROUTE_CLUSTER[route];
}

export function defaultRouteForCluster(clusterId: NavClusterId): SandboxRoute {
  return NAV_CLUSTERS.find((cluster) => cluster.id === clusterId)?.routes[0] ?? 'tokens';
}

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
