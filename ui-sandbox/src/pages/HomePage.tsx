import { For, onCleanup, onMount } from 'solid-js';
import { HOME_FIGURES, HOME_INDEX, HOME_PRINCIPLES, type HomeFigure } from '@/pages/home/home-data';
import { installHomeMotion } from '@/pages/home/home-reveal';
import '@/pages/home/home.css';

function Photo(props: { figure: HomeFigure }) {
  return (
    <img
      class="sandbox-home__photo"
      src={props.figure.src}
      width={props.figure.width}
      height={props.figure.height}
      alt={props.figure.alt}
      decoding="async"
    />
  );
}

export function HomePage() {
  let root: HTMLElement | undefined;

  onMount(() => {
    if (!root) return;
    const dispose = installHomeMotion(root);
    onCleanup(dispose);
  });

  return (
    <article class="sandbox-home" ref={(el) => { root = el; }}>
      <section
        id="who"
        class="sandbox-home__pair sandbox-home__pair--end sandbox-home__pair--open demo-scroll-anchor"
        aria-labelledby="who-title"
        data-home-reveal
      >
        <div class="sandbox-home__shot">
          <Photo figure={HOME_FIGURES.hero} />
          <div class="sandbox-home__rubric">
            <p class="sandbox-home__kicker" aria-hidden="true">01</p>
            <h1 id="who-title" class="sandbox-home__display">Peri Studio</h1>
            <p class="sandbox-home__lede">A design catalog for a calm, dense interface.</p>
          </div>
        </div>
        <div class="sandbox-home__legend">
          <p class="sandbox-home__body">
            This site is the visual authority — not a product tour. Tokens, components, and
            compositions are designed here first. Color, space, and type have one source: @peri/ui.
          </p>
        </div>
      </section>

      <section
        id="stance"
        class="sandbox-home__pair sandbox-home__pair--start demo-scroll-anchor"
        aria-labelledby="stance-title"
        data-home-reveal
      >
        <div class="sandbox-home__shot">
          <Photo figure={HOME_FIGURES.stance} />
          <div class="sandbox-home__rubric">
            <p class="sandbox-home__kicker" aria-hidden="true">02</p>
            <h2 id="stance-title" class="sandbox-home__display">
              White canvas.
              <br />
              Hairline structure.
            </h2>
          </div>
        </div>
        <div class="sandbox-home__legend">
          <p class="sandbox-home__body">
            We design by restraint. One azure accent. No decorative fill. If a surface needs a gray
            block to be understood, the type and spacing are not finished.
          </p>
        </div>
      </section>

      <section
        id="problem"
        class="sandbox-home__pair sandbox-home__pair--start demo-scroll-anchor"
        aria-labelledby="problem-title"
        data-home-reveal
      >
        <div class="sandbox-home__shot">
          <Photo figure={HOME_FIGURES.problem} />
          <div class="sandbox-home__rubric">
            <p class="sandbox-home__kicker" aria-hidden="true">03</p>
            <h2 id="problem-title" class="sandbox-home__display">Interfaces decorate first.</h2>
          </div>
        </div>
        <div class="sandbox-home__legend">
          <p class="sandbox-home__body">
            Hierarchy gets painted on with slabs of gray. Accent becomes a theme. Components only
            look right on the page that invented them. The catalog and production drift into two
            styles.
          </p>
        </div>
      </section>

      <section
        id="philosophy"
        class="sandbox-home__pair sandbox-home__pair--stack demo-scroll-anchor"
        aria-labelledby="philosophy-title"
        data-home-reveal
      >
        <div class="sandbox-home__rubric">
          <p class="sandbox-home__kicker" aria-hidden="true">04</p>
          <h2 id="philosophy-title" class="sandbox-home__display">Calm. Dense. Precise.</h2>
        </div>
        <div class="sandbox-home__shot">
          <Photo figure={HOME_FIGURES.philosophy} />
        </div>
        <div class="sandbox-home__legend">
          <ol class="sandbox-home__triad">
            <For each={HOME_PRINCIPLES}>
              {(item) => (
                <li>
                  <span class="sandbox-home__numeral">{item.id}</span>
                  <h3 class="sandbox-home__triad-title">{item.title}</h3>
                  <p class="sandbox-home__triad-body">{item.body}</p>
                </li>
              )}
            </For>
          </ol>
        </div>
      </section>

      <section
        id="solution"
        class="sandbox-home__pair sandbox-home__pair--end demo-scroll-anchor"
        aria-labelledby="solution-title"
        data-home-reveal
      >
        <div class="sandbox-home__shot">
          <Photo figure={HOME_FIGURES.solution} />
          <div class="sandbox-home__rubric">
            <p class="sandbox-home__kicker" aria-hidden="true">05</p>
            <h2 id="solution-title" class="sandbox-home__display">
              One system.
              <br />
              Four tiers.
            </h2>
          </div>
        </div>
        <div class="sandbox-home__legend">
          <p class="sandbox-home__body">
            Tokens, then base UI, then blocks, then layers. Vision is finished here and mirrored
            out. A component carries its own states. Accent speaks only when the surface must.
          </p>
          <div class="sandbox-home__actions">
            <a class="sandbox-home__cta" href="#/tokens">Tokens</a>
            <a class="sandbox-home__cta" href="#/components">Components</a>
          </div>
        </div>
      </section>

      <section id="index" class="sandbox-home__words demo-scroll-anchor" data-home-reveal>
        <p class="sandbox-home__kicker">Catalog</p>
        <nav aria-label="Catalog tiers">
          <ul class="sandbox-home__words-list">
            <For each={HOME_INDEX}>
              {(item) => (
                <li>
                  <a class="sandbox-home__word" href={item.href}>
                    {item.label}
                    <span class="sandbox-home__word-tier">{item.tier}</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </section>
    </article>
  );
}
