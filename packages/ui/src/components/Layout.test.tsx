import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutSider } from './Layout';

afterEach(() => cleanup());

describe('Layout', () => {
  it('renders compound layout regions', () => {
    render(() => (
      <Layout data-testid="layout">
        <LayoutHeader>Header</LayoutHeader>
        <LayoutSider>Sider</LayoutSider>
        <LayoutContent>Content</LayoutContent>
        <LayoutFooter>Footer</LayoutFooter>
      </Layout>
    ));

    expect(screen.getByTestId('layout')).toHaveAttribute('data-slot', 'layout');
    expect(screen.getByText('Header').closest('[data-slot="layout-header"]')).toBeTruthy();
    expect(screen.getByText('Sider').closest('[data-slot="layout-sider"]')).toBeTruthy();
    expect(screen.getByText('Content').closest('[data-slot="layout-content"]')).toBeTruthy();
    expect(screen.getByText('Footer').closest('[data-slot="layout-footer"]')).toBeTruthy();
  });
});
