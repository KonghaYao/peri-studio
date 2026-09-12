import type { GitChange } from '@peri/ui';
import type { GitGraphCommit } from '@/components/blocks/git';

export const DEMO_REPO = {
  name: 'peri-studio',
  branch: 'main',
  root: '/workspace/peri-studio',
  ahead: 2,
  behind: 0,
};

export const DEMO_STAGED: GitChange[] = [
  { id: 'c1', path: 'server/src/control/resource_service.rs', status: 'modified' },
];

export const DEMO_WORKING: GitChange[] = [
  { id: 'c2', path: 'web/src/widgets/resource/SourceControlPanel.tsx', status: 'modified' },
  { id: 'c3', path: 'docs/design/remote-fs-git-protocol.md', status: 'modified' },
];

export const DEMO_UNTRACKED: GitChange[] = [
  { id: 'c4', path: 'web/src/panel/lib/resource-view.ts', status: 'untracked' },
];

/** Demo graph: newest first; parents point to older commit hashes. */
export const DEMO_GRAPH_COMMITS: GitGraphCommit[] = [
  {
    id: 'g1',
    hash: 'a4f2c91b',
    message: 'feat(web): add git graph layout to ui sandbox',
    author: 'Christopher13',
    time: '2m',
    date: '30 Aug 2026',
    parents: ['8be31d04'],
    refs: [{ label: 'main', tone: 'branch' }, { label: 'HEAD', tone: 'branch' }],
    isHead: true,
  },
  {
    id: 'g2',
    hash: '8be31d04',
    message: 'fix(resource): retry git mutations after generation bump',
    author: 'Christopher13',
    time: '18m',
    date: '30 Aug 2026',
    parents: ['c17e902a'],
    refs: [{ label: 'feature/scm', tone: 'branch' }],
  },
  {
    id: 'g3',
    hash: 'c17e902a',
    message: 'feat(resource): source control panel with stage groups',
    author: 'Christopher13',
    time: '1h',
    date: '30 Aug 2026',
    parents: ['5d0ab8ef', '91ac44de'],
  },
  {
    id: 'g4',
    hash: '5d0ab8ef',
    message: 'chore: align resource rail with explorer and scm views',
    author: 'Christopher13',
    time: '3h',
    date: '30 Aug 2026',
    parents: ['f3bbdffa'],
  },
  {
    id: 'g5',
    hash: '91ac44de',
    message: 'Merge pull request #653 from feature/scm-tree',
    author: 'Christopher13',
    time: '3d',
    date: '27 Aug 2026',
    parents: ['f3bbdffa'],
    refs: [{ label: 'credentials-v0.7.0', tone: 'tag' }],
  },
  {
    id: 'g6',
    hash: 'f3bbdffa',
    message: 'release: v0.14 workspace recovery',
    author: 'Bot',
    time: '1d',
    date: '29 Aug 2026',
    parents: ['25d047b6'],
    refs: [{ label: 'v0.14.0', tone: 'tag' }, { label: 'origin/main', tone: 'remote' }],
  },
  {
    id: 'g7',
    hash: '25d047b6',
    message: 'docs: remote fs git protocol',
    author: 'Christopher13',
    time: '2d',
    date: '28 Aug 2026',
    parents: ['e2a19f30'],
  },
  {
    id: 'g8',
    hash: 'e2a19f30',
    message: 'Removes old location/implementation of credentials provider',
    author: 'Matthew Mayer',
    time: '5d',
    date: '25 Aug 2026',
    parents: [],
  },
];
