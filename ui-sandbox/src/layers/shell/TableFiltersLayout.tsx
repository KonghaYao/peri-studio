import { Search } from 'lucide-solid';
import { createSignal } from 'solid-js';
import {
  Button,
  DateFilterInput,
  FilterInput,
  FilterSelect,
  formatDay,
  type FilterInputHandle,
} from '@peri/ui';

/** T4 · peri-fuse 风格 table filter bar：FilterInput / FilterSelect / DateFilterInput。 */
export function TableFiltersLayout() {
  const [query, setQuery] = createSignal<string | undefined>();
  const [type, setType] = createSignal<string | undefined>();
  const [from, setFrom] = createSignal<string | undefined>();
  const [to, setTo] = createSignal<string | undefined>();
  let searchRef: FilterInputHandle | undefined;

  const summary = () => {
    const parts = [
      query() ? `query="${query()}"` : null,
      type() ? `type=${type()}` : null,
      from() ? `from=${formatDay(new Date(from()!))}` : null,
      to() ? `to=${formatDay(new Date(to()!))}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'No filters applied';
  };

  return (
    <div class="overflow-hidden rounded-8 border border-border-subtle bg-surface">
      <div class="border-b border-border-subtle px-24 py-16">
        <h2 class="text-14 font-semibold text-text-primary">Table filters</h2>
        <p class="mt-4 text-12 text-content-muted">
          Enter commits text; select commits immediately; dates use ISO boundary semantics.
        </p>
      </div>

      <div class="flex flex-wrap items-end gap-12 px-24 py-20">
        <div class="flex min-w-0 flex-1 flex-col gap-6">
          <span class="text-11 font-medium text-content-muted">Search</span>
          <FilterInput
            value={query()}
            onCommit={setQuery}
            placeholder="Trace name or ID"
            title="Search traces"
            ref={(handle: FilterInputHandle) => {
              searchRef = handle;
            }}
          />
        </div>

        <div class="flex w-(--container-menu-min) flex-col gap-6">
          <span class="text-11 font-medium text-content-muted">Type</span>
          <FilterSelect
            value={type()}
            onCommit={setType}
            allLabel="All types"
            title="Observation type"
            options={[
              { value: 'generation', label: 'Generation' },
              { value: 'span', label: 'Span' },
              { value: 'event', label: 'Event' },
            ]}
          />
        </div>

        <div class="flex w-(--container-menu-min) flex-col gap-6">
          <span class="text-11 font-medium text-content-muted">From</span>
          <DateFilterInput
            value={from()}
            onCommit={setFrom}
            boundary="start"
            placeholder="From date"
            title="From date"
          />
        </div>

        <div class="flex w-(--container-menu-min) flex-col gap-6">
          <span class="text-11 font-medium text-content-muted">To</span>
          <DateFilterInput
            value={to()}
            onCommit={setTo}
            boundary="end"
            placeholder="To date"
            title="To date"
          />
        </div>

        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Search size={14} aria-hidden="true" />}
          onClick={() => searchRef?.commit()}
        >
          Search
        </Button>
      </div>

      <div class="border-t border-border-subtle bg-surface-muted px-24 py-12 text-12 text-content-secondary">
        {summary()}
      </div>
    </div>
  );
}
