import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Button,
  DirectionProvider,
  Drawer,
  DrawerAction,
  DrawerCancel,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Dialog,
  DialogContent,
  DialogTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FormDialogShell,
  Input,
  Listbox,
  ListboxItem,
  ListboxItemLabel,
  SelectField,
  Switch,
  SwitchControl,
  SwitchInput,
  SwitchThumb,
  useDirection,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

function DirectionToggleDemo() {
  const { direction, setDirection } = useDirection();
  return (
    <DemoRow label={`Current: ${direction()}`}>
      <Button
        size="sm"
        variant="default"
        onClick={() => setDirection?.(direction() === 'ltr' ? 'rtl' : 'ltr')}
      >
        Toggle direction
      </Button>
      <p class="text-13 text-content-secondary" dir={direction()}>
        {direction() === 'rtl' ? 'مرحبًا بك في Peri Studio' : 'Welcome to Peri Studio'}
      </p>
    </DemoRow>
  );
}

export function ComponentCatalogExtrasE(props: { sections?: string[] }) {
  const [newsletter, setNewsletter] = createSignal(false);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'field')}>
      <CatalogDemo id="field" title="Field" description="shadcn Field 组合：fieldset、分组、水平/垂直布局与校验。">
        <FieldSet class="max-w-md">
          <FieldLegend>Profile</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel for="field-username">Username</FieldLabel>
              <Input id="field-username" placeholder="peri-user" autocomplete="off" />
              <FieldDescription>Visible on your public profile.</FieldDescription>
            </Field>
            <Field data-invalid={true}>
              <FieldLabel for="field-email">Email</FieldLabel>
              <Input id="field-email" type="email" aria-invalid placeholder="you@example.com" />
              <FieldError>Enter a valid email address.</FieldError>
            </Field>
            <Field orientation="horizontal" class="items-center">
              <Switch checked={newsletter()} onChange={setNewsletter}>
                <SwitchInput id="field-newsletter" />
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
              <FieldLabel for="field-newsletter" class="mb-0">Subscribe to updates</FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>
        <DemoRow label="SelectField · Listbox">
          <SelectField label="Model" class="max-w-xs">
            <option value="nova">Nova 4.1</option>
            <option value="gpt">gpt-5.6</option>
          </SelectField>
          <Listbox
            aria-label="Recent sessions"
            class="max-w-xs rounded-8 border border-border-subtle p-4"
            options={[
              { id: 'alpha', label: 'Alpha session' },
              { id: 'beta', label: 'Beta session' },
            ]}
            optionValue="id"
            optionTextValue="label"
            renderItem={(item) => (
              <ListboxItem item={item}>
                <ListboxItemLabel>{item.rawValue.label}</ListboxItemLabel>
              </ListboxItem>
            )}
          />
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'form-dialog-shell')}>
      <CatalogDemo id="form-dialog-shell" title="FormDialogShell" description="带表单槽位的对话框壳层。">
        <Dialog>
          <DialogTrigger as={Button} variant="default" size="sm">Open form dialog shell</DialogTrigger>
          <DialogContent>
            <FormDialogShell title="Rename project" description="Visible in catalog only.">
              <p class="text-13 text-content-secondary">Dialog shell with form slot.</p>
            </FormDialogShell>
          </DialogContent>
        </Dialog>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'drawer')}>
      <CatalogDemo id="drawer" title="Drawer" description="自底部滑出的面板；移动端友好，支持 swipe handle。">
        <Drawer showSwipeHandle>
          <DrawerTrigger>
            <Button variant="default">Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Move to project</DrawerTitle>
              <DrawerDescription>Select a destination for this session.</DrawerDescription>
            </DrawerHeader>
            <div class="px-16 py-8 text-13 text-content-secondary">
              Drawer content area — scrollable regions go here.
            </div>
            <DrawerFooter>
              <DrawerCancel size="sm">Cancel</DrawerCancel>
              <DrawerAction size="sm">Confirm</DrawerAction>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'direction')}>
      <CatalogDemo id="direction" title="Direction" description="RTL/LTR 方向 Provider，子树继承 dir 属性。">
        <DirectionProvider defaultDirection="ltr">
          <DirectionToggleDemo />
        </DirectionProvider>
      </CatalogDemo>
      </Show>
    </>
  );
}
