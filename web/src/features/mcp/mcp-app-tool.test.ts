import { describe, expect, it } from 'vitest';
import type { ToolCallInfo } from '@/entities/chat/chat-view';
import {
  extractMcpAppEffectiveName,
  isMcpAppTool,
  mcpServerHasShowCanvasDemo,
  parseMcpAppToolFromCall,
  parseMcpAppToolName,
  unwrapMcpAppToolArguments,
  validateMcpAppReopenArguments,
} from './mcp-app-tool';

const CANVAS_SOURCE = 'import { Stack } from "peri/canvas";\n\nexport default function App() { return null; }';

type ReopenToolInput = Partial<Pick<ToolCallInfo, 'content' | 'result' | 'name'>> &
  Pick<ToolCallInfo, 'arguments' | 'argumentsOmitted'>;

function reopenTool(
  partial: ReopenToolInput,
): Pick<ToolCallInfo, 'arguments' | 'argumentsOmitted' | 'content' | 'result' | 'name'> {
  return { name: null, result: null, ...partial };
}

describe('mcp-app-tool', () => {
  it('parses canonical MCP effective names', () => {
    expect(parseMcpAppToolName('mcp__cursor-canvas__show_canvas')).toEqual({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
    });
    expect(parseMcpAppToolName('compact')).toBeNull();
    expect(isMcpAppTool({ name: 'Read' })).toBe(false);
  });

  it('extracts MCP names from Cursor execute-extra-tool titles', () => {
    const wrapped = 'execute extra tool `mcp__cursor-canvas__show_canvas`';
    expect(extractMcpAppEffectiveName(wrapped)).toBe('mcp__cursor-canvas__show_canvas');
    expect(parseMcpAppToolName(wrapped)).toEqual({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
    });
    expect(isMcpAppTool({ name: wrapped })).toBe(true);
  });

  it('parses MCP tools from extra-tool argument envelopes', () => {
    expect(parseMcpAppToolFromCall({
      name: 'execute extra tool',
      arguments: {
        name: 'mcp__cursor-canvas__show_canvas',
        arguments: { source: 'export default function App() { return null; }' },
      },
    })).toEqual({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
    });
    expect(parseMcpAppToolFromCall({
      name: 'CallMcpTool',
      arguments: { server: 'cursor-canvas', toolName: 'show_canvas', arguments: { source: 'x' } },
    })).toEqual({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
    });
  });

  it('unwraps extra-tool envelopes before reopen validation', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const nested = {
      name: 'mcp__cursor-canvas__show_canvas',
      arguments: { source: 'export default function App() { return null; }' },
    };
    expect(unwrapMcpAppToolArguments(nested)).toEqual({
      source: 'export default function App() { return null; }',
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: nested, argumentsOmitted: false }))).toEqual({
      ok: true,
      arguments: { source: 'export default function App() { return null; }' },
    });
  });

  it('recursively unwraps double-nested execute-extra-tool envelopes', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const doubleWrapped = {
      name: 'execute extra tool',
      arguments: {
        name: 'mcp__cursor-canvas__show_canvas',
        arguments: { source: 'export default function App() { return null; }' },
      },
    };
    expect(unwrapMcpAppToolArguments(doubleWrapped)).toEqual({
      source: 'export default function App() { return null; }',
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: doubleWrapped, argumentsOmitted: false }))).toEqual({
      ok: true,
      arguments: { source: 'export default function App() { return null; }' },
    });
  });

  it('unwraps rawInput nested envelopes from ACP projection', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const rawInputEnvelope = {
      name: 'mcp__cursor-canvas__show_canvas',
      rawInput: { source: 'export default function App() { return null; }' },
    };
    expect(unwrapMcpAppToolArguments(rawInputEnvelope)).toEqual({
      source: 'export default function App() { return null; }',
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: rawInputEnvelope, argumentsOmitted: false }))).toEqual({
      ok: true,
      arguments: { source: 'export default function App() { return null; }' },
    });
  });

  it('unwraps Peri ExecuteExtraTool { tool_name, params } from ACP/Yjs arguments', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const executeExtraTool = {
      tool_name: 'mcp__cursor-canvas__show_canvas',
      params: {
        title: 'cursor-canvas hello',
        canvasId: 'cursor-canvas-hello',
        source: CANVAS_SOURCE,
      },
    };
    expect(unwrapMcpAppToolArguments(executeExtraTool)).toEqual({
      title: 'cursor-canvas hello',
      canvasId: 'cursor-canvas-hello',
      source: CANVAS_SOURCE,
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({
      arguments: executeExtraTool,
      argumentsOmitted: false,
    }))).toEqual({
      ok: true,
      arguments: {
        title: 'cursor-canvas hello',
        canvasId: 'cursor-canvas-hello',
        source: CANVAS_SOURCE,
      },
    });
  });

  it('unwraps stringified ExecuteExtraTool params JSON', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const stringified = {
      tool_name: 'mcp__cursor-canvas__show_canvas',
      params: JSON.stringify({ source: CANVAS_SOURCE, title: 'cursor-canvas hello' }),
    };
    expect(unwrapMcpAppToolArguments(stringified)).toEqual({
      source: CANVAS_SOURCE,
      title: 'cursor-canvas hello',
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: stringified, argumentsOmitted: false }))).toEqual({
      ok: true,
      arguments: { source: CANVAS_SOURCE, title: 'cursor-canvas hello' },
    });
    const whole = JSON.stringify({
      tool_name: 'mcp__cursor-canvas__show_canvas',
      params: { source: CANVAS_SOURCE },
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: whole, argumentsOmitted: false }))).toEqual({
      ok: true,
      arguments: { source: CANVAS_SOURCE },
    });
  });

  it('unwraps extra envelope and toolName/input extra-tool shapes', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const extraEnvelope = {
      extra: { source: CANVAS_SOURCE, canvasId: 'c1' },
    };
    const inputEnvelope = {
      toolName: 'mcp__cursor-canvas__show_canvas',
      input: { source: CANVAS_SOURCE },
    };
    expect(unwrapMcpAppToolArguments(extraEnvelope)).toEqual({ source: CANVAS_SOURCE, canvasId: 'c1' });
    expect(unwrapMcpAppToolArguments(inputEnvelope)).toEqual({ source: CANVAS_SOURCE });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: extraEnvelope, argumentsOmitted: false })).ok).toBe(true);
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: inputEnvelope, argumentsOmitted: false })).ok).toBe(true);
  });

  it('reconstructs show_canvas source from result structuredContent when input is empty', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    expect(validateMcpAppReopenArguments(parsed, reopenTool({
      arguments: { tool_name: 'mcp__cursor-canvas__show_canvas', params: {} },
      argumentsOmitted: false,
      result: { structuredContent: { source: CANVAS_SOURCE, canvasId: 'c1' } },
    }))).toEqual({
      ok: true,
      arguments: { source: CANVAS_SOURCE },
    });
  });

  it('reopen validation only fails when show_canvas source is truly missing', () => {
    const parsed = { serverId: 'cursor-canvas', toolName: 'show_canvas' };
    const emptyEnvelope = {
      name: 'mcp__cursor-canvas__show_canvas',
      arguments: {},
    };
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: emptyEnvelope, argumentsOmitted: false }))).toEqual({
      ok: false,
      message: 'Missing canvas source in tool arguments. Present keys: arguments, name.',
      presentKeys: ['arguments', 'name'],
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({ arguments: {}, argumentsOmitted: true }))).toEqual({
      ok: false,
      message: 'Missing canvas source in tool arguments. Present keys: (none).',
      presentKeys: [],
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({
      arguments: {
        tool_name: 'mcp__cursor-canvas__show_canvas',
        params: { title: 'cursor-canvas hello', canvasId: 'cursor-canvas-hello' },
      },
      argumentsOmitted: false,
    }))).toEqual({
      ok: false,
      message: 'Missing canvas source in tool arguments. Present keys: params, tool_name.',
      presentKeys: ['params', 'tool_name'],
    });
    expect(validateMcpAppReopenArguments(parsed, reopenTool({
      arguments: { source: 'export default function App() { return null; }' },
      argumentsOmitted: true,
    }))).toEqual({
      ok: true,
      arguments: { source: 'export default function App() { return null; }' },
    });
    expect(mcpServerHasShowCanvasDemo('cursor-canvas', [
      { name: 'cursor-canvas', toolsCount: 3 },
    ])).toBe(true);
    expect(mcpServerHasShowCanvasDemo('cursor-canvas', [
      { name: 'cursor-canvas', toolsCount: 1 },
    ])).toBe(false);
  });
});
