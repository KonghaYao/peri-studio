import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockBody,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from './CodeBlock';
import { Snippet } from './Snippet';

afterEach(() => {
  cleanup();
});

describe('CodeBlock', () => {
  it('renders language label, copy button, and code body by default', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(() => (
      <CodeBlock code={'const answer = 42;\n'} language="typescript" />
    ));

    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="code-block-body"]')).toHaveTextContent(
      'const answer = 42;',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42;'));
  });

  it('supports composable header and optional line numbers', () => {
    render(() => (
      <CodeBlock code={'line one\nline two'}>
        <CodeBlockHeader>
          <CodeBlockTitle language="rust" />
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockBody showLineNumbers startLine={10} />
      </CodeBlock>
    ));

    expect(screen.getByText('Rust')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('line two')).toBeInTheDocument();
  });
});

describe('Snippet', () => {
  it('renders compact code with prefix and copy action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(() => <Snippet code="npx ai-elements add snippet" prefix="$" />);

    expect(screen.getByDisplayValue('npx ai-elements add snippet')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('npx ai-elements add snippet'),
    );
  });
});
