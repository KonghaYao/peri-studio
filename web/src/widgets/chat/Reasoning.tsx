/** 推理摘要：默认折叠，展开后展示预格式文本。 */
export function Reasoning(props: { children: string }) {
  return (
    <details class="message-reasoning max-w-(--chat-reasoning-max) text-content-secondary" data-testid="message-reasoning">
      <summary class="inline-flex min-h-24 cursor-pointer list-none items-center text-11 font-medium tracking-wide text-content-muted hover:text-content-secondary">
        Thinking
      </summary>
      <p class="m-0 mt-4 whitespace-pre-wrap text-12 leading-normal text-content-secondary">{props.children}</p>
    </details>
  );
}
