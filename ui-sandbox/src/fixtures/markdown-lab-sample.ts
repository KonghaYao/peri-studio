/** Blocks Markdown lab 与 AI Catalog 共用样例（单一事实源）。 */
export const MARKDOWN_LAB_SAMPLE = `# Markdown rendering lab

**Important notice.** Content continues, and ~~the old conclusion~~ has been replaced.

> Streaming content stays readable while syntax is incomplete.

| Capability | State | Notes |
| :--- | :---: | ---: |
| GFM table | Ready | Responsive |
| Remote images | Consent | Explicit load |

- [x] Parse CommonMark and GFM
- [x] Protect remote images
- [ ] Review the final diagram

Inline code uses \`session/load\`. Inline math $E = mc^2$ and display:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

\`\`\`mermaid
flowchart LR
  Session["Project session"] --> ACP["ACP thread"]
  ACP --> Runtime["Runtime chat"]
\`\`\`

\`\`\`math
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
\`\`\`

Links stay [external](https://example.test/architecture).

\`\`\`ts startLine=7 filename=recovery.ts
type Result = { ok: boolean };
const result: Result = { ok: true };
console.log(result);
\`\`\`

![Architecture diagram](https://picsum.photos/seed/peri-arch/720/360)

Footnotes remain compact.[^security]

[^security]: Generated content is treated as untrusted input.
`;
