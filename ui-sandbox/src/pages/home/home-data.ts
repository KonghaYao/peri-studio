import { ROUTE_META, SANDBOX_ROUTES, type SandboxRoute } from '@/catalog/page-sections';

export type HomePlateId =
  | 'hero'
  | 'tokens'
  | 'composer'
  | 'explorer'
  | 'git'
  | 'dialogue';

export type HomePlate = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type HomePrinciple = {
  id: string;
  title: string;
  body: string;
};

export type HomeAtlasEntry = {
  plate: Exclude<HomePlateId, 'hero' | 'tokens'>;
  href: string;
  kicker: string;
  title: string;
  body: string;
};

export type HomeIndexEntry = {
  href: string;
  tier: string;
  label: string;
};

function homeAsset(file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}home/${file}`;
}

export const HOME_PLATES: Record<HomePlateId, HomePlate> = {
  hero: {
    src: homeAsset('hero-signal.jpg'),
    width: 1280,
    height: 720,
    alt: 'A colossal azure glass plane cutting through darkness, throwing sharp blue caustics',
  },
  tokens: {
    src: homeAsset('field-tokens.jpg'),
    width: 1152,
    height: 864,
    alt: 'Frosted glass tiles hovering in a dark field, a cluster glowing azure',
  },
  composer: {
    src: homeAsset('field-composer.jpg'),
    width: 1280,
    height: 720,
    alt: 'A razor azure light stroke racing across a dark field',
  },
  explorer: {
    src: homeAsset('field-explorer.jpg'),
    width: 864,
    height: 1152,
    alt: 'Nested translucent cubes in a dark void, inner cells glowing azure',
  },
  git: {
    src: homeAsset('field-git.jpg'),
    width: 1152,
    height: 864,
    alt: 'Branching fiber-optic traces on graphite, one path lit azure',
  },
  dialogue: {
    src: homeAsset('field-dialogue.jpg'),
    width: 1280,
    height: 720,
    alt: 'Two opposing beams of white and azure light colliding in mid-air',
  },
};

export const HOME_PRINCIPLES: HomePrinciple[] = [
  {
    id: '01',
    title: 'Calm & dense',
    body: 'Quiet by default. Contrast rises only for streaming, permission, and error — never for decoration.',
  },
  {
    id: '02',
    title: 'Facts, not fiction',
    body: 'The catalog renders contracts. Production never invents server history in the browser.',
  },
  {
    id: '03',
    title: 'Line before fill',
    body: 'Surfaces stay white. Hierarchy is spacing and hairline, not gray slabs or accent walls.',
  },
];

export const HOME_ATLAS: HomeAtlasEntry[] = [
  {
    plate: 'composer',
    href: '#/components-composer',
    kicker: 'Comp',
    title: 'Composer',
    body: 'A turn starts here — attach, slash, send.',
  },
  {
    plate: 'explorer',
    href: '#/components-explorer',
    kicker: 'Comp',
    title: 'Explorer',
    body: 'Nested structure. One node is hot; the rest stays quiet.',
  },
  {
    plate: 'git',
    href: '#/components-git',
    kicker: 'Comp',
    title: 'Git',
    body: 'Branches as live traces. Follow the lit path.',
  },
  {
    plate: 'dialogue',
    href: '#/components-ai',
    kicker: 'T2',
    title: 'Dialogue',
    body: 'Two signals crossing. Wait for the next line.',
  },
];

export const HOME_INDEX: HomeIndexEntry[] = SANDBOX_ROUTES.filter(
  (route): route is Exclude<SandboxRoute, 'home'> => route !== 'home',
).map((route) => ({
  href: `#/${route}`,
  tier: ROUTE_META[route].tier,
  label: ROUTE_META[route].label,
}));
