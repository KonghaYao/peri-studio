import { createMemo, createSignal, onCleanup } from 'solid-js';
import { createSmoothMarkdownStream, type SmoothMarkdownStreamOptions } from 'markstream-core';

export type { SmoothMarkdownStreamOptions };

export function useSmoothMarkdownStream(options: SmoothMarkdownStreamOptions = {}) {
  const controller = createSmoothMarkdownStream(options);
  const [source, setSource] = createSignal('');
  const [visible, setVisible] = createSignal('');
  const [done, setDone] = createSignal(false);

  const sync = () => {
    const snapshot = controller.getSnapshot();
    setSource(snapshot.source);
    setVisible(snapshot.visible);
    setDone(snapshot.done);
  };

  const unsubscribe = controller.subscribe(sync);
  sync();

  onCleanup(() => {
    unsubscribe();
    controller.destroy();
  });

  const pendingChars = createMemo(() => Math.max(0, source().length - visible().length));
  const caughtUp = createMemo(() => pendingChars() === 0);
  const final = createMemo(() => done() && caughtUp());

  return {
    source,
    visible,
    done,
    caughtUp,
    final,
    pendingChars,
    enqueue: controller.enqueue.bind(controller),
    finish: controller.finish.bind(controller),
    flush: controller.flush.bind(controller),
    reset: controller.reset.bind(controller),
    pause: controller.pause.bind(controller),
    resume: controller.resume.bind(controller),
  };
}
