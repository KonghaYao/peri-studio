import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockTitle,
} from '@/components/code/CodeBlock';
import { CatalogDemo } from '@/pages/shared/DemoSection';

const CODE_SAMPLES = {
  typescript: `export async function waitUntilReady(baseUrl: string) {
  const response = await fetch(\`\${baseUrl}/api/health\`);
  if (!response.ok) throw new Error('server not ready');
  return response.json();
}`,
  python: `async def wait_until_ready(base_url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{base_url}/api/health")
        response.raise_for_status()
        return response.json()`,
  bash: `#!/usr/bin/env bash
set -euo pipefail
bun run test
./dev.sh`,
} as const;

const SAMPLE_FILES = {
  typescript: 'src/health.ts',
  python: 'src/health.py',
  bash: 'scripts/dev.sh',
} as const;

type DemoLanguage = keyof typeof CODE_SAMPLES;

export function ComponentCatalogExtrasCode(props: { sections?: string[] }) {
  const [language, setLanguage] = createSignal<DemoLanguage>('typescript');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'code-block-default')}>
      <CatalogDemo id="code-block-default" title="Default">
        <CodeBlock
          code={'const answer = 42;\n'}
          language="typescript"
          filename="src/answer.ts"
        />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block-composable')}>
      <CatalogDemo id="code-block-composable" title="Composable header">
        <CodeBlock
          code={CODE_SAMPLES[language()]}
          language={language()}
          showLineNumbers
          startLine={1}
        >
          <CodeBlockHeader>
            <CodeBlockTitle>
              <CodeBlockFilename path={SAMPLE_FILES[language()]} />
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockLanguageSelector
                aria-label="Language"
                value={language()}
                onChange={(value) => setLanguage(value as DemoLanguage)}
                options={[
                  { value: 'typescript', label: 'TypeScript' },
                  { value: 'python', label: 'Python' },
                  { value: 'bash', label: 'Bash' },
                ]}
              />
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block-line-numbers')}>
      <CatalogDemo id="code-block-line-numbers" title="Line numbers">
        <CodeBlock
          code={`fn main() {\n    println!("Peri Studio");\n}\n`}
          language="rust"
          filename="src/main.rs"
          showLineNumbers
          startLine={14}
        />
      </CatalogDemo>
      </Show>
    </>
  );
}
