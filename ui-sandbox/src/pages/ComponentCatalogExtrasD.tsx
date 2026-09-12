import { createSignal, For, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Calendar,
  Card,
  CardContent,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  DatePicker,
  DatePickerContent,
  DatePickerTrigger,
  Form,
  FormControl,
  FormDependency,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const carouselSlides = [
  { title: 'SolidJS', body: 'Fine-grained reactivity for the web.' },
  { title: 'Tailwind v4', body: 'Token-driven styling with pixel utilities.' },
  { title: 'Kobalte', body: 'Accessible headless primitives for Solid.' },
];

export function ComponentCatalogExtrasD(props: { sections?: string[] }) {
  const [date, setDate] = createSignal<Date | undefined>(new Date(2026, 8, 12));
  const [picked, setPicked] = createSignal<Date | undefined>();
  const [monthPicked, setMonthPicked] = createSignal<Date | undefined>();
  const [accountType, setAccountType] = createSignal('personal');
  const [company, setCompany] = createSignal('');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'calendar')}>
      <CatalogDemo id="calendar" title="Calendar" description="月份网格与选中态；无外部日期库依赖。">
        <DemoRow label="Standalone">
          <div class="rounded-8 border border-border-subtle p-12">
            <Calendar value={date()} onValueChange={setDate} />
          </div>
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'date-picker')}>
      <CatalogDemo id="date-picker" title="Date picker" description="week/month/quarter/year、disabledDate、showTime、presets。">
        <DemoRow label="Date + time + presets">
          <DatePicker
            value={picked()}
            onValueChange={setPicked}
            showTime
            presets={[
              { label: 'Today', value: new Date() },
              { label: 'Tomorrow', value: new Date(Date.now() + 86_400_000) },
            ]}
            disabledDate={(day) => day.getDay() === 0 || day.getDay() === 6}
            placeholder="Select date"
          >
            <DatePickerTrigger />
            <DatePickerContent />
          </DatePicker>
        </DemoRow>
        <DemoRow label="Month / quarter / year">
          <DatePicker picker="month" value={monthPicked()} onValueChange={setMonthPicked} placeholder="Month" />
          <DatePicker picker="quarter" placeholder="Quarter" />
          <DatePicker picker="year" placeholder="Year" />
          <DatePicker picker="week" placeholder="Week" />
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'item')}>
      <CatalogDemo id="item" title="Item" description="列表行原语：媒体 + 标题/描述 + 操作。">
        <ItemGroup class="max-w-md rounded-8 border border-border-subtle">
          <Item>
            <ItemMedia>
              <Avatar class="size-32">
                <AvatarImage src="" alt="" />
                <AvatarFallback>PS</AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Peri Studio</ItemTitle>
              <ItemDescription>ACP agent workbench</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button size="sm" variant="ghost">Open</Button>
            </ItemActions>
          </Item>
          <ItemSeparator />
          <Item>
            <ItemMedia>
              <Avatar class="size-32">
                <AvatarFallback>UI</AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>@peri/ui</ItemTitle>
              <ItemDescription>Design system package</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button size="sm" variant="ghost">Docs</Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'carousel')}>
      <CatalogDemo id="carousel" title="Carousel" description="Scroll-snap 轮播，支持键盘与 prev/next。">
        <div class="mx-auto w-full max-w-sm">
          <Carousel class="relative w-full">
            <CarouselContent>
              <For each={carouselSlides}>
                {(slide) => (
                  <CarouselItem class="basis-full">
                    <Card>
                      <CardContent class="flex aspect-video items-center justify-center p-24">
                        <div class="text-center">
                          <p class="text-15 font-semibold text-content-primary">{slide.title}</p>
                          <p class="mt-8 text-13 text-content-secondary">{slide.body}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </CarouselItem>
                )}
              </For>
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'form')}>
      <CatalogDemo id="form" title="Form" description="字段 id / aria 组合层，不绑定具体表单库。">
        <Form
          class="max-w-sm space-y-16"
          errors={{ email: 'Enter a valid email address.' }}
          onSubmit={(event) => event.preventDefault()}
        >
          <FormField name="username">
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="peri-user" />
              </FormControl>
              <FormDescription>Visible to other workspace members.</FormDescription>
            </FormItem>
          </FormField>
          <FormField name="email">
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>
          <FormField name="accountType">
            <FormItem>
              <FormLabel>Account type</FormLabel>
              <FormControl>
                <Select
                  value={accountType()}
                  onChange={setAccountType}
                  options={[
                    { value: 'personal', label: 'Personal' },
                    { value: 'business', label: 'Business' },
                  ]}
                />
              </FormControl>
            </FormItem>
          </FormField>
          <FormDependency dependencies={['accountType']} values={{ accountType: accountType() }}>
            {(deps) => (
              <Show when={deps.accountType === 'business'}>
                <FormField name="company">
                  <FormItem>
                    <FormLabel>Company</FormLabel>
                    <FormControl>
                      <Input value={company()} onInput={(event) => setCompany(event.currentTarget.value)} placeholder="Acme Inc." />
                    </FormControl>
                  </FormItem>
                </FormField>
              </Show>
            )}
          </FormDependency>
          <Button type="submit" variant="primary">Save profile</Button>
        </Form>
      </CatalogDemo>
      </Show>
    </>
  );
}
