// 主工作台页面：薄装配层，组合认证门、应用壳与全局 Toast。

import { AuthGate } from '@/widgets/auth/AuthGate';
import { AppShell } from '@/widgets/shell/AppShell';
import { Toasts } from '@/widgets/shell/Toasts';

export function PanelPage() {
  return (
    <>
      <AuthGate><AppShell /></AuthGate>
      <Toasts />
    </>
  );
}
