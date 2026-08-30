/** 沙箱各 tier 页面共用的 demo 区块壳。 */
export function DemoSection(props: { id: string; title: string; description?: string; children: unknown }) {
  return (
    <section id={props.id} class="scroll-mt-[calc(var(--sandbox-header-height)+12px)] border-b border-border-subtle px-4 py-7 min-[720px]:px-8">
      <h2 class="text-15 font-semibold text-content-primary">{props.title}</h2>
      {props.description && <p class="mt-1 max-w-2xl text-12 leading-normal text-content-muted">{props.description}</p>}
      <div class="mt-4">{props.children as never}</div>
    </section>
  );
}

export function TierHeader(props: { tier: string; title: string; description: string }) {
  return (
    <header class="border-b border-border-subtle px-4 pt-6 pb-6 min-[720px]:px-8 min-[720px]:pt-8">
      <p class="text-10 font-medium tracking-caps uppercase text-content-faint">{props.tier}</p>
      <h1 class="mt-1 text-24 font-semibold tracking-tight text-content-primary">{props.title}</h1>
      <p class="mt-2 max-w-xl text-13 leading-normal text-content-secondary">{props.description}</p>
    </header>
  );
}

export function DomainSection(props: { title: string; description?: string; children: unknown }) {
  return (
    <div class="border-b border-border-subtle px-4 py-6 min-[720px]:px-8">
      <h2 class="text-13 font-semibold text-content-secondary">{props.title}</h2>
      {props.description && <p class="mt-1 max-w-2xl text-12 text-content-muted">{props.description}</p>}
      <div class="mt-4 flex flex-col gap-6">{props.children as never}</div>
    </div>
  );
}
