import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { HighlightedCodeBody } from '@/components/code/HighlightedCodeBody';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockTitle,
} from '@peri/ui';
import { CatalogDemo } from '@/pages/shared/DemoSection';

const CODE_SAMPLES = {
  typescript: `export async function waitUntilReady(baseUrl: string) {
  const response = await fetch(\`\${baseUrl}/api/health\`);
  if (!response.ok) throw new Error('server not ready');
  return response.json();
}`,
  rust: `pub fn recover(session_id: &str) -> Result<(), Error> {
    let runtime = session::load(session_id)?;
    runtime.wait_until_ready()?;
    Ok(())
}`,
  bash: `#!/usr/bin/env bash
set -euo pipefail
bun run test
./dev.sh`,
} as const;

type DemoLanguage = keyof typeof CODE_SAMPLES;

export function ComponentCatalogExtrasCode(props: { sections?: string[] }) {
  const [language, setLanguage] = createSignal<DemoLanguage>('typescript');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'code-block-default')}>
      <CatalogDemo
        id="code-block-default"
        title="Default"
        description="language + code 即出默认 header 与复制按钮。"
      >
        <CodeBlock
          code={'const answer = 42;\n'}
          language="typescript"
        />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block-composable')}>
      <CatalogDemo
        id="code-block-composable"
        title="Composable header"
        description="自定义标题行：语言标签、文件名、语言切换与复制。"
      >
        <CodeBlock
          code={CODE_SAMPLES[language()]}
          language={language()}
          showLineNumbers
          startLine={1}
        >
          <CodeBlockHeader>
            <CodeBlockTitle>
              <strong class="font-medium">
                {language() === 'typescript' ? 'TypeScript' : language() === 'rust' ? 'Rust' : 'Bash'}
              </strong>
              <CodeBlockFilename>
                {language() === 'typescript' ? 'health.ts' : language() === 'rust' ? 'recover.rs' : 'dev.sh'}
              </CodeBlockFilename>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockLanguageSelector
                aria-label="Language"
                value={language()}
                onChange={(value) => setLanguage(value as DemoLanguage)}
                options={[
                  { value: 'typescript', label: 'TypeScript' },
                  { value: 'rust', label: 'Rust' },
                  { value: 'bash', label: 'Bash' },
                ]}
              />
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block-highlight')}>
      <CatalogDemo
        id="code-block-highlight"
        title="Syntax highlighting"
        description="Shiki github-light-default；与 Markdown 代码块共用高亮语义。"
      >
        <CodeBlock
          code={CODE_SAMPLES[language()]}
          language={language()}
          includeDefaultBody={false}
          showLineNumbers
          startLine={1}
        >
          <CodeBlockHeader>
            <CodeBlockTitle>
              <CodeBlockFilename>
                {language() === 'typescript' ? 'health.ts' : language() === 'rust' ? 'recover.rs' : 'dev.sh'}
              </CodeBlockFilename>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockLanguageSelector
                aria-label="Language"
                value={language()}
                onChange={(value) => setLanguage(value as DemoLanguage)}
                options={[
                  { value: 'typescript', label: 'TypeScript' },
                  { value: 'rust', label: 'Rust' },
                  { value: 'bash', label: 'Bash' },
                ]}
              />
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
          <HighlightedCodeBody
            language={language()}
            showLineNumbers
            startLine={1}
          />
        </CodeBlock>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block-line-numbers')}>
      <CatalogDemo
        id="code-block-line-numbers"
        title="Line numbers"
        description="showLineNumbers + startLine 偏移；纯文本 body（无 Shiki）。"
      >
        <CodeBlock
          code={`fn main() {\n    println!("Peri Studio");\n}\n`}
          language="rust"
          showLineNumbers
          startLine={14}
        />
      </CatalogDemo>
      </Show>
    </>
  );
}
