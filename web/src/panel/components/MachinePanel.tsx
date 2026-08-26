import { Badge } from '../../components/ui';
import { connState } from '../lib/connection';
import { globalStatus, schemaVersion } from '../store';
import { serverStatusLabel } from '../lib/topology-view';
import { TopologyView } from './TopologyView';

export function MachinePanel() {
  return <section class="ui-scrollbar min-h-0 flex-1 overflow-auto" aria-label="Machines">
    <div class="resource-section-title flex h-28 items-center border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary pointer-coarse:h-44">Machines</div>
    <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-5 border-b border-divider px-10 py-9 text-10">
      <dt class="text-text-muted">Connection</dt><dd class="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary" title={connState().text}>{connState().text}</dd>
      <dt class="text-text-muted">Server</dt><dd class="m-0"><Badge tone={globalStatus() === 'ok' ? 'ok' : globalStatus() === 'error' ? 'err' : 'neutral'}>{serverStatusLabel(globalStatus())}</Badge></dd>
      <dt class="text-text-muted">Schema</dt><dd class="m-0 font-mono text-text-secondary">{String(schemaVersion() ?? '—')}</dd>
    </dl>
    <div class="p-8"><TopologyView /></div>
  </section>;
}
