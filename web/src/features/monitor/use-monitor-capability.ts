// Workbench rail 可见性探测。不 import store。

import { createSignal, onMount } from 'solid-js';
import { fetchMonitorCapability } from './capability';

export function useMonitorCapability() {
  const [enabled, setEnabled] = createSignal(false);

  onMount(() => {
    void fetchMonitorCapability().then((capability) => setEnabled(capability.enabled));
  });

  return enabled;
}
