import { ROUTE_META, SANDBOX_ROUTES, type SandboxRoute } from '@/catalog/page-sections';

export type HomeFigureId = 'hero' | 'stance' | 'problem' | 'philosophy' | 'solution';

export type HomeFigure = {
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

export const HOME_FIGURES: Record<HomeFigureId, HomeFigure> = {
  hero: {
    src: homeAsset('apple-hero.jpg'),
    width: 1280,
    height: 720,
    alt: 'A single sheet of optical glass on white, one edge anodized azure',
  },
  stance: {
    src: homeAsset('apple-stance.jpg'),
    width: 1152,
    height: 864,
    alt: 'Two parallel sheets of optical glass, light passing through like a lens',
  },
  problem: {
    src: homeAsset('apple-problem.jpg'),
    width: 1280,
    height: 720,
    alt: 'Four white plates, one shifted a few millimeters off-register',
  },
  philosophy: {
    src: homeAsset('apple-philosophy.jpg'),
    width: 1152,
    height: 864,
    alt: 'Stacked white material planes with a single azure point',
  },
  solution: {
    src: homeAsset('apple-solution.jpg'),
    width: 1280,
    height: 720,
    alt: 'Four frosted-glass layers in a precise exploded stack',
  },
};

export const HOME_PRINCIPLES: HomePrinciple[] = [
  {
    id: '01',
    title: 'Calm & dense',
    body: 'The interface stays quiet. Contrast rises only when something is happening — never to decorate a resting surface.',
  },
  {
    id: '02',
    title: 'Line before fill',
    body: 'Hierarchy is spacing and hairline. Surfaces stay white. We do not paint gray slabs to invent regions.',
  },
  {
    id: '03',
    title: 'Accent is a signal',
    body: 'Azure marks a primary action or a live state. Success, warning, and danger stay on status. Color is not a theme.',
  },
];

export const HOME_INDEX: HomeIndexEntry[] = SANDBOX_ROUTES.filter(
  (route): route is Exclude<SandboxRoute, 'home'> => route !== 'home',
).map((route) => ({
  href: `#/${route}`,
  tier: ROUTE_META[route].tier,
  label: ROUTE_META[route].label,
}));
