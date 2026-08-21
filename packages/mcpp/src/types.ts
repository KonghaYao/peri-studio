/**
 * MCPP 共享类型与常量（对应 MCPP 规范第 4 章）。
 *
 * 规范条目：
 *  - skill:// URI 约定与末段 == name（S2）
 *  - SKILL.md frontmatter 至少 name + description（S1）
 *  - io.mcpp/* 编排字段（4.2，depends_on / tools / context_budget / version / provider）
 */

/** MCPP 在 skill frontmatter metadata 中登记的编排字段（4.2 表）。 */
export const MCPP_METADATA_KEYS = [
    "io.mcpp/depends_on",
    "io.mcpp/tools",
    "io.mcpp/context_budget",
    "io.mcpp/version",
    "io.mcpp/provider",
] as const;

/** skill:// 资源模板（4.3）：{skillName} 单段，末段即 skill 名。 */
export const SKILL_URI_TEMPLATE = "skill://{skillName}/SKILL.md";

/** Server Cache Version 协商使用的 MCPP extension id。 */
export const MCPP_SERVER_CACHE_VERSION_EXTENSION = "io.mcpp/server-cache-version";

/** 初始化协商中由 Server 返回的 opaque Server Cache Version。 */
export type McppServerCacheVersionCapability = {
    cacheVersion: string;
};

/**
 * 构造 Server Cache Version 能力声明。该值只用于相等比较，不得包含凭据或用户标识。
 */
export function serverCacheVersionCapability(cacheVersion: string): McppServerCacheVersionCapability {
    if (!cacheVersion.trim()) throw new Error("MCPP server cacheVersion must be non-empty");
    return { cacheVersion };
}

/** frontmatter 中 depends_on 的单个条目：URI 字符串；或显式 { server, uri }。 */
export type DependsOnEntry = string | { server?: string; uri: string };

/** io.mcpp/tools 绑定（4.7.2）：required / optional 均按工具名（per-origin 命名空间内解析）。 */
export type McppToolsBinding = {
    required?: string[];
    optional?: string[];
};

/** 解析出的 MCPP 编排元数据（io.mcpp/* 键）。 */
export type McppMetadata = {
    "io.mcpp/depends_on"?: DependsOnEntry[];
    "io.mcpp/tools"?: McppToolsBinding;
    "io.mcpp/context_budget"?: string;
    "io.mcpp/version"?: string;
    "io.mcpp/provider"?: string;
};

/** SKILL.md frontmatter（Agent Skills 规范子集 + MCPP 扩展）。未知字段保留透传。 */
export type SkillFrontmatter = {
    name?: string;
    description?: string;
    metadata?: Record<string, unknown>;
    license?: string;
    "allowed-tools"?: string[];
    [key: string]: unknown;
};

/** 扫描得到的 skill 元信息（progressive disclosure 的 Discovery 层：只含元数据）。 */
export type SkillMeta = {
    name: string;
    description?: string;
    /** SKILL.md 完整解析后的 frontmatter（Activation 前不读正文，仅 frontmatter 可提前读）。 */
    frontmatter: SkillFrontmatter;
    /** 原始 frontmatter 中的 MCPP 编排字段（io.mcpp/*，未翻译）。 */
    mcpp?: McppMetadata;
    /** skill:// 资源 URI（skill://{name}/SKILL.md）。 */
    uri: string;
    /** SKILL.md 字节数（resource 的 size 字段，供缓存/提示用）。 */
    size: number;
    /** shA-256 digest（hex，40 位），形如 sha256:{64hex} —— 注意：digest 匹配 ≠ 可信（9.x）。
     *  列表（Discovery 层）默认不计算；需要校验/编排时显式开启。 */
    digest?: string;
};

/** skill 名合法性：目录名即 skill 名（S1/S2），字符集与路径穿越防护一致。 */
export function isValidSkillName(name: string): boolean {
    return /^[\w-]+$/.test(name) && name.length > 0 && name.length <= 64;
}