/**
 * Skill Resource 的纯策略：运行时目录扫描与静态 Worker registry 共用。
 *
 * 本模块不得依赖 Node/Bun 文件系统，因此可安全进入 Worker bundle。
 */

export type SkillResourceContentKind = "text" | "blob";

export interface SkillResourceLimits {
    /** 单个可公开文件的最大字节数，默认 1 MiB。 */
    maxFileBytes?: number;
    /** 单个 Skill 所有可公开文件的最大总字节数，默认 8 MiB。 */
    maxSkillBytes?: number;
    /** 单个 Skill 最多可公开的文件数，默认 128。 */
    maxSkillFiles?: number;
    /** 一次挂载最多可公开的文件总数，默认 1024。 */
    maxTotalFiles?: number;
    /** 一次挂载所有可公开文件的最大总字节数，默认 32 MiB。 */
    maxTotalBytes?: number;
    /** 每个 Skill 在递归扫描时最多检查的目录项数，默认 1024。 */
    maxScannedEntriesPerSkill?: number;
}

export interface SkillResourceScanOptions extends SkillResourceLimits {}

export type ResolvedSkillResourceOptions = {
    limits: Required<SkillResourceLimits>;
};

export interface SkillResourceFileClassification {
    mimeType: string;
    contentKind: SkillResourceContentKind;
}

const DEFAULT_LIMITS: Required<SkillResourceLimits> = {
    maxFileBytes: 1024 * 1024,
    maxSkillBytes: 8 * 1024 * 1024,
    maxSkillFiles: 128,
    maxTotalFiles: 1024,
    maxTotalBytes: 32 * 1024 * 1024,
    maxScannedEntriesPerSkill: 1024,
};

const TEXT_MIME_TYPES: Record<string, string> = {
    ".bash": "text/x-shellscript",
    ".c": "text/x-c",
    ".cc": "text/x-c++",
    ".cfg": "text/plain",
    ".conf": "text/plain",
    ".cpp": "text/x-c++",
    ".cs": "text/x-csharp",
    ".css": "text/css",
    ".csv": "text/csv",
    ".fish": "text/x-shellscript",
    ".go": "text/x-go",
    ".graphql": "application/graphql",
    ".gql": "application/graphql",
    ".h": "text/x-c",
    ".hbs": "text/x-handlebars-template",
    ".hpp": "text/x-c++",
    ".htm": "text/html",
    ".html": "text/html",
    ".ini": "text/plain",
    ".java": "text/x-java-source",
    ".jinja": "text/plain",
    ".jinja2": "text/plain",
    ".js": "text/javascript",
    ".json": "application/json",
    ".jsonc": "application/json",
    ".jsx": "text/jsx",
    ".kt": "text/x-kotlin",
    ".kts": "text/x-kotlin",
    ".less": "text/css",
    ".lua": "text/x-lua",
    ".md": "text/markdown",
    ".mdx": "text/markdown",
    ".mjs": "text/javascript",
    ".mustache": "text/plain",
    ".php": "text/x-php",
    ".properties": "text/plain",
    ".ps1": "text/plain",
    ".py": "text/x-python",
    ".r": "text/x-r-source",
    ".rb": "text/x-ruby",
    ".rst": "text/x-rst",
    ".rs": "text/x-rust",
    ".sass": "text/css",
    ".scss": "text/css",
    ".sh": "text/x-shellscript",
    ".sql": "application/sql",
    ".svg": "image/svg+xml",
    ".swift": "text/x-swift",
    ".template": "text/plain",
    ".tmpl": "text/plain",
    ".toml": "application/toml",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".zsh": "text/x-shellscript",
};

const BLOB_MIME_TYPES: Record<string, string> = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
};

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`MCPP skill resources: ${label} must be a positive safe integer`);
    }
    return value;
}

/** 解析全部文件通用的预算上限。 */
export function resolveSkillResourceOptions(
    options: SkillResourceScanOptions | undefined,
): ResolvedSkillResourceOptions {
    return {
        limits: {
            maxFileBytes: positiveInteger(options?.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, "maxFileBytes"),
            maxSkillBytes: positiveInteger(options?.maxSkillBytes, DEFAULT_LIMITS.maxSkillBytes, "maxSkillBytes"),
            maxSkillFiles: positiveInteger(options?.maxSkillFiles, DEFAULT_LIMITS.maxSkillFiles, "maxSkillFiles"),
            maxTotalFiles: positiveInteger(options?.maxTotalFiles, DEFAULT_LIMITS.maxTotalFiles, "maxTotalFiles"),
            maxTotalBytes: positiveInteger(options?.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes, "maxTotalBytes"),
            maxScannedEntriesPerSkill: positiveInteger(
                options?.maxScannedEntriesPerSkill,
                DEFAULT_LIMITS.maxScannedEntriesPerSkill,
                "maxScannedEntriesPerSkill",
            ),
        },
    };
}

function extensionFor(relativePath: string): string {
    const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    const index = filename.lastIndexOf(".");
    return index > 0 ? filename.slice(index).toLowerCase() : "";
}

/**
 * 为已发现的普通文件提供 Resource 表示。内容类别由扫描器依据实际字节决定：
 * UTF-8 文本保留已知扩展名的 MIME，未知文本以 text/plain 表示；二进制仅保留
 * 已知图片 MIME，其余以 application/octet-stream 的 blob 传递。
 */
export function classifySkillResourceFile(
    relativePath: string,
    contentKind: SkillResourceContentKind,
): SkillResourceFileClassification {
    const extension = extensionFor(relativePath);
    if (contentKind === "text") {
        return {
            mimeType: TEXT_MIME_TYPES[extension] ?? "text/plain",
            contentKind,
        };
    }
    return {
        mimeType: BLOB_MIME_TYPES[extension] ?? "application/octet-stream",
        contentKind,
    };
}
