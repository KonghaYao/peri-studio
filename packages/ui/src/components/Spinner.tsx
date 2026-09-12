import { cn } from '../lib/cn';

type Props = {
  class?: string;
  label?: string;
  decorative?: boolean;
};

export function Spinner(props: Props) {
  const decorative = props.decorative && !props.label;
  return (
    <span
      role={props.label ? 'status' : undefined}
      aria-label={props.label}
      aria-hidden={decorative ? 'true' : undefined}
      class={cn(
        'ui-spinner inline-block size-14 animate-spin rounded-full border-2 border-current border-t-transparent',
        props.class,
      )}
    />
  );
}
