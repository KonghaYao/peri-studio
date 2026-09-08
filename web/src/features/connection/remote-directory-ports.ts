import type { RemoteDirectoryBrowseDependencies } from '@/features/machine/remote-directory-browse';

/** Store 组合根注入：远程目录浏览所需的 ysync subscribe/unsubscribe 语义（与 widget 内联帧一致）。 */
export function createRemoteDirectoryBrowsePorts(deps: {
  ready: () => boolean;
  send: (frame: unknown) => boolean;
}): RemoteDirectoryBrowseDependencies {
  return {
    ready: deps.ready,
    send: deps.send,
    subscribe: (docId) => {
      deps.send({ t: 'ysync.subscribe', docs: [docId], clientCapabilities: [] });
    },
    unsubscribe: (docId) => {
      deps.send({ t: 'ysync.unsubscribe', docs: [docId] });
    },
  };
}
