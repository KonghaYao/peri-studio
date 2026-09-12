import { Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { CheckCircle2, CircleAlert, CircleX, FileQuestion, Lock, ServerCrash } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { Button } from '../Button';

export type ResultStatus = 'success' | 'error' | 'info' | 'warning' | '404' | '403' | '500';

export type ResultProps = ComponentProps<'div'> & {
  status?: ResultStatus;
  title?: string | JSX.Element;
  subTitle?: string | JSX.Element;
  extra?: JSX.Element;
  icon?: JSX.Element;
};

const statusMeta: Record<ResultStatus, { label: string; tone: string }> = {
  success: { label: 'Success', tone: 'text-success' },
  error: { label: 'Error', tone: 'text-danger' },
  info: { label: 'Info', tone: 'text-info' },
  warning: { label: 'Warning', tone: 'text-warning' },
  '404': { label: '404', tone: 'text-content-muted' },
  '403': { label: '403', tone: 'text-content-muted' },
  '500': { label: '500', tone: 'text-content-muted' },
};

function DefaultIcon(props: { status: ResultStatus }) {
  const size = 56;
  const tone = statusMeta[props.status].tone;
  switch (props.status) {
    case 'success':
      return <CheckCircle2 size={size} class={tone} aria-hidden="true" />;
    case 'error':
      return <CircleX size={size} class={tone} aria-hidden="true" />;
    case 'warning':
      return <CircleAlert size={size} class={tone} aria-hidden="true" />;
    case '403':
      return <Lock size={size} class={tone} aria-hidden="true" />;
    case '500':
      return <ServerCrash size={size} class={tone} aria-hidden="true" />;
    case '404':
      return <FileQuestion size={size} class={tone} aria-hidden="true" />;
    default:
      return <CircleAlert size={size} class={tone} aria-hidden="true" />;
  }
}

/** 结果页：success / error / info / warning / 404 / 403 / 500。 */
export const Result: Component<ResultProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'status', 'title', 'subTitle', 'extra', 'icon', 'children']);
  const status = () => local.status ?? 'info';
  const meta = () => statusMeta[status()];

  return (
    <div
      data-slot="result"
      data-status={status()}
      class={cn('flex flex-col items-center px-24 py-32 text-center', local.class)}
      {...rest}
    >
      <div class="mb-16">{local.icon ?? <DefaultIcon status={status()} />}</div>
      <Show when={local.title}>
        <h2 class="text-20 font-semibold text-text-primary">{local.title}</h2>
      </Show>
      <Show when={!local.title}>
        <h2 class="text-20 font-semibold text-text-primary">{meta().label}</h2>
      </Show>
      <Show when={local.subTitle}>
        <p class="mt-8 max-w-(--container-chat-content-max) text-14 text-text-secondary">{local.subTitle}</p>
      </Show>
      <Show when={local.extra}>
        <div class="mt-20 flex flex-wrap justify-center gap-8">{local.extra}</div>
      </Show>
      {local.children}
    </div>
  );
};

export const ResultActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <div class={cn('mt-20 flex flex-wrap justify-center gap-8', local.class)} {...rest} />;
};

export function resultPresetActions(onPrimary?: () => void, onSecondary?: () => void) {
  return (
    <ResultActions>
      {onSecondary ? <Button variant="default" onClick={onSecondary}>Back</Button> : null}
      {onPrimary ? <Button variant="primary" onClick={onPrimary}>Continue</Button> : null}
    </ResultActions>
  );
}
