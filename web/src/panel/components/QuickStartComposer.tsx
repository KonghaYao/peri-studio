import { createEffect, createSignal, createUniqueId, For, Show } from 'solid-js';
import { Button, InlineNotice, SelectField, Textarea } from '../../components/ui';
import { createSessionWithFirstMessage, creatingSessionProjectId, retryQuickStart } from '../store';
import { readOnly } from '../lib/auth-state';
import { dismissFailedQuickStart, quickStartSubmission } from '../lib/quick-start-delivery';

export function QuickStartComposer(props: { projects: Array<{ id: string; name: string }>; initialProjectId?: string }) {
  const [draft, setDraft] = createSignal('');
  const statusId = `quick-start-status-${createUniqueId()}`;
  const [projectId, setProjectId] = createSignal(props.initialProjectId || props.projects[0]?.id || '');
  const pending = () => quickStartSubmission();
  const pendingIsInFlight = () => pending()?.phase === 'creating' || pending()?.phase === 'accepted';
  const locked = () => (!!pending() && pending()!.phase !== 'failed') || !!creatingSessionProjectId();
  const project = () => props.projects.find((item) => item.id === projectId());
  createEffect(() => {
    if (!pending() && !project()) setProjectId(props.projects[0]?.id || '');
  });
  const submit = () => {
    const text = draft().trim();
    if (!text || pending() || !projectId()) return;
    createSessionWithFirstMessage(projectId(), text);
  };

  return <section class="quick-start w-full text-left" aria-label="Start new session">
    <Show when={props.projects.length > 1}><SelectField label="Save to project" value={projectId()} disabled={locked()} onChange={(event) => setProjectId(event.currentTarget.value)}>
      <For each={props.projects}>{(item) => <option value={item.id} selected={item.id === projectId()}>{item.name}</option>}</For>
    </SelectField></Show>
    <div class="quick-start__surface overflow-hidden border border-composer-border rounded-16 bg-surface shadow-float focus-within:border-border-strong focus-within:shadow-float" aria-busy={pendingIsInFlight() || undefined}>
      <Textarea
        autoResize
        maxHeight={180}
        value={draft()}
        disabled={readOnly() || locked()}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
        }}
        placeholder={project() ? `Ask ${project()!.name}…` : 'Type a message…'}
        aria-label="First message"
        aria-describedby={pending() ? statusId : undefined}
        variant="bare"
        class="quick-start__textarea w-full min-h-84 p-16 border-0 outline-0 resize-none bg-transparent text-text-primary"
      />
      <div class="quick-start__footer flex min-h-48 items-center gap-12 pt-6 pr-8 pb-6 pl-16 border-t border-divider"><span class="min-w-0 flex-1 text-text-muted text-11">Enter to start · Shift+Enter for a new line</span><Button variant="primary" busy={pending()?.phase === 'creating' || pending()?.phase === 'accepted'} disabled={readOnly() || locked() || !!pending() || !draft().trim()} onClick={submit}>Start session</Button></div>
    </div>
    <Show when={pending()}>{(submission) => <InlineNotice id={statusId} class="quick-start__state mt-8" tone={submission().phase === 'failed' ? 'danger' : submission().phase === 'uncertain' ? 'warning' : 'info'} role={submission().phase === 'failed' || submission().phase === 'uncertain' ? 'alert' : 'status'} live={pendingIsInFlight()} title={submission().phase === 'uncertain' ? 'Creation result not confirmed yet' : submission().phase === 'failed' ? 'Failed to create session' : 'Creating and connecting session…'}>
      <span>{submission().phase === 'uncertain' ? 'Re-confirming uses the original request and will not create a duplicate project session.' : submission().phase === 'failed' ? 'The draft remains local until you choose to start again.' : 'Waiting for the server to confirm the project session and runtime before sending the first message.'}</span>
      <Show when={submission().detail}><small>{submission().detail}</small></Show>
      <div class="quick-start__actions">
        <Show when={(submission().phase === 'failed' || submission().phase === 'uncertain') && submission().retryable}><Button size="compact" variant="secondary" onClick={retryQuickStart}>Re-confirm with the same request</Button></Show>
        <Show when={submission().phase === 'failed'}><Button size="compact" onClick={dismissFailedQuickStart}>Back to edit</Button></Show>
      </div>
    </InlineNotice>}</Show>
  </section>;
}
