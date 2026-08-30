import { afterEach, describe, expect, it } from 'vitest';
import { chatEntries, chatHead, elicitations, permissions, projects, projectSessions, registryHydrated, selectedCid, selectedSessionId } from '../panel/store';
import { principalRole } from '../panel/lib/auth-state';
import { composerAssets } from '../panel/lib/composer-assets';
import * as store from '../panel/store';
import { DEFAULT_VISUAL_SCENARIO, installVisualScenario, resolveVisualScenario, VISUAL_NOW, visualScenarios } from './scenarios';

let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; });

describe('visual fixture scenarios', () => {
  it('falls back to the complete conversation and scopes its fixed clock', () => {
    const originalNow = Date.now;
    expect(resolveVisualScenario('unknown')).toBe(DEFAULT_VISUAL_SCENARIO);
    const installed = installVisualScenario('unknown');
    dispose = installed.dispose;
    expect(installed.scenario.id).toBe('conversation');
    expect(Date.now()).toBe(VISUAL_NOW);
    expect(projects().length).toBeGreaterThan(1);
    expect(registryHydrated()).toBe(true);
    expect(selectedSessionId()).toBe('acp-thread-01J5WORLDCLASSCURRENT');
    expect(selectedCid()).toBe('chat-current');
    expect(chatEntries()).toHaveLength(2);
    expect(chatEntries()[0].text).toContain('login page build failure');
    installed.dispose(); dispose = null;
    expect(Date.now).toBe(originalNow);
  });

  it('covers permissions and closed-by-default read-only state', () => {
    expect(visualScenarios.map((item) => item.id)).toEqual([
      'conversation', 'long-conversation', 'markdown', 'tools', 'permission-streaming',
      'elicitation', 'subtasks', 'resources', 'assets', 'terminal-readonly', 'catalog', 'design-tokens',
    ]);
    let installed = installVisualScenario('terminal-readonly');
    dispose = installed.dispose;
    expect(principalRole()).toBe('read-only');
    expect(projectSessions().some((session) => !!session.archivedAt)).toBe(true);
  });

  it('contains only synthetic workspace facts and no credential material', () => {
    const installed = installVisualScenario('conversation');
    dispose = installed.dispose;
    const serialized = JSON.stringify({ projects: projects(), sessions: projectSessions(), entries: chatEntries() });
    expect(serialized).not.toMatch(/bearer|access[_ -]?token|cookie|tokens\.toml|\/Users\//i);
    expect(new Set(projectSessions().map((item) => item.id)).size).toBe(projectSessions().length);
  });

  it('installs concrete examples for the added capability catalog', () => {
    let installed = installVisualScenario('long-conversation');
    expect(chatEntries()).toHaveLength(36);
    expect(chatEntries().flatMap((entry) => entry.toolCalls).length).toBeGreaterThanOrEqual(72);
    expect(chatEntries().filter((entry) => entry.role === 'assistant').every((entry) => entry.text.includes('| Boundary |'))).toBe(true);
    installed.dispose();

    installed = installVisualScenario('tools');
    expect(chatEntries().flatMap((entry) => entry.toolCalls)).toHaveLength(4);
    expect(chatEntries().flatMap((entry) => entry.toolCalls).map((tool) => tool.status)).toEqual(['completed', 'completed', 'running', 'failed']);
    installed.dispose();

    installed = installVisualScenario('subtasks');
    expect(chatHead()?.agent?.activities).toHaveLength(3);
    expect(chatHead()?.agent?.activities.map((activity) => activity.status)).toEqual(['completed', 'running', 'info']);
    installed.dispose();

    installed = installVisualScenario('assets');
    expect(chatEntries()[0].text).toContain('```mermaid');
    expect(chatEntries()[0].resources).toHaveLength(1);
    expect(composerAssets()).toHaveLength(3);
    installed.dispose();
  });

  it('always releases the fixture clock when scenario cleanup is repeated', () => {
    const hostNow = Date.now;
    const installed = installVisualScenario('catalog');
    installed.dispose();
    installed.dispose();
    expect(Date.now).toBe(hostNow);
  });

  it('releases the clock if fixture initialization throws', () => {
    const hostNow = Date.now;
    const originalReset = store.resetAuthenticatedSession;
    Object.defineProperty(store, 'resetAuthenticatedSession', { value: () => { throw new Error('fixture setup failed'); }, configurable: true });
    try {
      expect(() => installVisualScenario('catalog')).toThrow('fixture setup failed');
      expect(Date.now).toBe(hostNow);
    } finally {
      Object.defineProperty(store, 'resetAuthenticatedSession', { value: originalReset, configurable: true });
    }
  });

  it('installs and completely disposes every scenario without state leakage', () => {
    const hostNow = Date.now;
    for (const scenario of visualScenarios) {
      const installed = installVisualScenario(scenario.id);
      expect(projects().length).toBe(3);
      if (scenario.id === 'catalog') {
        expect(selectedSessionId()).toBeNull();
        expect(selectedCid()).toBeNull();
      }
      if (scenario.id === 'permission-streaming') {
        expect(chatHead()?.activeTurn?.turnStatus).toBe('awaitingPermission');
        expect(permissions()).toHaveLength(2);
        expect(elicitations()).toEqual([expect.objectContaining({
          elicitationId: 'elicitation-safe-plan',
          status: 'pending',
        })]);
        expect(chatEntries().some((entry) => entry.status === 'streaming')).toBe(true);
      }
      if (scenario.id === 'elicitation') {
        expect(permissions()).toEqual([]);
        expect(elicitations()).toHaveLength(2);
      }
      installed.dispose();
      expect(projects()).toEqual([]);
      expect(projectSessions()).toEqual([]);
      expect(registryHydrated()).toBe(false);
      expect(selectedSessionId()).toBeNull();
      expect(selectedCid()).toBeNull();
      expect(elicitations()).toEqual([]);
      expect(Date.now).toBe(hostNow);
    }
  });
});
