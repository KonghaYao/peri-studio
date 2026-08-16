/**
 * SHA-256 digest 计算（MCPP 4.6 加载校验 / SEP-2640 的 sha256:{hex} 格式）。
 *
 * 注意：digest 匹配只证明字节未变，不构成信任证据（9.x：digest 匹配 ≠ 可信）。
 */
export async function computeSha256Hex(input: string | Uint8Array): Promise<string> {
    const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
    // 统一拷贝为独占 ArrayBuffer：消除 view 偏移与 ArrayBufferLike 泛型差异
    const buffer = Uint8Array.from(data).buffer as ArrayBuffer;
    const buf = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** SEP-2640 风格 digest 字符串：sha256:{64hex}。 */
export async function computeDigest(input: string | Uint8Array): Promise<string> {
    return `sha256:${await computeSha256Hex(input)}`;
}

/** 校验 digest 是否为合法格式（不执行匹配校验本身）。 */
export function isDigestFormat(digest: string): boolean {
    return /^sha256:[0-9a-f]{64}$/.test(digest);
}