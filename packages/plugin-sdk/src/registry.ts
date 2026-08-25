import type { ProviderAdapter, ProviderManifest } from "./provider.ts";
import { validateProviderManifest } from "./provider.ts";

export interface ProviderRegistry {
  register(adapter: ProviderAdapter): void;
  get(providerId: string): ProviderAdapter | undefined;
  require(providerId: string): ProviderAdapter;
  list(): readonly ProviderAdapter[];
}

export function createProviderRegistry(
  initialAdapters: readonly ProviderAdapter[] = [],
): ProviderRegistry {
  const providers = new Map<string, ProviderAdapter>();

  const registry: ProviderRegistry = {
    register(adapter) {
      const validation = validateProviderManifest(adapter.manifest);
      if (!validation.ok) {
        throw new Error(
          `Invalid provider manifest '${adapter.manifest.id}': ${validation.errors.join("; ")}`,
        );
      }
      if (providers.has(adapter.manifest.id)) {
        throw new Error(`Provider already registered: ${adapter.manifest.id}`);
      }
      providers.set(adapter.manifest.id, adapter);
    },
    get(providerId) {
      return providers.get(providerId);
    },
    require(providerId) {
      const provider = providers.get(providerId);
      if (!provider) throw new Error(`Provider not registered: ${providerId}`);
      return provider;
    },
    list() {
      return [...providers.values()].sort((a, b) =>
        a.manifest.id.localeCompare(b.manifest.id),
      );
    },
  };

  for (const adapter of initialAdapters) registry.register(adapter);
  return registry;
}

export interface ProviderRuntimeRegistration {
  readonly manifest: ProviderManifest;
}

export interface ProviderRuntimeRegistry<
  TRegistration extends ProviderRuntimeRegistration,
> {
  register(registration: TRegistration): void;
  get(providerId: string): TRegistration | undefined;
  require(providerId: string): TRegistration;
  list(): readonly TRegistration[];
}

export function createProviderRuntimeRegistry<
  TRegistration extends ProviderRuntimeRegistration,
>(
  initialRegistrations: readonly TRegistration[] = [],
): ProviderRuntimeRegistry<TRegistration> {
  const providers = new Map<string, TRegistration>();

  const registry: ProviderRuntimeRegistry<TRegistration> = {
    register(registration) {
      const { manifest } = registration;
      const validation = validateProviderManifest(manifest);
      if (!validation.ok) {
        throw new Error(
          `Invalid provider manifest '${manifest.id}': ${validation.errors.join("; ")}`,
        );
      }
      if (providers.has(manifest.id)) {
        throw new Error(`Provider runtime already registered: ${manifest.id}`);
      }
      providers.set(manifest.id, registration);
    },
    get(providerId) {
      return providers.get(providerId);
    },
    require(providerId) {
      const provider = providers.get(providerId);
      if (!provider)
        throw new Error(`Provider runtime not registered: ${providerId}`);
      return provider;
    },
    list() {
      return [...providers.values()].sort((a, b) =>
        a.manifest.id.localeCompare(b.manifest.id),
      );
    },
  };

  for (const registration of initialRegistrations)
    registry.register(registration);
  return registry;
}
