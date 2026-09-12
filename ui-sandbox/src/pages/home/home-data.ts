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
    src: homeAsset('lux-hero.jpg'),
    width: 1280,
    height: 720,
    alt: 'Macro of a sapphire crystal disc, bevel and azure rim catching light',
  },
  stance: {
    src: homeAsset('lux-stance.jpg'),
    width: 1152,
    height: 864,
    alt: 'Optical glass leaning on brushed aluminum, azure edge at the seam',
  },
  problem: {
    src: homeAsset('lux-problem.jpg'),
    width: 1280,
    height: 720,
    alt: 'Thin aluminum slats in register, one rotated off the grid',
  },
  philosophy: {
    src: homeAsset('lux-philosophy.jpg'),
    width: 1152,
    height: 864,
    alt: 'CNC-brushed aluminum with a flush azure inlay in a hairline channel',
  },
  solution: {
    src: homeAsset('lux-solution.jpg'),
    width: 1280,
    height: 720,
    alt: 'Four stacked optical glass elements with hairline air gaps',
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
