type Props = {
  label?: string;
  decorative?: boolean;
};

export function Spinner(props: Props) {
  const decorative = props.decorative && !props.label;
  return <span class="inline-block h-13 w-13 animate-[spin_.7s_linear_infinite] rounded-full border-2 border-current border-r-transparent" role={props.label ? 'status' : undefined} aria-label={props.label} aria-hidden={decorative ? 'true' : undefined} />;
}
