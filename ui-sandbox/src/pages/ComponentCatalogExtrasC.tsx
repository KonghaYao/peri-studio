import { createSignal, For, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
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
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
  NativeSelect,
  NativeSelectOption,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
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

export function ComponentCatalogExtrasC(props: { sections?: string[] }) {
  const [framework, setFramework] = createSignal(frameworks[0]);
  const [model, setModel] = createSignal('nova');
  const [otp, setOtp] = createSignal('');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'combobox')}>
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
        <div class="max-w-md">
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
      </Show>

      <Show when={showCatalogSection(props.sections, 'menubar')}>
      <CatalogDemo id="menubar" title="Menubar · Navigation menu" description="桌面应用菜单与顶部导航。">
        <div class="flex flex-col items-start gap-12">
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
                  <li>
                    <NavigationMenuLink href="#/components-overlays" active>Overlays</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#/components-explorer">Explorer</NavigationMenuLink>
                  </li>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem value="docs">
                <NavigationMenuTrigger>Docs</NavigationMenuTrigger>
                <NavigationMenuContent aria-label="Docs">
                  <li>
                    <NavigationMenuLink href="#/tokens">Tokens</NavigationMenuLink>
                  </li>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'native-select')}>
      <CatalogDemo id="native-select" title="Native select" description="原生下拉，用于简单选项与模型切换。">
        <div class="max-w-xs">
          <NativeSelect aria-label="Model" value={model()} onChange={(event) => setModel(event.currentTarget.value)}>
            <NativeSelectOption value="nova">Nova 4.1</NativeSelectOption>
            <NativeSelectOption value="gpt">gpt-5.6</NativeSelectOption>
            <NativeSelectOption value="claude">Claude Opus 4.6</NativeSelectOption>
          </NativeSelect>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'resizable')}>
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
      </Show>
    </>
  );
}
