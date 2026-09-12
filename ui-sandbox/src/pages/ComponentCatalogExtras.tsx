import { createSignal, For, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Kbd,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  ProgressFill,
  ProgressLabel,
  ProgressTrack,
  ProgressValueLabel,
  Separator,
  Slider,
  SliderFill,
  SliderThumb,
  SliderTrack,
  Switch,
  SwitchControl,
  SwitchInput,
  SwitchLabel,
  SwitchThumb,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Toaster,
  showToast,
} from '@peri/ui';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic } from 'lucide-solid';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtras(props: { sections?: string[] }) {
  const [switchOn, setSwitchOn] = createSignal(true);
  const [progress, setProgress] = createSignal(62);
  const [slider, setSlider] = createSignal([40]);
  const [format, setFormat] = createSignal('left');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'switch')}>
      <CatalogDemo id="switch" title="Switch · Label · Separator" description="表单辅助原语：开关、字段标签与内容分隔线。">
        <DemoRow label="Switch">
          <Switch checked={switchOn()} onChange={setSwitchOn} class="inline-flex items-center gap-8">
            <SwitchInput />
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
            <SwitchLabel class="text-13 text-content-primary">Enable desktop notifications</SwitchLabel>
          </Switch>
          <Switch disabled class="inline-flex items-center gap-8">
            <SwitchInput />
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
            <SwitchLabel class="text-13 text-content-muted">Disabled</SwitchLabel>
          </Switch>
        </DemoRow>
        <div class="max-w-sm">
          <Label for="catalog-name">Display name</Label>
          <Input id="catalog-name" class="mt-6" placeholder="Peri Studio" />
        </div>
        <div class="max-w-sm">
          <p class="text-12 text-content-secondary">Section one</p>
          <Separator class="my-8" />
          <p class="text-12 text-content-secondary">Section two</p>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'card')}>
      <CatalogDemo id="card" title="Card · Avatar · Alert" description="内容容器、头像与块级提示。">
        <Card class="max-w-md">
          <CardHeader>
            <CardTitle>Session configuration</CardTitle>
            <CardDescription>Runtime settings apply to the next prompt delivery.</CardDescription>
          </CardHeader>
          <CardContent>
            <p class="text-13 text-content-secondary">Model routing stays on the server; the browser only renders projections.</p>
          </CardContent>
          <CardFooter class="flex justify-end gap-8">
            <Button variant="default" size="sm">Cancel</Button>
            <Button variant="primary" size="sm">Save</Button>
          </CardFooter>
        </Card>
        <DemoRow label="Avatar">
          <Avatar>
            <AvatarImage src="https://api.dicebear.com/9.x/shapes/svg?seed=peri" alt="Agent avatar" />
            <AvatarFallback>PS</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>MK</AvatarFallback>
          </Avatar>
        </DemoRow>
        <div class="flex max-w-xl flex-col gap-10">
          <Alert>
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Delivery may still be in flight for the last command.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Runtime interrupted</AlertTitle>
            <AlertDescription>The ACP process exited before confirming the last action.</AlertDescription>
          </Alert>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'accordion')}>
      <CatalogDemo id="accordion" title="Accordion · Collapsible · Toggle" description="可折叠内容与格式切换控件。">
        <Accordion collapsible class="max-w-md rounded-lg border border-border-subtle">
          <AccordionItem value="item-1">
            <AccordionTrigger>What is a project session?</AccordionTrigger>
            <AccordionContent>A persistent Web entry that maps to one ACP thread after load.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Can I resend the same command?</AccordionTrigger>
            <AccordionContent>Yes, with the same commandId for idempotent retries.</AccordionContent>
          </AccordionItem>
        </Accordion>
        <Collapsible class="max-w-md rounded-lg border border-border-subtle px-12 py-8">
          <CollapsibleTrigger class="text-13 font-medium text-content-primary">Archived sessions</CollapsibleTrigger>
          <CollapsibleContent class="mt-8 text-12 text-content-secondary">Twelve archived sessions are available from Settings.</CollapsibleContent>
        </Collapsible>
        <ToggleGroup value={format()} onChange={setFormat} class="inline-flex rounded-md border border-border-subtle p-4">
          <ToggleGroupItem value="left" aria-label="Align left" class="px-10">
            <AlignLeft size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Align center" class="px-10">
            <AlignCenter size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right" class="px-10">
            <AlignRight size={14} />
          </ToggleGroupItem>
        </ToggleGroup>
        <DemoRow label="Toggle">
          <Toggle aria-label="Bold" variant="outline" size="sm">
            <Bold size={14} />
          </Toggle>
          <Toggle aria-label="Italic" variant="outline" size="sm" pressed>
            <Italic size={14} />
          </Toggle>
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'progress')}>
      <CatalogDemo id="progress" title="Progress · Slider · Kbd" description="进度反馈、连续调节与快捷键展示。">
        <div class="max-w-md">
          <Progress value={progress()} class="flex flex-col gap-6">
            <div class="flex items-center justify-between gap-8">
              <ProgressLabel class="text-12 text-content-secondary">Context usage</ProgressLabel>
              <ProgressValueLabel class="text-12 text-content-muted" />
            </div>
            <ProgressTrack>
              <ProgressFill />
            </ProgressTrack>
          </Progress>
          <div class="mt-8 flex gap-8">
            <Button size="sm" variant="default" onClick={() => setProgress((value) => Math.max(0, value - 10))}>-10</Button>
            <Button size="sm" variant="default" onClick={() => setProgress((value) => Math.min(100, value + 10))}>+10</Button>
          </div>
        </div>
        <div class="max-w-md">
          <Slider value={slider()} onChange={setSlider} minValue={0} maxValue={100} step={1} class="flex flex-col gap-8">
            <div class="flex items-center justify-between text-12 text-content-secondary">
              <span>Token budget</span>
              <span class="text-content-muted">{slider()[0]}%</span>
            </div>
            <SliderTrack>
              <SliderFill />
              <SliderThumb />
            </SliderTrack>
          </Slider>
        </div>
        <DemoRow label="Kbd">
          <span class="text-12 text-content-secondary">
            <Kbd>⌘</Kbd> + <Kbd>K</Kbd> to open command palette
          </span>
          <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>P</Kbd>
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table')}>
      <CatalogDemo id="table" title="Table · Popover · Toast" description="表格数据与浮层反馈。">
        <Table class="max-w-lg">
          <TableHeader>
            <TableRow>
              <TableHead>Instance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead class="text-right">Sessions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={[
              { name: 'local', status: 'Connected', count: 4 },
              { name: 'build-agent', status: 'Idle', count: 12 },
            ]}>
              {(row) => (
                <TableRow>
                  <TableCell class="font-medium">{row.name}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell class="text-right tabular-nums">{row.count}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
        <Popover>
          <PopoverTrigger as={Button} variant="default" size="sm">Open popover</PopoverTrigger>
          <PopoverContent>
            <p class="text-13 font-medium text-content-primary">Resource rail</p>
            <p class="mt-8 text-12 leading-normal text-content-secondary">Explorer, source control, and graph share one floating panel.</p>
          </PopoverContent>
        </Popover>
        <div>
          <Toaster />
          <Button
            variant="primary"
            size="sm"
            onClick={() => showToast(<span class="text-13">Settings saved</span>, 3000)}
          >
            Show toast
          </Button>
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
