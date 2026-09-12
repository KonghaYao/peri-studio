import { FolderOpen } from 'lucide-solid';
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
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
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'empty')}>
      <CatalogDemo id="empty" title="Empty" description="Compound 空状态：媒体、标题、描述与操作区。">
        <Empty class="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen class="size-24" />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              You have not created any projects. Get started with your first workspace.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="primary" size="sm">New project</Button>
          </EmptyContent>
        </Empty>
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

      <Show when={showCatalogSection(props.sections, 'sidebar')}>
      <CatalogDemo id="sidebar" title="Sidebar" description="应用壳侧栏：Provider、菜单、折叠与 Cmd/Ctrl+B。">
        <SidebarProvider defaultOpen>
          <div class="flex min-h-280 overflow-hidden rounded-8 border border-border-subtle">
            <Sidebar collapsible="icon" class="border-r border-border-faint">
              <SidebarHeader class="border-b border-border-faint px-12 py-10">
                <span class="text-12 font-semibold text-content-primary">Peri Studio</span>
              </SidebarHeader>
              <SidebarRail />
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>Projects</SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>Sessions</SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>Settings</SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
            <SidebarInset class="p-12">
              <div class="flex items-center gap-8">
                <SidebarTrigger />
                <span class="text-13 text-content-secondary">Main content · Cmd/Ctrl+B toggles</span>
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
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
