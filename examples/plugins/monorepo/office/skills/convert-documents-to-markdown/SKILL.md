---
name: convert-documents-to-markdown
description: Convert Word (.doc, .docx), PowerPoint (.ppt, .pptx), Excel (.xls, .xlsx), OpenDocument (.odt, .ods, .odp), RTF, EPUB, CSV, and PDF files to GitHub-Flavored Markdown. Use when a task needs the contents of an office document, spreadsheet, presentation, ebook, or PDF you cannot read directly.
license: MIT
metadata:
  author: firecrawl
---

# Convert documents to Markdown (via MCP)

This skill is served by the `office-demo` MCP server as the `anydoc` tool.
Do **not** shell out to `npx @firecrawl/anydoc` yourself — call the tool:

```
mcp__office-demo__anydoc  { "args": "<anydoc CLI arguments>" }
```

`args` is a single string holding the exact anydoc CLI arguments,
space-separated (this SKILL.md itself is also mounted as the `skill://convert-documents-to-markdown/SKILL.md` resource).

| Goal                                    | args                    |
| --------------------------------------- | ----------------------- |
| Markdown in the tool result             | `"<file>"`              |
| Write to a file                         | `"<file> -o out.md"`    |
| Force a format when detection fails     | `"<file> --format csv"` |

The tool runs inside the MCP server, so relative paths resolve against the
server's working directory (where `.mcp.json` lives), not the client's.
Use paths relative to that directory, or absolute paths.

Rules:

1. Supported inputs: `.doc`, `.docx`, `.docm`, `.odt`, `.rtf`, `.epub`, `.pdf`, `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.odp`, `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.ods`, `.csv`.
2. The format is detected from the file content. Pass `--format <name>` only when detection cannot work: CSV with a missing extension, or a wrong/missing extension.
3. The tool fails when the document cannot be converted: exit 1 = could not convert, exit 2 = usage error. The stderr `anydoc: <message>` line is included in the error, so report it back to the user.
4. For a large document, write to a file with `-o` and read the parts you need instead of streaming everything into context.
5. Scanned and image-only PDFs need OCR, which anydoc does not do; they fail as unsupported. The hosted [Firecrawl Parse](https://firecrawl.dev/parse) API handles those.
6. stdin input (`anydoc - --format csv < f`) is not available through the MCP tool — give it a real file path instead.
