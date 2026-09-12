import { createSignal, For } from 'solid-js';
import {
  Combobox,
  ComboboxControl,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  H1,
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
  Lead,
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
  Muted,
  NativeSelect,
  NativeSelectOption,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  P,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const frameworks = [
  { value: 'solid', label: 'SolidJS' },
  { value: 'react', label: 'React' },
  { value: 'vue', label: 'Vue' },
];

export function ComponentCatalogExtrasC() {
  const [framework, setFramework] = createSignal(frameworks[0]);
  const [model, setModel] = createSignal('nova');
  const [otp, setOtp] = createSignal('');

  return (
    <>
      <CatalogDemo id="combobox" title="Combobox · Command" description="可搜索选择与命令面板。">
        <div class="max-w-sm">
          <Combobox
            options={frameworks}
            optionValue="value"
            optionTextValue="label"
            value={framework()}
            onChange={setFramework}
            itemComponent={(props) => (
              <ComboboxItem item={props.item}>{props.item.rawValue.label}</ComboboxItem>
            )}
          >
            <ComboboxControl>
              <ComboboxInput aria-label="Framework" placeholder="Pick a framework" />
            </ComboboxControl>
            <ComboboxContent aria-label="Framework options" />
          </Combobox>
        </div>
        <div class="max-w-md overflow-hidden rounded-lg border border-border-subtle shadow-popover">
          <Command>
            <CommandInput placeholder="Search commands…" />
            <CommandList>
              <CommandEmpty>No commands found.</CommandEmpty>
              <CommandGroup heading="Session">
                <CommandItem value="new" keywords="create session">
                  New session
                  <CommandShortcut>⌘N</CommandShortcut>
                </CommandItem>
                <CommandItem value="search" keywords="find session">
                  Search sessions
                  <CommandShortcut>⌘K</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </CatalogDemo>

      <CatalogDemo id="menubar" title="Menubar · Navigation menu" description="桌面应用菜单与顶部导航。">
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent aria-label="File">
              <MenubarItem>New session</MenubarItem>
              <MenubarItem>Import transcript</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Edit</MenubarTrigger>
            <MenubarContent aria-label="Edit">
              <MenubarItem>Undo</MenubarItem>
              <MenubarItem>Find</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem value="product">
              <NavigationMenuTrigger>Product</NavigationMenuTrigger>
              <NavigationMenuContent aria-label="Product">
                <ul class="grid gap-8 p-12">
                  <li>
                    <NavigationMenuLink href="#/components" active>Components</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#/layers">Layers</NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem value="docs">
              <NavigationMenuTrigger>Docs</NavigationMenuTrigger>
              <NavigationMenuContent aria-label="Docs">
                <ul class="grid gap-8 p-12">
                  <li>
                    <NavigationMenuLink href="#/tokens">Tokens</NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </CatalogDemo>

      <CatalogDemo id="typography" title="Typography · Native select" description="排版原语与原生下拉。">
        <div class="flex max-w-lg flex-col gap-8">
          <H1>Design system catalog</H1>
          <Lead>Base UI primitives mirror the shadcn component inventory.</Lead>
          <P>Production widgets compose these tokens without redefining spacing or color.</P>
          <Muted>Muted helper copy for secondary metadata.</Muted>
        </div>
        <div class="max-w-xs">
          <NativeSelect aria-label="Model" value={model()} onChange={(event) => setModel(event.currentTarget.value)}>
            <NativeSelectOption value="nova">Nova 4.1</NativeSelectOption>
            <NativeSelectOption value="gpt">gpt-5.6</NativeSelectOption>
            <NativeSelectOption value="claude">Claude Opus 4.6</NativeSelectOption>
          </NativeSelect>
        </div>
      </CatalogDemo>

      <CatalogDemo id="resizable" title="Resizable · Input OTP" description="可拖拽分栏与一次性验证码输入。">
        <ResizablePanelGroup class="max-w-lg rounded-lg border border-border-subtle" style={{ height: '180px' }}>
          <ResizablePanel defaultSize={55} class="p-12 text-12 text-content-secondary">Explorer tree</ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={45} class="p-12 text-12 text-content-secondary">File preview</ResizablePanel>
        </ResizablePanelGroup>
        <DemoRow label="OTP">
          <InputOTP maxLength={6} value={otp()} onChange={setOtp}>
            <InputOTPGroup>
              <For each={[0, 1, 2]}>
                {(index) => <InputOTPSlot index={index} />}
              </For>
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <For each={[3, 4, 5]}>
                {(index) => <InputOTPSlot index={index} />}
              </For>
            </InputOTPGroup>
          </InputOTP>
          <span class="text-12 text-content-muted">{otp() || '······'}</span>
        </DemoRow>
      </CatalogDemo>
    </>
  );
}
