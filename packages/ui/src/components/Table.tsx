import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

type TableProps = JSX.HTMLAttributes<HTMLTableElement> & {
  /** Classes for the scroll viewport wrapping the table element. */
  wrapperClass?: string;
};

export function Table(props: TableProps) {
  const [local, rest] = splitProps(props, ['class', 'wrapperClass']);
  return (
    <div
      data-slot="table-scroll"
      class={cn('relative min-w-0 w-full overflow-auto ui-scrollbar', local.wrapperClass)}
    >
      <table
        class={cn('w-max min-w-full caption-bottom border-collapse text-left text-12', local.class)}
        {...rest}
      />
    </div>
  );
}

export function TableHeader(props: JSX.HTMLAttributes<HTMLTableSectionElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return <thead class={cn(local.class)} {...rest} />;
}

export function TableBody(props: JSX.HTMLAttributes<HTMLTableSectionElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return <tbody class={cn(local.class)} {...rest} />;
}

export function TableFooter(props: JSX.HTMLAttributes<HTMLTableSectionElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <tfoot class={cn('border-t border-border-subtle bg-surface-muted font-medium', local.class)} {...rest} />
  );
}

export function TableRow(props: JSX.HTMLAttributes<HTMLTableRowElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <tr
      class={cn('border-b border-border-subtle transition-colors hover:bg-interaction-hover', local.class)}
      {...rest}
    />
  );
}

export function TableHead(props: JSX.ThHTMLAttributes<HTMLTableCellElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <th
      class={cn(
        'px-12 py-8 align-middle font-semibold text-content-primary bg-surface-muted border-b border-border-subtle',
        local.class,
      )}
      {...rest}
    />
  );
}

export function TableCell(props: JSX.TdHTMLAttributes<HTMLTableCellElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <td class={cn('px-12 py-8 align-middle border-b border-border-subtle last:border-b-0', local.class)} {...rest} />
  );
}

export function TableCaption(props: JSX.HTMLAttributes<HTMLTableCaptionElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return <caption class={cn('mt-16 text-12 text-content-muted', local.class)} {...rest} />;
}
