// 主工作台页面：薄装配层，组合 PWA 运行时、首次安装询问、认证门、应用壳与全局 Toast。

import { createSignal, onCleanup, onMount } from 'solid-js';
import { AuthGate } from '@/widgets/auth/AuthGate';
import { AppShell } from '@/widgets/shell/AppShell';
import { PwaInstallPrompt } from '@/widgets/shell/PwaInstallPrompt';
import { PwaRuntime } from '@/widgets/shell/PwaRuntime';
import { QuitConfirmDialog } from '@/widgets/shell/QuitConfirmDialog';
import { Toasts } from '@/widgets/shell/Toasts';
import {
  chatCatalog,
  chatStatusSignal,
  machines,
  projectSessions,
  projects,
  stopMachine,
} from '@/store';
import {
  collectNonTerminalSshRuntimes,
  confirmApplicationQuit,
  QUIT_REQUEST_EVENT,
  shouldPromptBeforeQuit,
} from '@/features/shutdown/shutdown-prompt';

export function PanelPage() {
  const [quitOpen, setQuitOpen] = createSignal(false);
  const [quitStopping, setQuitStopping] = createSignal(false);
  const [quitMachines, setQuitMachines] = createSignal<string[]>([]);

  const shutdownInput = () => ({
    machines: machines(),
    instances: [],
    chatCatalog: chatCatalog(),
    chatStatuses: chatStatusSignal(),
    projects: projects(),
    projectSessions: projectSessions(),
  });

  const finishQuit = () => {
    setQuitOpen(false);
    setQuitMachines([]);
    confirmApplicationQuit();
  };

  onMount(() => {
    const onQuitRequest = () => {
      const summary = collectNonTerminalSshRuntimes(shutdownInput());
      if (!shouldPromptBeforeQuit(shutdownInput())) {
        finishQuit();
        return;
      }
      setQuitMachines(summary.displayNames);
      setQuitOpen(true);
    };
    window.addEventListener(QUIT_REQUEST_EVENT, onQuitRequest);
    onCleanup(() => window.removeEventListener(QUIT_REQUEST_EVENT, onQuitRequest));
  });

  const stopThenQuit = async () => {
    const summary = collectNonTerminalSshRuntimes(shutdownInput());
    if (summary.instanceIds.length === 0) {
      finishQuit();
      return;
    }
    setQuitStopping(true);
    try {
      await Promise.all(summary.instanceIds.map((instanceId) => new Promise<void>((resolve) => {
        stopMachine(instanceId, () => resolve(), () => resolve());
      })));
    } finally {
      setQuitStopping(false);
      finishQuit();
    }
  };

  return (
    <>
      <PwaRuntime />
      <AuthGate><AppShell /></AuthGate>
      <PwaInstallPrompt />
      <QuitConfirmDialog
        open={quitOpen()}
        machineNames={quitMachines()}
        stopping={quitStopping()}
        onDismiss={() => setQuitOpen(false)}
        onKeepRunning={finishQuit}
        onStopThenQuit={() => { void stopThenQuit(); }}
      />
      <Toasts />
    </>
  );
}
