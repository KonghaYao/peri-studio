import { onCleanup, onMount } from 'solid-js';

/** 变量高度 transcript 行测量：ResizeObserver + 初始 layout 读高。 */
export function useTranscriptRowMeasure(
  id: string,
  onMeasure: (id: string, height: number) => void,
) {
  let row: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;

  const measure = () => {
    const height = row?.getBoundingClientRect().height ?? 0;
    if (height > 0) onMeasure(id, height);
  };

  onMount(() => {
    measure();
    if (!row || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(measure);
    observer.observe(row);
  });
  onCleanup(() => observer?.disconnect());

  return (element: HTMLDivElement | undefined) => {
    row = element;
  };
}
