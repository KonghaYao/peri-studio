type Props = {
  label?: string;
  decorative?: boolean;
};

export function Spinner(props: Props) {
  const decorative = props.decorative && !props.label;
  return <span class="ui-spinner" role={props.label ? 'status' : undefined} aria-label={props.label} aria-hidden={decorative ? 'true' : undefined} />;
}
