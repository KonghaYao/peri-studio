/** Catalog 封面：整组图文同时入场，不再做会拆开构图的视差。 */

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollRoot() {
  return document.querySelector('.sandbox-main');
}

export function installHomeMotion(root: HTMLElement) {
  const reveals = [...root.querySelectorAll<HTMLElement>('[data-home-reveal]')];

  if (prefersReducedMotion()) {
    for (const el of reveals) el.classList.add('is-in');
    return () => {};
  }

  const scroller = scrollRoot();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add('is-in');
      }
    },
    { root: scroller instanceof Element ? scroller : null, threshold: 0.2 },
  );

  for (const el of reveals) io.observe(el);
  requestAnimationFrame(() => {
    reveals[0]?.classList.add('is-in');
  });

  return () => io.disconnect();
}
