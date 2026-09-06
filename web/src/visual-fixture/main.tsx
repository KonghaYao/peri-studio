import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import '../styles.css';
import './fixture.css';
import { AppShell } from '@/widgets/shell/AppShell';
import { Toasts } from '@/widgets/shell/Toasts';
import { installResourceStore } from '../panel/lib/resource-store';
import { appendVisualResourceEntries, DEFAULT_VISUAL_SCENARIO, installVisualScenario, removeVisualResourceEntry, setVisualDiffPreview, setVisualElicitationUnknown, setVisualFilePreview, setVisualToolAcceptancePhase, setVisualTranscriptCount, visualResourceEntryExists, visualScenarios } from './scenarios';
import { VisualScenarioSidebar } from './VisualScenarioSidebar';

declare global {
  interface Window {
    __PERI_VISUAL_FIXTURE__?: {
      setFilePreview: typeof setVisualFilePreview;
      setDiffPreview: typeof setVisualDiffPreview;
      removeResourceEntry: typeof removeVisualResourceEntry;
      appendResourceEntries: typeof appendVisualResourceEntries;
      setTranscriptCount: typeof setVisualTranscriptCount;
      setElicitationUnknown: typeof setVisualElicitationUnknown;
      setToolAcceptancePhase: typeof setVisualToolAcceptancePhase;
      hasResourceEntry: typeof visualResourceEntryExists;
    };
  }
}

const search = new URLSearchParams(window.location.search);
const selected = search.get('scenario') || DEFAULT_VISUAL_SCENARIO;
const projectSidebarMode = search.get('sidebar') === 'projects';
const initialResourceView = search.get('resource') === 'scm' ? 'scm' : 'explorer';

// 验收页使用静态 mock 资源树，禁止向真实 server 发 directory 请求以免覆盖 fixture 数据。
installResourceStore({ send: () => true, ready: () => false, toast: () => {} });

function VisualFixture() {
  const installed = installVisualScenario(selected);
  window.__PERI_VISUAL_FIXTURE__ = {
    setFilePreview: setVisualFilePreview,
    setDiffPreview: setVisualDiffPreview,
    removeResourceEntry: removeVisualResourceEntry,
    appendResourceEntries: appendVisualResourceEntries,
    setTranscriptCount: setVisualTranscriptCount,
    setElicitationUnknown: setVisualElicitationUnknown,
    setToolAcceptancePhase: setVisualToolAcceptancePhase,
    hasResourceEntry: visualResourceEntryExists,
  };
  onCleanup(() => {
    delete window.__PERI_VISUAL_FIXTURE__;
    installed.dispose();
  });
  return <>
    <div class={`authenticated-app visual-fixture-root ${projectSidebarMode ? 'visual-fixture-root--project-sidebar' : ''}`}>
      <aside class="visual-fixture-rail" aria-label="Visual acceptance scenarios">
        <strong>{installed.scenario.label}</strong>
        <span>{installed.scenario.description}</span>
        <nav>{visualScenarios.map((scenario) => <a aria-current={scenario.id === installed.scenario.id ? 'page' : undefined} href={`?scenario=${scenario.id}`} title={scenario.description}>{scenario.label}</a>)}</nav>
        <code>Mock data</code>
      </aside>
      {!projectSidebarMode && <VisualScenarioSidebar scenarios={visualScenarios} current={installed.scenario.id} />}
      <div class="visual-fixture-stage">
        <AppShell initialResourceView={installed.scenario.id === 'resources' ? initialResourceView : null} />
      </div>
    </div>
    <Toasts />
  </>;
}

render(() => <VisualFixture />, document.getElementById('app')!);
