export type ProviderHostConfig = {
  host: string;
  effectiveHost: string;
};

export function providerHostConfig({
  host,
  fallbackHost,
  normalize,
}: {
  host: string;
  fallbackHost: string;
  normalize?: (host: string) => string;
}): ProviderHostConfig {
  const savedHost = host.trim();
  const effectiveInput = savedHost || fallbackHost;
  let effectiveHost = effectiveInput;
  if (normalize) {
    try {
      effectiveHost = normalize(effectiveInput);
    } catch {
      effectiveHost = effectiveInput;
    }
  }
  return {
    host: savedHost,
    effectiveHost,
  };
}
