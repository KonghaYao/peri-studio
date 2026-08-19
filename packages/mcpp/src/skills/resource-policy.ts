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

export interface SkillResourceScanOptions extends SkillResourceLimits {
    /** Skill 根下额外可递归公开的一级目录；默认仅 references/scripts/assets/templates。 */
    publicDirectories?: readonly string[];
}

export type ResolvedSkillResourceOptions = {
    limits: Required<SkillResourceLimits>;
    publicDirectories: string[];
};

export interface SkillResourceFileClassification {
    mimeType: string;
    contentKind: SkillResourceContentKind;
}

/** 默认可递归公开的 Skill 根级目录。 */
export const DEFAULT_SKILL_RESOURCE_PUBLIC_DIRECTORIES = [
    "references",
    "scripts",
    "assets",
    "templates",
] as const;

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

const IMAGE_MIME_TYPES: Record<string, string> = {
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

/** 规范化部署者追加的根级公开目录；追加而非替换默认目录。 */
export function resolveSkillResourcePublicDirectories(
    additionalDirectories?: readonly string[],
): string[] {
    const directories = [...new Set([
        ...DEFAULT_SKILL_RESOURCE_PUBLIC_DIRECTORIES,
        ...(additionalDirectories ?? []),
    ])].sort((left, right) => left.localeCompare(right));
    if (directories.some((directory) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(directory))) {
        throw new Error("MCPP skill resources: publicDirectories must contain safe directory names");
    }
    return directories;
}

/** 解析公开目录及各类预算上限。 */
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
        publicDirectories: resolveSkillResourcePublicDirectories(options?.publicDirectories),
    };
}

/** 确认相对路径是 Skill 根或一个已批准根级目录下的附属文件。 */
export function isPublicSkillResourcePath(
    relativePath: string,
    publicDirectories: readonly string[],
): boolean {
    if (relativePath === "SKILL.md") return true;
    const firstSegment = relativePath.split("/", 1)[0];
    return firstSegment !== undefined && publicDirectories.includes(firstSegment);
}

function extensionFor(relativePath: string): string {
    const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    const index = filename.lastIndexOf(".");
    return index > 0 ? filename.slice(index).toLowerCase() : "";
}

/** 按扩展名映射允许公开的文本/图片类型；未知类型一律不公开。 */
export function classifySkillResourceFile(relativePath: string): SkillResourceFileClassification | undefined {
    const extension = extensionFor(relativePath);
    const textMimeType = TEXT_MIME_TYPES[extension];
    if (textMimeType) return { mimeType: textMimeType, contentKind: "text" };

    const imageMimeType = IMAGE_MIME_TYPES[extension];
    if (imageMimeType) return { mimeType: imageMimeType, contentKind: "blob" };
    return undefined;
}
