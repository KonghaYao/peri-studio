export type MermaidLoader = () => Promise<unknown> | unknown;

const defaultMermaidLoader: MermaidLoader = () => import('mermaid');
const GLOBAL_MERMAID_KEY = '__PERI_MARKDOWN_MERMAID__';

let cachedMermaid: MermaidModule | null = null;
let importAttempted = false;
let lastInitKey: string | null = null;
let pendingImport: Promise<MermaidModule | null> | null = null;
let mermaidLoader: MermaidLoader | null = defaultMermaidLoader;

export interface MermaidModule {
  render: (id: string, source: string) => Promise<MermaidRenderResult> | MermaidRenderResult;
  parse?: (source: string) => Promise<unknown> | unknown;
  initialize?: (config?: Record<string, unknown>) => unknown;
  mermaidAPI?: {
    render?: MermaidModule['render'];
    parse?: MermaidModule['parse'];
    initialize?: MermaidModule['initialize'];
  };
}

export type MermaidRenderResult = string | {
  svg?: string;
  bindFunctions?: (element: Element) => unknown;
};

interface MermaidInitConfig extends Record<string, unknown> {
  securityLevel?: unknown;
  flowchart?: { htmlLabels?: unknown };
}

function computeInitKey(config: MermaidInitConfig) {
  const securityLevel = String(config?.securityLevel ?? 'strict');
  const htmlLabels = config?.flowchart?.htmlLabels;
  return `${securityLevel}|htmlLabels:${htmlLabels === false ? '0' : '1'}`;
}

function normalizeMermaidModule(mod: unknown): MermaidModule | null {
  if (!mod) return null;
  const candidate = (mod as { default?: unknown }).default ?? mod;
  const module = candidate as MermaidModule;
  if (typeof module.render === 'function' || typeof module.parse === 'function' || typeof module.initialize === 'function') {
    return module;
  }
  const api = (candidate as { mermaidAPI?: MermaidModule['mermaidAPI'] }).mermaidAPI;
  if (api && (typeof api.render === 'function' || typeof api.parse === 'function')) {
    return {
      ...(candidate as object),
      render: api.render!.bind(api),
      parse: api.parse ? api.parse.bind(api) : undefined,
      initialize: (opts: unknown) => {
        if (typeof (candidate as MermaidModule).initialize === 'function') {
          return (candidate as MermaidModule).initialize!(opts as Record<string, unknown>);
        }
        return api.initialize ? api.initialize(opts as Record<string, unknown>) : undefined;
      },
    } as MermaidModule;
  }
  return module;
}

function patchInitialize(target: MermaidModule | null) {
  if (!target || typeof target.initialize !== 'function') return;
  const originalInitialize = target.initialize.bind(target);
  target.initialize = (opts) => originalInitialize({ suppressErrorRendering: true, ...(opts || {}) });
}

function ensureInitialized(instance: MermaidModule, config?: MermaidInitConfig) {
  if (!config) return;
  const key = computeInitKey(config);
  if (lastInitKey === key) return;
  try {
    instance.initialize?.({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      htmlLabels: false,
      ...config,
    });
    lastInitKey = key;
  } catch {
    // Mermaid may already be initialized.
  }
}

export function enableMermaid(loader?: MermaidLoader) {
  mermaidLoader = loader ?? defaultMermaidLoader;
  cachedMermaid = null;
  importAttempted = false;
  lastInitKey = null;
  pendingImport = null;
}

export function isMermaidEnabled() {
  return typeof mermaidLoader === 'function';
}

export async function getMermaid(initConfig?: MermaidInitConfig): Promise<MermaidModule | null> {
  if (cachedMermaid) {
    ensureInitialized(cachedMermaid, initConfig);
    return cachedMermaid;
  }

  if (pendingImport) {
    const instance = await pendingImport;
    if (instance) ensureInitialized(instance, initConfig);
    return instance;
  }

  if (importAttempted) return null;
  const loader = mermaidLoader;
  if (!loader) {
    importAttempted = true;
    return null;
  }

  pendingImport = (async () => {
    try {
      const mod = await loader();
      const instance = normalizeMermaidModule(mod);
      if (!instance) {
        importAttempted = true;
        return null;
      }
      patchInitialize(instance);
      cachedMermaid = instance;
      (globalThis as Record<string, unknown>)[GLOBAL_MERMAID_KEY] = instance;
      return instance;
    } catch {
      importAttempted = true;
      return null;
    }
  })();

  try {
    const instance = await pendingImport;
    if (instance) ensureInitialized(instance, initConfig);
    return instance;
  } finally {
    pendingImport = null;
  }
}
