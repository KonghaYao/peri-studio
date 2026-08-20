export function memoizeAsync<TArgs extends unknown[], TResult>(
  keyOf: (...args: TArgs) => string,
  load: (...args: TArgs) => Promise<TResult>,
  limit = 160,
) {
  const cache = new Map<string, Promise<TResult>>();
  return async (...args: TArgs) => {
    const key = keyOf(...args);
    let task = cache.get(key);
    if (!task) {
      if (cache.size >= limit) cache.delete(cache.keys().next().value!);
      task = load(...args);
      cache.set(key, task);
    }
    try {
      return await task;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  };
}
