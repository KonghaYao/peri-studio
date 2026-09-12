import type { JSX } from 'solid-js';

/** T2 Components 页单组件 demo 区块。 */
/** Catalog 占位：组件刻意不实现，仅说明原因与替代落点。 */
export function CatalogNotImplemented(props: {
  id: string;
  title: string;
  description?: string;
  reason: string;
}) {
  return (
    <section id={props.id} class="demo-scroll-anchor border-b border-border-subtle px-16 py-28 middle:px-32">
      <h2 class="text-15 font-semibold text-content-primary">{props.title}</h2>
      {props.description && <p class="mt-4 max-w-2xl text-12 leading-normal text-content-muted">{props.description}</p>}
      <div class="mt-16 max-w-2xl rounded-8 border border-dashed border-border-subtle bg-surface-muted px-16 py-20">
        <p class="text-10 font-medium tracking-caps uppercase text-content-faint">不实现</p>
        <p class="mt-8 text-13 leading-normal text-content-secondary">{props.reason}</p>
      </div>
    </section>
  );
}

export function CatalogDemo(props: { id: string; title: string; description?: string; children: unknown }) {
  return (
    <section id={props.id} class="demo-scroll-anchor border-b border-border-subtle px-16 py-28 middle:px-32">
      <h2 class="text-15 font-semibold text-content-primary">{props.title}</h2>
      {props.description && <p class="mt-4 max-w-2xl text-12 leading-normal text-content-muted">{props.description}</p>}
      <div class="mt-16 flex flex-col gap-16">{props.children as never}</div>
    </section>
  );
}

export function DemoRow(props: { label?: string; children: JSX.Element }) {
  return (
    <div>
      {props.label && <div class="mb-6 text-10 font-medium tracking-caps uppercase text-content-faint">{props.label}</div>}
      <div class="flex flex-wrap items-center gap-12">{props.children}</div>
    </div>
  );
}

/** 沙箱各 tier 页面共用的 demo 区块壳。 */
export function DemoSection(props: { id: string; title: string; description?: string; children: unknown }) {
  return (
    <section id={props.id} class="demo-scroll-anchor border-b border-border-subtle px-16 py-28 middle:px-32">
      <h2 class="text-15 font-semibold text-content-primary">{props.title}</h2>
      {props.description && <p class="mt-4 max-w-2xl text-12 leading-normal text-content-muted">{props.description}</p>}
      <div class="mt-16">{props.children as never}</div>
    </section>
  );
}

export function TierHeader(props: { tier: string; title: string; description: string }) {
  return (
    <header class="border-b border-border-subtle px-16 pt-24 pb-24 middle:px-32 middle:pt-32">
      <p class="text-10 font-medium tracking-caps uppercase text-content-faint">{props.tier}</p>
      <h1 class="mt-4 text-24 font-semibold tracking-tight text-content-primary">{props.title}</h1>
      <p class="mt-8 max-w-xl text-13 leading-normal text-content-secondary">{props.description}</p>
    </header>
  );
}

export function DomainSection(props: { title: string; description?: string; children: unknown }) {
  return (
    <div class="border-b border-border-subtle px-16 py-24 middle:px-32">
      <h2 class="text-13 font-semibold text-content-secondary">{props.title}</h2>
      {props.description && <p class="mt-4 max-w-2xl text-12 text-content-muted">{props.description}</p>}
      <div class="mt-16 flex flex-col gap-24">{props.children as never}</div>
    </div>
  );
}
