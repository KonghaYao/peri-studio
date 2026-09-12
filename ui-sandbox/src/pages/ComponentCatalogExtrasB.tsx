import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AspectRatio,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ScrollArea,
  ScrollAreaViewport,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@peri/ui';
import { Search } from 'lucide-solid';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasB(props: { sections?: string[] }) {
  const [alertOpen, setAlertOpen] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'breadcrumb')}>
      <CatalogDemo id="breadcrumb" title="Breadcrumb · Pagination · Aspect ratio" description="导航路径、分页与固定宽高比容器。">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#/components-shell">Shell</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#/components-forms">Forms</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Navigation</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#" isActive>1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">2</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">3</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <AspectRatio ratio={16 / 9} class="max-w-md overflow-hidden rounded-lg border border-border-subtle bg-surface-muted">
          <div class="grid h-full place-items-center text-12 text-content-muted">16:9 preview frame</div>
        </AspectRatio>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'overlay')}>
      <CatalogDemo id="overlay" title="Alert dialog · Sheet" description="破坏性确认与侧滑抽屉。">
        <DemoRow>
          <AlertDialog open={alertOpen()} onOpenChange={setAlertOpen}>
            <AlertDialogTrigger as={Button} variant="danger" size="sm">Delete project</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                <AlertDialogDescription>
                  Sessions stay archived for 30 days. This action cannot be undone from the sidebar.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="danger">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Sheet open={sheetOpen()} onOpenChange={setSheetOpen}>
            <SheetTrigger as={Button} variant="default" size="sm">Open sheet</SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Session filters</SheetTitle>
                <SheetDescription>Filter the sidebar list without leaving the current chat.</SheetDescription>
              </SheetHeader>
              <p class="px-16 py-12 text-13 text-content-secondary">Sheet content uses drawer width tokens.</p>
            </SheetContent>
          </Sheet>
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'menus')}>
      <CatalogDemo id="menus" title="Context menu · Hover card · Scroll area" description="右键菜单、悬停卡片与滚动容器。">
        <ContextMenu>
          <ContextMenuTrigger class="inline-flex rounded-md border border-border-subtle px-12 py-8 text-12 text-content-secondary">
            Right-click me
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Copy path</ContextMenuItem>
            <ContextMenuItem>Reveal in explorer</ContextMenuItem>
            <ContextMenuItem class="text-danger-solid">Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <HoverCard>
          <HoverCardTrigger as={Button} variant="ghost" size="sm">Hover for details</HoverCardTrigger>
          <HoverCardContent>
            <p class="text-13 font-medium text-content-primary">Instance heartbeat</p>
            <p class="mt-8 text-12 leading-normal text-content-secondary">Last seen 12s ago on the local connect role.</p>
          </HoverCardContent>
        </HoverCard>
        <ScrollArea class="h-120 max-w-sm rounded-lg border border-border-subtle">
          <ScrollAreaViewport class="p-12">
            <p class="text-12 text-content-secondary">
              Scroll areas keep long catalog notes readable without stretching the page layout.
              {' '}
              Repeat this line several times to demonstrate overflow.
              {' '}
              Repeat this line several times to demonstrate overflow.
              {' '}
              Repeat this line several times to demonstrate overflow.
            </p>
          </ScrollAreaViewport>
        </ScrollArea>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'input-group')}>
      <CatalogDemo id="input-group" title="Input group" description="前缀/后缀 addon 与组内按钮。">
        <div class="max-w-md">
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>https://</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput placeholder="peri.example" aria-label="Host" />
          </InputGroup>
        </div>
        <div class="max-w-md">
          <InputGroup>
            <InputGroupInput placeholder="Search sessions" aria-label="Search sessions" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label="Search">
                <Search size={14} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
