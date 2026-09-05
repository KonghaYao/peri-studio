import { describe, expect, it, afterEach } from 'vitest';
import {
  WORKBENCH_PANEL_DEFAULT_WIDTH,
  WORKBENCH_PANEL_GRAPH_DEFAULT_WIDTH,
  WORKBENCH_PANEL_GRAPH_MAX_WIDTH,
  WORKBENCH_PANEL_GRAPH_MIN_WIDTH,
  WORKBENCH_PANEL_GRAPH_WIDTH_STORAGE_KEY,
  WORKBENCH_PANEL_MAX_WIDTH,
  WORKBENCH_PANEL_MIN_WIDTH,
  WORKBENCH_PANEL_PREVIEW_DEFAULT_WIDTH,
  WORKBENCH_PANEL_PREVIEW_WIDTH_STORAGE_KEY,
  WORKBENCH_PANEL_WIDTH_STORAGE_KEY,
  clampWorkbenchPanelWidth,
  persistWorkbenchPanelWidth,
  readStoredWorkbenchPanelWidth,
  workbenchFilePreviewLeftOffset,
  WORKBENCH_PANEL_EDGE_INSET,
} from './resource-panel-layout';

describe('resource-panel-layout', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('clamps workbench panel width', () => {
    expect(clampWorkbenchPanelWidth(100)).toBe(WORKBENCH_PANEL_MIN_WIDTH);
    expect(clampWorkbenchPanelWidth(999)).toBe(WORKBENCH_PANEL_MAX_WIDTH);
    expect(clampWorkbenchPanelWidth(300)).toBe(300);
  });

  it('clamps graph panel width with wider bounds', () => {
    expect(clampWorkbenchPanelWidth(300, 'graph')).toBe(WORKBENCH_PANEL_GRAPH_MIN_WIDTH);
    expect(clampWorkbenchPanelWidth(999, 'graph')).toBe(WORKBENCH_PANEL_GRAPH_MAX_WIDTH);
    expect(clampWorkbenchPanelWidth(500, 'graph')).toBe(500);
  });

  it('reads and persists panel width in sessionStorage', () => {
    expect(readStoredWorkbenchPanelWidth()).toBe(WORKBENCH_PANEL_DEFAULT_WIDTH);
    persistWorkbenchPanelWidth(400);
    expect(sessionStorage.getItem(WORKBENCH_PANEL_WIDTH_STORAGE_KEY)).toBe('400');
    expect(readStoredWorkbenchPanelWidth()).toBe(400);
    persistWorkbenchPanelWidth(999);
    expect(readStoredWorkbenchPanelWidth()).toBe(WORKBENCH_PANEL_MAX_WIDTH);
  });

  it('reads and persists graph panel width separately', () => {
    expect(readStoredWorkbenchPanelWidth('graph')).toBe(WORKBENCH_PANEL_GRAPH_DEFAULT_WIDTH);
    persistWorkbenchPanelWidth(520, 'graph');
    expect(sessionStorage.getItem(WORKBENCH_PANEL_GRAPH_WIDTH_STORAGE_KEY)).toBe('520');
    expect(readStoredWorkbenchPanelWidth('graph')).toBe(520);
    expect(readStoredWorkbenchPanelWidth()).toBe(WORKBENCH_PANEL_DEFAULT_WIDTH);
  });

  it('ignores invalid stored width', () => {
    sessionStorage.setItem(WORKBENCH_PANEL_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(readStoredWorkbenchPanelWidth()).toBe(WORKBENCH_PANEL_DEFAULT_WIDTH);
  });

  it('offsets left file preview past the sidebar inset', () => {
    expect(workbenchFilePreviewLeftOffset(242)).toBe(242 + WORKBENCH_PANEL_EDGE_INSET);
  });

  it('reads and persists preview panel width separately', () => {
    expect(readStoredWorkbenchPanelWidth('preview')).toBe(WORKBENCH_PANEL_PREVIEW_DEFAULT_WIDTH);
    persistWorkbenchPanelWidth(600, 'preview');
    expect(sessionStorage.getItem(WORKBENCH_PANEL_PREVIEW_WIDTH_STORAGE_KEY)).toBe('600');
    expect(readStoredWorkbenchPanelWidth('preview')).toBe(600);
  });
});
