import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockTitle,
} from './CodeBlock';
import { Snippet, SnippetAddon, SnippetCopyButton, SnippetInput, SnippetText } from './Snippet';

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
      <CodeBlock code={'const answer = 42;\n'} language="typescript" filename="src/answer.ts" />
    ));

    expect(screen.getByText('answer.ts')).toBeInTheDocument();
    expect(document.querySelector('[data-file-icon="typescript"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="code-block-body"]')).toHaveTextContent(
      'const answer = 42;',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42;'));
  });

  it('supports composable header, language selector, and line numbers', () => {
    const [language, setLanguage] = createSignal('rust');

    render(() => (
      <CodeBlock code={'line one\nline two'} language={language()} showLineNumbers startLine={10}>
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename path="src/example.rs" />
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockLanguageSelector
              aria-label="Language"
              value={language()}
              onChange={setLanguage}
              options={[
                { value: 'rust', label: 'Rust' },
                { value: 'typescript', label: 'TypeScript' },
              ]}
            />
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    ));

    expect(screen.getByText('example.rs')).toBeInTheDocument();
    expect(document.querySelector('[data-file-icon="rust"]')).toBeInTheDocument();
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

  it('supports composable install command layout', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(() => (
      <Snippet code="bun add @peri/ui">
        <SnippetAddon>
          <SnippetText>$</SnippetText>
        </SnippetAddon>
        <SnippetInput />
        <SnippetAddon align="inline-end">
          <SnippetCopyButton />
        </SnippetAddon>
      </Snippet>
    ));

    expect(screen.getByDisplayValue('bun add @peri/ui')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('bun add @peri/ui'));
  });
});
