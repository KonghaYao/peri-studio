/** plugin 校验的公共结果类型。 */
export type ValidationResult<T> =
    | { ok: true; value: T }
    | { ok: false; errors: string[] };