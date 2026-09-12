export type VSCodeFileIconKind =
  | 'typescript' | 'typescriptdef' | 'reactts' | 'javascript' | 'reactjs'
  | 'rust' | 'markdown' | 'json' | 'yaml' | 'shell' | 'dotenv' | 'docker'
  | 'html' | 'css' | 'scss' | 'python' | 'go' | 'toml' | 'git' | 'npm'
  | 'bun' | 'deno' | 'image' | 'svg' | 'text' | 'pdf' | 'sql' | 'xml'
  | 'vue' | 'svelte' | 'default-file';

export type VSCodeFolderIconKind =
  | 'folder-src' | 'folder-src-opened'
  | 'folder-node' | 'folder-node-opened'
  | 'folder-public' | 'folder-public-opened'
  | 'folder-docs' | 'folder-docs-opened'
  | 'folder-script' | 'folder-script-opened'
  | 'folder-test' | 'folder-test-opened'
  | 'folder-git' | 'folder-git-opened'
  | 'folder-github' | 'folder-github-opened'
  | 'folder-vscode' | 'folder-vscode-opened'
  | 'folder-config' | 'folder-config-opened'
  | 'folder-dist' | 'folder-dist-opened'
  | 'default-folder' | 'default-folder-opened';

const EXTENSION_ICONS: Record<string, VSCodeFileIconKind> = {
  ts: 'typescript', tsx: 'reactts', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'reactjs',
  rs: 'rust', md: 'markdown', mdx: 'markdown', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', html: 'html', htm: 'html', css: 'css',
  scss: 'scss', sass: 'scss', py: 'python', go: 'go', toml: 'toml', png: 'image', jpg: 'image',
  jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', ico: 'image', svg: 'svg', txt: 'text',
  log: 'text', pdf: 'pdf', sql: 'sql', xml: 'xml', vue: 'vue', svelte: 'svelte',
};

const FOLDER_ICONS: Record<string, string> = {
  src: 'folder-src', source: 'folder-src', node_modules: 'folder-node', public: 'folder-public',
  docs: 'folder-docs', doc: 'folder-docs', scripts: 'folder-script', script: 'folder-script',
  test: 'folder-test', tests: 'folder-test', __tests__: 'folder-test', '.git': 'folder-git',
  '.github': 'folder-github', '.vscode': 'folder-vscode', '.claude': 'folder-config',
  '.peri': 'folder-config', '.idea': 'folder-config', '.config': 'folder-config', dist: 'folder-dist',
  build: 'folder-dist', out: 'folder-dist',
};

const normalizedBasename = (path: string) => path.replace(/\\/g, '/').split('/').at(-1)?.toLowerCase() ?? '';

/** 展示用文件名（保留大小写）。 */
export function filePathBasename(path: string) {
  return path.replace(/\\/g, '/').split('/').at(-1) ?? path;
}

export function vscodeFileIconKind(path: string): VSCodeFileIconKind {
  const name = normalizedBasename(path);
  if (name === 'package.json' || name === 'package-lock.json' || name === '.npmrc') return 'npm';
  if (name === 'bun.lock' || name === 'bun.lockb' || name.startsWith('bunfig.')) return 'bun';
  if (name === 'deno.lock' || name === 'deno.json' || name === 'deno.jsonc') return 'deno';
  if (name === 'cargo.toml' || name === 'cargo.lock' || name.startsWith('rust-toolchain')) return 'rust';
  if (name === '.env' || name.startsWith('.env.')) return 'dotenv';
  if (name === 'dockerfile' || name.startsWith('docker-compose.')) return 'docker';
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') return 'git';
  if (name.endsWith('.d.ts')) return 'typescriptdef';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return EXTENSION_ICONS[extension] ?? 'default-file';
}

export function vscodeFolderIconKind(path: string, open: boolean): VSCodeFolderIconKind {
  const base = FOLDER_ICONS[normalizedBasename(path)] ?? 'default-folder';
  return `${base}${open ? '-opened' : ''}` as VSCodeFolderIconKind;
}
