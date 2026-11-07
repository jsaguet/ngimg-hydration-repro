/**
 * Benchmark instrumentation, installed by the inline script in index.html. It is a no-op when that
 * script is absent (e.g. on the server), and it does not change what the app renders.
 */
export interface BenchHooks {
  onRender(): void;
  onLoadHandler(productId: number): void;
  onBootstrapStart(): void;
  onAppStable(): void;
}

export function benchHooks(): BenchHooks | undefined {
  return typeof window === 'undefined' ? undefined : (window as {__bench?: BenchHooks}).__bench;
}
