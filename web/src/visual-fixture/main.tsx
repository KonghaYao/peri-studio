import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import '../styles.css';
import './fixture.css';
import { AppShell } from '../panel/components/AppShell';
import { Toasts } from '../panel/components/Toasts';
import { DEFAULT_VISUAL_SCENARIO, installVisualScenario, visualScenarios } from './scenarios';

const selected = new URLSearchParams(window.location.search).get('scenario') || DEFAULT_VISUAL_SCENARIO;

function VisualFixture() {
  const installed = installVisualScenario(selected);
  onCleanup(installed.dispose);
  return <>
    <div class="authenticated-app visual-fixture-root">
      <aside class="visual-fixture-rail" aria-label="Visual acceptance scenarios">
        <strong>UI State Acceptance Bench</strong>
        <span>Static test data · actions never connect to the server</span>
        <nav>{visualScenarios.map((scenario) => <a aria-current={scenario.id === installed.scenario.id ? 'page' : undefined} href={`?scenario=${scenario.id}`} title={scenario.description}>{scenario.label}</a>)}</nav>
        <code>{installed.scenario.controls}</code>
      </aside>
      <div class="visual-fixture-stage"><AppShell /></div>
    </div>
    <Toasts />
  </>;
}

render(() => <VisualFixture />, document.getElementById('app')!);
