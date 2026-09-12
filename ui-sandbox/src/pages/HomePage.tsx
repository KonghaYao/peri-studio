import { For } from 'solid-js';
import {
  HOME_ATLAS,
  HOME_INDEX,
  HOME_PLATES,
  HOME_PRINCIPLES,
  type HomePlate,
} from '@/pages/home/home-data';

function PlateImage(props: { plate: HomePlate; class?: string }) {
  return (
    <img
      class={props.class}
      src={props.plate.src}
      width={props.plate.width}
      height={props.plate.height}
      alt={props.plate.alt}
      decoding="async"
    />
  );
}

export function HomePage() {
  return (
    <article class="sandbox-home">
      <section id="hero" class="sandbox-home__hero demo-scroll-anchor">
        <PlateImage plate={HOME_PLATES.hero} class="sandbox-home__hero-image" />
        <div class="sandbox-home__hero-copy">
          <p class="sandbox-home__kicker">UI Catalog · T1–T4</p>
          <div class="sandbox-home__hero-title-row">
            <span class="sandbox-home__rule" aria-hidden="true" />
            <h1 class="sandbox-home__display">Signal</h1>
          </div>
          <p class="sandbox-home__lede">
            Tokens, components, and compositions for a persistent ACP workbench.
          </p>
          <div class="sandbox-home__hero-actions">
            <a class="sandbox-home__cta sandbox-home__cta--solid" href="#/tokens">
              Enter Tokens
            </a>
            <a class="sandbox-home__cta sandbox-home__cta--ghost" href="#/components">
              Browse components
            </a>
          </div>
        </div>
      </section>

      <section id="manifesto" class="sandbox-home__manifesto demo-scroll-anchor">
        <div class="sandbox-home__manifesto-copy">
          <p class="sandbox-home__kicker">System</p>
          <h2 class="sandbox-home__section-title">How it holds</h2>
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
        <a class="sandbox-home__manifesto-plate" href="#/tokens">
          <PlateImage plate={HOME_PLATES.tokens} class="sandbox-home__fill-image" />
          <span class="sandbox-home__plate-caption">
            <span class="sandbox-home__kicker">T1 · Tokens</span>
            <span class="sandbox-home__plate-title">Color, space, type</span>
          </span>
        </a>
      </section>

      <section id="atlas" class="sandbox-home__atlas demo-scroll-anchor">
        <header class="sandbox-home__atlas-head">
          <p class="sandbox-home__kicker">Fields</p>
          <h2 class="sandbox-home__section-title">Open a surface</h2>
        </header>
        <div class="sandbox-home__atlas-grid">
          <For each={HOME_ATLAS}>
            {(entry) => {
              const plate = () => HOME_PLATES[entry.plate];
              return (
                <a
                  class={`sandbox-home__plate sandbox-home__plate--${entry.plate}`}
                  href={entry.href}
                >
                  <PlateImage plate={plate()} class="sandbox-home__fill-image" />
                  <span class="sandbox-home__plate-caption">
                    <span class="sandbox-home__kicker">{entry.kicker}</span>
                    <span class="sandbox-home__plate-title">{entry.title}</span>
                    <span class="sandbox-home__plate-body">{entry.body}</span>
                  </span>
                </a>
              );
            }}
          </For>
        </div>
      </section>

      <section id="index" class="sandbox-home__index demo-scroll-anchor">
        <header class="sandbox-home__index-head">
          <p class="sandbox-home__kicker">Index</p>
          <h2 class="sandbox-home__section-title">Every tier, in order</h2>
        </header>
        <ol class="sandbox-home__index-list">
          <For each={HOME_INDEX}>
            {(item, index) => (
              <li>
                <a class="sandbox-home__index-row" href={item.href}>
                  <span class="sandbox-home__numeral">
                    {String(index() + 1).padStart(2, '0')}
                  </span>
                  <span class="sandbox-home__index-label">{item.label}</span>
                  <span class="sandbox-home__index-tier">{item.tier}</span>
                </a>
              </li>
            )}
          </For>
        </ol>
      </section>

      <footer class="sandbox-home__colophon">
        <p>T1 Tokens · T2 Base UI · T3 Blocks · T4 Layers</p>
        <p>Values live in @peri/ui. Compositions are settled here first.</p>
      </footer>
    </article>
  );
}
