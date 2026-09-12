import { For } from 'solid-js';
import { HOME_FIGURES, HOME_INDEX, HOME_PRINCIPLES, type HomeFigure } from '@/pages/home/home-data';

function Figure(props: { figure: HomeFigure; class?: string }) {
  return (
    <img
      class={props.class}
      src={props.figure.src}
      width={props.figure.width}
      height={props.figure.height}
      alt={props.figure.alt}
      decoding="async"
    />
  );
}

export function HomePage() {
  return (
    <article class="sandbox-home">
      <section id="who" class="sandbox-home__who demo-scroll-anchor">
        <p class="sandbox-home__kicker">Who we are</p>
        <h1 class="sandbox-home__display">Peri Studio</h1>
        <p class="sandbox-home__lede">A design catalog for a calm, dense interface.</p>
        <p class="sandbox-home__body">
          This site is the visual authority — not a product tour. Tokens, components, and
          compositions are designed here first. Color, space, and type have one source: @peri/ui.
        </p>
      </section>

      <figure class="sandbox-home__hero-figure">
        <Figure figure={HOME_FIGURES.hero} class="sandbox-home__photo" />
      </figure>

      <section id="stance" class="sandbox-home__split demo-scroll-anchor">
        <div class="sandbox-home__copy">
          <p class="sandbox-home__kicker">Stance</p>
          <h2 class="sandbox-home__section-title">
            White canvas.
            <br />
            Hairline structure.
          </h2>
          <p class="sandbox-home__body">
            We design by restraint. One azure accent. No decorative fill. If a surface needs a gray
            block to be understood, the type and spacing are not finished.
          </p>
        </div>
        <Figure figure={HOME_FIGURES.stance} class="sandbox-home__photo sandbox-home__photo--frame" />
      </section>

      <section id="problem" class="sandbox-home__band demo-scroll-anchor">
        <div class="sandbox-home__copy sandbox-home__copy--narrow">
          <p class="sandbox-home__kicker">The problem</p>
          <h2 class="sandbox-home__section-title">Interfaces decorate first.</h2>
          <p class="sandbox-home__body">
            Hierarchy gets painted on with slabs of gray. Accent becomes a theme. Components only
            look right on the page that invented them. The catalog and production drift into two
            styles.
          </p>
        </div>
        <Figure figure={HOME_FIGURES.problem} class="sandbox-home__photo" />
      </section>

      <section id="philosophy" class="sandbox-home__split sandbox-home__split--reverse demo-scroll-anchor">
        <div class="sandbox-home__copy">
          <p class="sandbox-home__kicker">Design philosophy</p>
          <h2 class="sandbox-home__section-title">Calm. Dense. Precise.</h2>
          <ol class="sandbox-home__principles">
            <For each={HOME_PRINCIPLES}>
              {(item) => (
                <li class="sandbox-home__principle">
                  <span class="sandbox-home__numeral">{item.id}</span>
                  <div>
                    <h3 class="sandbox-home__principle-title">{item.title}</h3>
                    <p class="sandbox-home__principle-body">{item.body}</p>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </div>
        <Figure figure={HOME_FIGURES.philosophy} class="sandbox-home__photo sandbox-home__photo--frame" />
      </section>

      <section id="solution" class="sandbox-home__band demo-scroll-anchor">
        <div class="sandbox-home__copy sandbox-home__copy--narrow">
          <p class="sandbox-home__kicker">The solution</p>
          <h2 class="sandbox-home__section-title">One system. Four tiers.</h2>
          <p class="sandbox-home__body">
            Tokens, then base UI, then blocks, then layers. Vision is finished here and mirrored
            out. A component carries its own states. Accent speaks only when the surface must.
          </p>
          <div class="sandbox-home__actions">
            <a class="sandbox-home__cta sandbox-home__cta--solid" href="#/tokens">
              Enter Tokens
            </a>
            <a class="sandbox-home__cta sandbox-home__cta--ghost" href="#/components">
              Browse components
            </a>
          </div>
        </div>
        <Figure figure={HOME_FIGURES.solution} class="sandbox-home__photo" />
      </section>

      <section id="index" class="sandbox-home__index demo-scroll-anchor">
        <header class="sandbox-home__index-head">
          <p class="sandbox-home__kicker">Catalog</p>
          <h2 class="sandbox-home__section-title">Open a tier</h2>
        </header>
        <ol class="sandbox-home__index-list">
          <For each={HOME_INDEX}>
            {(item, index) => (
              <li>
                <a class="sandbox-home__index-row" href={item.href}>
                  <span class="sandbox-home__numeral">{String(index() + 1).padStart(2, '0')}</span>
                  <span class="sandbox-home__index-label">{item.label}</span>
                  <span class="sandbox-home__index-tier">{item.tier}</span>
                </a>
              </li>
            )}
          </For>
        </ol>
      </section>
    </article>
  );
}
