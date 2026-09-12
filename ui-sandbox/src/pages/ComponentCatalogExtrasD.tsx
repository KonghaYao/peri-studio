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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
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
      <CatalogDemo id="date-picker" title="Date picker" description="Popover + Calendar 组合触发器。">
        <DemoRow label="Default">
          <DatePicker value={picked()} onValueChange={setPicked} placeholder="Select date">
            <DatePickerTrigger />
            <DatePickerContent />
          </DatePicker>
        </DemoRow>
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
          <Button type="submit" variant="primary">Save profile</Button>
        </Form>
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
    </>
  );
}
