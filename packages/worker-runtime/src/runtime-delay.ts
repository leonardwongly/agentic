export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}
