import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  sidebarMistDividerClass,
  sidebarScrollMistClass,
} from './sidebar-layout';
import { ProjectSidebarShell } from './ProjectSidebarShell';

afterEach(() => cleanup());

describe('ProjectSidebarShell', () => {
  it('renders navbar, body, and footer slots in standalone mode', () => {
    render(() => (
      <ProjectSidebarShell
        data-testid="project-sidebar"
        navbar={<div data-testid="navbar">Nav</div>}
        body={<div data-testid="body">Tree</div>}
        footer={<div data-testid="footer">Footer</div>}
      />
    ));

    const shell = screen.getByTestId('project-sidebar');
    expect(shell.tagName).toBe('NAV');
    expect(shell).toHaveClass('ui-project-sidebar-shell', 'project-sidebar');
    expect(screen.getByTestId('titlebar-drag-sidebar')).toHaveClass('ui-titlebar-drag', 'ui-titlebar-overlay', 'pl-titlebar-gutter');
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    expect(shell.querySelector(`.${sidebarScrollMistClass.split(' ')[0]}`)).not.toBeNull();
    expect(shell.querySelector(`.${sidebarMistDividerClass.split(' ')[0]}`)).not.toBeNull();
  });

  it('omits footer chrome when footer slot is absent', () => {
    render(() => (
      <ProjectSidebarShell
        body={<div data-testid="body">Tree</div>}
      />
    ));

    expect(screen.getByTestId('body')).toBeInTheDocument();
    expect(document.querySelector(`.${sidebarMistDividerClass.split(' ')[0]}`)).toBeNull();
    expect(document.querySelector('.sidebar-footer')).toBeNull();
  });

  it('renders embedded regions without outer nav wrapper', () => {
    render(() => (
      <div data-testid="host">
        <ProjectSidebarShell
          embedded
          navbar={<div data-testid="navbar">Nav</div>}
          body={<div data-testid="body">Tree</div>}
        />
      </div>
    ));

    expect(screen.getByTestId('host').querySelector('nav')).toBeNull();
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });
});
