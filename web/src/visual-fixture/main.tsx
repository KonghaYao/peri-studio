import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import '../styles.css';
import './fixture.css';
import { AppShell } from '../panel/components/AppShell';
import { Toasts } from '../panel/components/Toasts';
import { appendVisualResourceEntries, DEFAULT_VISUAL_SCENARIO, installVisualScenario, removeVisualResourceEntry, setVisualDiffPreview, setVisualElicitationUnknown, setVisualFilePreview, setVisualToolAcceptancePhase, setVisualTranscriptCount, visualScenarios } from './scenarios';
import { VisualScenarioSidebar } from './VisualScenarioSidebar';
import { DesignTokenBoard } from './DesignTokenBoard';

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
    };
  }
}

const search = new URLSearchParams(window.location.search);
const selected = search.get('scenario') || DEFAULT_VISUAL_SCENARIO;
const projectSidebarMode = search.get('sidebar') === 'projects';
const initialResourceView = search.get('resource') === 'scm' ? 'scm' : 'explorer';

function VisualFixture() {
  const installed = installVisualScenario(selected);
  const foundationMode = installed.scenario.id === 'design-tokens';
  window.__PERI_VISUAL_FIXTURE__ = {
    setFilePreview: setVisualFilePreview,
    setDiffPreview: setVisualDiffPreview,
    removeResourceEntry: removeVisualResourceEntry,
    appendResourceEntries: appendVisualResourceEntries,
    setTranscriptCount: setVisualTranscriptCount,
    setElicitationUnknown: setVisualElicitationUnknown,
    setToolAcceptancePhase: setVisualToolAcceptancePhase,
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
      <div class={`visual-fixture-stage ${foundationMode ? 'visual-fixture-stage--foundation' : ''}`}>
        {foundationMode ? <DesignTokenBoard /> : <AppShell initialResourceView={installed.scenario.id === 'resources' ? initialResourceView : null} />}
      </div>
    </div>
    <Toasts />
  </>;
}

render(() => <VisualFixture />, document.getElementById('app')!);
