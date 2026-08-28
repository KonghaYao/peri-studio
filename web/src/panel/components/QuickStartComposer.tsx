import { createEffect, createSignal, createUniqueId, Show } from 'solid-js';
import { Button, IconButton, InlineNotice, Textarea } from '../../components/ui';
import { createSessionWithFirstMessage, creatingSessionProjectId, retryQuickStart } from '../store';
import { readOnly } from '../lib/auth-state';
import { dismissFailedQuickStart, quickStartSubmission } from '../lib/quick-start-delivery';
import { promptMaxBytes } from '../lib/connection';
import { promptByteLength, promptFitsBudget } from '../lib/prompt-budget';
import { Plus, SendHorizontal, ShieldCheck } from 'lucide-solid';

export function QuickStartComposer(props: { projects: Array<{ id: string; name: string }>; initialProjectId?: string }) {
  const [draft, setDraft] = createSignal('');
  const statusId = `quick-start-status-${createUniqueId()}`;
  const budgetId = `quick-start-budget-${createUniqueId()}`;
  const [projectId, setProjectId] = createSignal(props.initialProjectId || props.projects[0]?.id || '');
  const pending = () => quickStartSubmission();
  const pendingIsInFlight = () => pending()?.phase === 'creating' || pending()?.phase === 'accepted';
  const pendingNeedsAttention = () => pending()?.phase === 'uncertain' || pending()?.phase === 'failed';
  const draftBytes = () => promptByteLength(draft().trim());
  const promptOverBudget = () => !!draft().trim() && !promptFitsBudget(draft().trim(), promptMaxBytes());
  const locked = () => (!!pending() && pending()!.phase !== 'failed') || !!creatingSessionProjectId();
  const project = () => props.projects.find((item) => item.id === projectId());
  createEffect(() => {
    if (!pending() && !project()) setProjectId(props.projects[0]?.id || '');
  });
  const submit = () => {
    const text = draft().trim();
    if (!text || pending() || !projectId() || !promptFitsBudget(text, promptMaxBytes())) return;
    createSessionWithFirstMessage(projectId(), text);
  };

  return <section class="quick-start quick-start--docked w-full text-left" aria-label="Start new session">
    <div class="quick-start__surface overflow-hidden border border-composer-border rounded-18 bg-surface shadow-composer-overlay focus-within:border-focus-ring focus-within:shadow-composer-overlay has-[.ui-textarea:focus-visible]:shadow-[var(--shadow-composer-overlay),0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)]" aria-busy={pendingIsInFlight() || undefined}>
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
        placeholder="Message Agent…"
        aria-label="First message"
        aria-describedby={[pendingNeedsAttention() ? statusId : '', promptOverBudget() ? budgetId : ''].filter(Boolean).join(' ') || undefined}
        variant="bare"
        class="quick-start__textarea w-full min-h-60 px-18 pt-16 pb-8 border-0 outline-0 resize-none bg-transparent text-14 leading-22 text-text-primary"
      />
      <Show when={promptOverBudget()}>
        <InlineNotice id={budgetId} class="mx-10 mb-8" tone="danger" role="alert" title="First message is too large">
          <span>{promptMaxBytes() > 0
            ? `${draftBytes()} / ${promptMaxBytes()} bytes. Shorten the message before starting a session.`
            : 'Secure message delivery is not enabled on the server. Refresh or upgrade the server before starting a session.'}</span>
        </InlineNotice>
      </Show>
      <div class="quick-start__footer flex min-h-52 items-center gap-7 px-10 pb-8">
        <IconButton label="Add attachment" title="Attachments are not connected yet" disabled class="border-0 bg-transparent text-text-primary"><Plus size={18} strokeWidth={1.7} /></IconButton>
        <IconButton label="Approval mode" title="Approval mode is not connected yet" disabled class="border-0 bg-transparent text-text-muted"><ShieldCheck size={17} strokeWidth={1.7} /></IconButton>
        <span class="ml-auto" />
        <IconButton variant="primary" label="Start session" busy={pending()?.phase === 'creating' || pending()?.phase === 'accepted'} disabled={readOnly() || locked() || !!pending() || !draft().trim() || promptOverBudget()} onClick={submit} class="w-44 min-h-38 rounded-9 border-0 bg-btn-primary text-surface hover:bg-btn-primary-hover"><SendHorizontal size={20} strokeWidth={1.7} /></IconButton>
      </div>
    </div>
    <Show when={pendingNeedsAttention() ? pending() : null}>{(submission) => <InlineNotice id={statusId} class="quick-start__state mt-8 [&_small]:min-w-0" tone={submission().phase === 'failed' ? 'danger' : 'warning'} role="alert" title={submission().phase === 'uncertain' ? 'Creation result not confirmed yet' : 'Failed to create session'}>
      <span>{submission().phase === 'uncertain' ? 'Re-confirming uses the original request and will not create a duplicate project session.' : 'The draft remains local until you choose to start again.'}</span>
      <Show when={submission().detail}><small>{submission().detail}</small></Show>
      <div class="quick-start__actions flex flex-wrap gap-6">
        <Show when={(submission().phase === 'failed' || submission().phase === 'uncertain') && submission().retryable}><Button size="compact" variant="secondary" onClick={retryQuickStart}>Re-confirm with the same request</Button></Show>
        <Show when={submission().phase === 'failed'}><Button size="compact" onClick={dismissFailedQuickStart}>Back to edit</Button></Show>
      </div>
    </InlineNotice>}</Show>
  </section>;
}
