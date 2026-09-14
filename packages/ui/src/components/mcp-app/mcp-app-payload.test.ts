import { describe, expect, it } from 'vitest';
import {
  asCallToolResult,
  asToolInputParams,
  describeMcpAppPayload,
  mcpUiInitializeResult,
} from './mcp-app-payload';
import { mcpAppInlineMaxHeight } from './mcp-app-layout';

describe('mcpUiInitializeResult', () => {
  it('includes hostInfo.version and hostCapabilities for App Bridge', () => {
    const result = mcpUiInitializeResult('light');
    expect(result.protocolVersion).toBe('2026-01-26');
    expect(result.hostInfo).toEqual({ name: 'peri-studio', version: '0.2.0' });
    expect(result.hostCapabilities).toEqual({ openLinks: {}, serverTools: {} });
    const hostContext = result.hostContext as {
      theme: string;
      containerDimensions: { maxHeight: number; maxWidth: number };
    };
    expect(hostContext.theme).toBe('light');
    expect(hostContext.containerDimensions.maxHeight).toBe(mcpAppInlineMaxHeight());
    expect(hostContext.containerDimensions.maxWidth).toBe(720);
  });
});

describe('app bridge payloads', () => {
  it('asCallToolResult wraps strings so params stay an object', () => {
    expect(asCallToolResult('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    expect(asCallToolResult({ content: [{ type: 'text', text: 'ok' }] }).content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(asCallToolResult({ canvasId: 'c1', source: 'export default function App() { return null }' })).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ canvasId: 'c1', source: 'export default function App() { return null }' }) }],
      structuredContent: { canvasId: 'c1', source: 'export default function App() { return null }' },
    });
    expect(asCallToolResult(null)).toEqual({ content: [] });
  });

  it('describeMcpAppPayload reports source length without dumping TSX', () => {
    const source = 'export default function App() { return null }';
    expect(describeMcpAppPayload({
      content: [{ type: 'text', text: 'Canvas ready' }],
      structuredContent: { canvasId: 'c1', source },
    })).toMatchObject({
      present: true,
      hasStructuredContent: true,
      sourceChars: source.length,
      firstTextChars: 12,
    });
    expect(JSON.stringify(describeMcpAppPayload({
      content: [{ type: 'text', text: 'Canvas ready' }],
      structuredContent: { canvasId: 'c1', source },
    }))).not.toContain('export default');
  });

  it('asToolInputParams always returns an arguments object', () => {
    expect(asToolInputParams({ city: 'SF' })).toEqual({ arguments: { city: 'SF' } });
    expect(asToolInputParams('x')).toEqual({ arguments: {} });
  });
});
