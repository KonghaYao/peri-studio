// T4 无 UI 运行时：在登录页与工作台都已挂载时捕获 beforeinstallprompt。

import { onMount } from 'solid-js';
import { startPwa } from '@/features/pwa/pwa-state';

export function PwaRuntime() {
  onMount(() => {
    startPwa();
  });
  return null;
}
