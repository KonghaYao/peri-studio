import type { GitGraphCommit } from './types';

/**
 * 前端 mock 的 Git Graph 提交数据。
 *
 * 后端 git-log API 尚未实现，这里使用静态 mock 数据先行接入 GitGraphPanel。
 * 待 server 端 git-log 协议就绪后，整体替换为按 project/session 拉取的真实提交流。
 *
 * 数据按 git log 顺序排列：最新提交在前，parents 指向更老的 commit hash。
 */
export const MOCK_GIT_GRAPH_COMMITS: GitGraphCommit[] = [
  {
    id: 'mock-1',
    hash: 'a4f2c91b',
    message: 'feat(web): wire git graph rail into resource workbench',
    author: 'Christopher13',
    time: '2m',
    date: '30 Aug 2026',
    parents: ['8be31d04'],
    refs: [{ label: 'main', tone: 'branch' }, { label: 'HEAD', tone: 'branch' }],
    isHead: true,
  },
  {
    id: 'mock-2',
    hash: '8be31d04',
    message: 'fix(resource): retry git mutations after generation bump',
    author: 'Christopher13',
    time: '18m',
    date: '30 Aug 2026',
    parents: ['c17e902a'],
    refs: [{ label: 'feature/git-graph-rail', tone: 'branch' }],
  },
  {
    id: 'mock-3',
    hash: 'c17e902a',
    message: 'Merge branch \'feature/git-graph-rail\' into main',
    author: 'Christopher13',
    time: '1h',
    date: '30 Aug 2026',
    parents: ['5d0ab8ef', '91ac44de'],
  },
  {
    id: 'mock-4',
    hash: '5d0ab8ef',
    message: 'feat(resource): source control panel with stage groups',
    author: 'Christopher13',
    time: '3h',
    date: '30 Aug 2026',
    parents: ['f3bbdffa'],
  },
  {
    id: 'mock-5',
    hash: '91ac44de',
    message: 'chore: align resource rail with explorer and scm views',
    author: 'Christopher13',
    time: '5h',
    date: '30 Aug 2026',
    parents: ['f3bbdffa'],
  },
  {
    id: 'mock-6',
    hash: 'f3bbdffa',
    message: 'release: v0.14 workspace recovery',
    author: 'Bot',
    time: '1d',
    date: '29 Aug 2026',
    parents: ['25d047b6'],
    refs: [{ label: 'v0.14.0', tone: 'tag' }, { label: 'origin/main', tone: 'remote' }],
  },
  {
    id: 'mock-7',
    hash: '25d047b6',
    message: 'docs: remote fs git protocol',
    author: 'Christopher13',
    time: '2d',
    date: '28 Aug 2026',
    parents: ['e2a19f30'],
  },
  {
    id: 'mock-8',
    hash: 'e2a19f30',
    message: 'refactor(auth): opaque cookie session lifecycle',
    author: 'Matthew Mayer',
    time: '5d',
    date: '25 Aug 2026',
    parents: [],
  },
];
