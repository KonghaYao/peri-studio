import { Show, splitProps, type ComponentProps } from 'solid-js';
import {
  CodeBlock as PeriCodeBlock,
  CodeBlockActions,
  CodeBlockBody,
  CodeBlockContainer,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockLanguageSelectorContent,
  CodeBlockLanguageSelectorItem,
  CodeBlockTitle,
  useCodeBlock,
} from '@peri/ui';
import { HighlightedCodeBody } from '@/components/code/HighlightedCodeBody';

export {
  CodeBlockActions,
  CodeBlockBody,
  CodeBlockContainer,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockLanguageSelectorContent,
  CodeBlockLanguageSelectorItem,
  CodeBlockTitle,
  useCodeBlock,
};

type CodeBlockProps = ComponentProps<typeof PeriCodeBlock>;

type HighlightedBodyProps = {
  language: string;
  showLineNumbers?: boolean;
  startLine?: number;
};

/** 须在 PeriCodeBlock 子树内渲染，不可在 Provider 外提前创建 JSX。 */
function HighlightedBody(props: HighlightedBodyProps) {
  return (
    <div class="relative overflow-auto">
      <HighlightedCodeBody
        language={props.language}
        showLineNumbers={props.showLineNumbers}
        startLine={props.startLine}
      />
    </div>
  );
}

/** Sandbox CodeBlock：默认 TanStack Highlight body，与 @peri/ui 组合式 API 一致。 */
export function CodeBlock(props: CodeBlockProps) {
  const [local, rest] = splitProps(props, [
    'language',
    'filename',
    'showLineNumbers',
    'startLine',
    'children',
    'includeDefaultBody',
  ]);
  const language = () => local.language ?? 'text';

  if (local.includeDefaultBody === true) {
    return <PeriCodeBlock {...props} />;
  }

  return (
    <PeriCodeBlock
      {...rest}
      language={local.language}
      filename={local.filename}
      showLineNumbers={local.showLineNumbers}
      startLine={local.startLine}
      includeDefaultBody={false}
    >
      <Show
        when={local.children}
        fallback={
          <>
            <CodeBlockHeader>
              <CodeBlockTitle>
                <Show when={local.filename}>
                  <CodeBlockFilename path={local.filename!} />
                </Show>
              </CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton />
              </CodeBlockActions>
            </CodeBlockHeader>
            <HighlightedBody
              language={language()}
              showLineNumbers={local.showLineNumbers}
              startLine={local.startLine}
            />
          </>
        }
      >
        <>
          {local.children}
          <HighlightedBody
            language={language()}
            showLineNumbers={local.showLineNumbers}
            startLine={local.startLine}
          />
        </>
      </Show>
    </PeriCodeBlock>
  );
}
