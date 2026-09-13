import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Affix,
  Anchor,
  Button,
  Card,
  CardContent,
  Col,
  Divider,
  Flex,
  BackToTop,
  FloatButton,
  FloatButtonBackTop,
  Layout,
  Masonry,
  Row,
  Space,
  Steps,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasLayout(props: { sections?: string[] }) {
  const [step, setStep] = createSignal(1);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'flex')}>
        <CatalogDemo id="flex" title="Flex" description="Ant Design 对齐的 flex 容器：方向、对齐、间距与换行。">
          <DemoRow label="Horizontal">
            <Flex gap="middle" class="w-full rounded-8 border border-border-subtle bg-surface-sunken p-12">
              <Button size="sm">One</Button>
              <Button size="sm">Two</Button>
              <Button size="sm">Three</Button>
            </Flex>
          </DemoRow>
          <DemoRow label="Vertical">
            <Flex vertical gap="small" class="rounded-8 border border-border-subtle bg-surface-sunken p-12">
              <Button size="sm" variant="default">Top</Button>
              <Button size="sm" variant="default">Bottom</Button>
            </Flex>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'grid')}>
        <CatalogDemo id="grid" title="Grid" description="24 栏 Row / Col，支持 gutter 与 span。">
          <Row gutter="middle">
            <Col span={12}>
              <Card><CardContent class="p-12 text-13">span 12</CardContent></Card>
            </Col>
            <Col span={12}>
              <Card><CardContent class="p-12 text-13">span 12</CardContent></Card>
            </Col>
            <Col span={8}>
              <Card><CardContent class="p-12 text-13">span 8</CardContent></Card>
            </Col>
            <Col span={8}>
              <Card><CardContent class="p-12 text-13">span 8</CardContent></Card>
            </Col>
            <Col span={8}>
              <Card><CardContent class="p-12 text-13">span 8</CardContent></Card>
            </Col>
          </Row>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'layout')}>
        <CatalogDemo id="layout" title="Layout" description="Header / Sider / Content / Footer 经典后台布局。">
          <Layout class="min-h-240 overflow-hidden rounded-8 border border-border-subtle">
            <Layout.Header>Header</Layout.Header>
            <Layout>
              <Layout.Sider width={160}>Sider</Layout.Sider>
              <Layout.Content>
                <p class="text-13 text-content-secondary">Main content area</p>
              </Layout.Content>
            </Layout>
            <Layout.Footer>Footer</Layout.Footer>
          </Layout>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'space')}>
        <CatalogDemo id="space" title="Space" description="水平/垂直间距、分隔符与 compact 密度。">
          <DemoRow label="Horizontal">
            <Space size="middle">
              <Button size="sm">Save</Button>
              <Button size="sm" variant="default">Cancel</Button>
            </Space>
          </DemoRow>
          <DemoRow label="With divider">
            <Space separator={<Divider orientation="vertical" class="h-16" />}>
              <span class="text-13">Docs</span>
              <span class="text-13">API</span>
              <span class="text-13">Changelog</span>
            </Space>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'masonry')}>
        <CatalogDemo id="masonry" title="Masonry" description="瀑布流分栏布局。">
          <Masonry
            columns={3}
            gutter="middle"
            items={[
              { key: 1, children: <Card><CardContent class="p-12 text-13">Short card</CardContent></Card> },
              {
                key: 2,
                children: (
                  <Card>
                    <CardContent class="p-12 text-13">
                      Taller card with more copy to demonstrate uneven column heights in the waterfall layout.
                    </CardContent>
                  </Card>
                ),
              },
              { key: 3, children: <Card><CardContent class="p-12 text-13">Medium</CardContent></Card> },
              { key: 4, children: <Card><CardContent class="p-12 text-13">Another</CardContent></Card> },
            ]}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'affix')}>
        <CatalogDemo id="affix" title="Affix" description="滚动到阈值后固定定位。">
          <div class="max-h-160 overflow-y-auto rounded-8 border border-border-subtle bg-surface-sunken p-12">
            <Affix offsetTop={8} target={() => document.querySelector('#affix-scroll') as HTMLElement}>
              <Button size="sm" variant="primary">Affixed action</Button>
            </Affix>
            <div id="affix-scroll" class="h-240 pt-80">
              <p class="text-13 text-content-secondary">Scroll inside this panel to see affix behavior.</p>
            </div>
          </div>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'anchor')}>
        <CatalogDemo id="anchor" title="Anchor" description="章节锚点导航与滚动联动。">
          <div class="grid grid-cols-split-auto gap-16">
            <Anchor
              affix={false}
              class="sticky top-0 self-start"
              items={[
                { href: '#anchor-a', title: 'Section A' },
                { href: '#anchor-b', title: 'Section B' },
              ]}
            />
            <div class="flex flex-col gap-24">
              <section id="anchor-a" class="rounded-8 border border-border-subtle p-12 text-13">Section A content</section>
              <section id="anchor-b" class="rounded-8 border border-border-subtle p-12 text-13">Section B content</section>
            </div>
          </div>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'steps')}>
        <CatalogDemo id="steps" title="Steps" description="水平/垂直步骤条，含 dot 变体。">
          <DemoRow label="Horizontal">
            <Steps
              class="max-w-lg"
              current={step()}
              onChange={setStep}
              items={[
                { title: 'Create', description: 'Project shell' },
                { title: 'Configure', description: 'Instances' },
                { title: 'Launch', description: 'Go live' },
              ]}
            />
          </DemoRow>
          <DemoRow label="Dot variant">
            <Steps
              variant="dot"
              current={2}
              items={[
                { title: 'Queued' },
                { title: 'Running' },
                { title: 'Done', status: 'finish' },
              ]}
            />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'back-to-top')}>
        <CatalogDemo id="back-to-top" title="BackToTop" description="Chat 受控回到最新消息锚点（非页面级 FloatButton.BackTop）。">
          <div class="relative h-120 overflow-hidden rounded-8 border border-border-subtle bg-surface-sunken">
            <BackToTop />
          </div>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'float-button')}>
        <CatalogDemo id="float-button" title="FloatButton" description="悬浮操作按钮、分组与回到顶部。">
          <DemoRow label="Primary">
            <FloatButton variant="primary" shape="circle" icon={<span class="text-16">+</span>} aria-label="Add" />
          </DemoRow>
          <DemoRow label="Group">
            <FloatButton.Group trigger="click">
              <FloatButton content="Docs" aria-label="Docs" />
              <FloatButton content="Help" aria-label="Help" />
            </FloatButton.Group>
          </DemoRow>
          <DemoRow label="Back top">
            <div id="float-scroll-panel" class="relative h-120 w-full overflow-y-auto rounded-8 border border-border-subtle bg-surface-sunken p-12">
              <p class="text-13 text-content-secondary">Scroll to reveal back-to-top.</p>
              <div class="h-240" />
              <FloatButtonBackTop
                target={() => document.getElementById('float-scroll-panel') as HTMLElement}
                visibilityHeight={40}
              />
            </div>
          </DemoRow>
        </CatalogDemo>
      </Show>
    </>
  );
}
