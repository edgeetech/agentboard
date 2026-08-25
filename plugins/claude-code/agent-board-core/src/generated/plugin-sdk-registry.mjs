// packages/plugin-sdk/src/provider.ts
var PROVIDER_RUNTIME_CONTROLS = [
  'cwd',
  'maxTurns',
  'allowedTools',
  'mcpServerNames',
  'hooksEnabled',
  'abortSignal',
  'rateLimitBackoff',
  'approvalMode',
  'filesystemSandbox',
];
function validateProviderManifest(manifest) {
  const errors = [];
  if (manifest.id.trim().length === 0) errors.push('manifest.id is required');
  if (manifest.displayName.trim().length === 0) errors.push('manifest.displayName is required');
  if (manifest.version.trim().length === 0) errors.push('manifest.version is required');
  if (manifest.runtime.command.trim().length === 0)
    errors.push('manifest.runtime.command is required');
  const knownControls = new Set(PROVIDER_RUNTIME_CONTROLS);
  const enforced = /* @__PURE__ */ new Set();
  const ignored = /* @__PURE__ */ new Set();
  for (const control of manifest.enforcement.enforced) {
    if (!knownControls.has(control)) errors.push(`unknown enforced control: ${control}`);
    enforced.add(control);
  }
  for (const control of manifest.enforcement.intentionallyIgnored) {
    if (!knownControls.has(control)) errors.push(`unknown ignored control: ${control}`);
    ignored.add(control);
  }
  for (const control of enforced) {
    if (ignored.has(control))
      errors.push(`control cannot be both enforced and ignored: ${control}`);
  }
  for (const control of PROVIDER_RUNTIME_CONTROLS) {
    if (!enforced.has(control) && !ignored.has(control)) {
      errors.push(`runtime control must be declared enforced or ignored: ${control}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// packages/plugin-sdk/src/registry.ts
function createProviderRegistry(initialAdapters = []) {
  const providers = /* @__PURE__ */ new Map();
  const registry = {
    register(adapter) {
      const validation = validateProviderManifest(adapter.manifest);
      if (!validation.ok) {
        throw new Error(
          `Invalid provider manifest '${adapter.manifest.id}': ${validation.errors.join('; ')}`,
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
      return [...providers.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
    },
  };
  for (const adapter of initialAdapters) registry.register(adapter);
  return registry;
}
function createProviderRuntimeRegistry(initialRegistrations = []) {
  const providers = /* @__PURE__ */ new Map();
  const registry = {
    register(registration) {
      const { manifest } = registration;
      const validation = validateProviderManifest(manifest);
      if (!validation.ok) {
        throw new Error(
          `Invalid provider manifest '${manifest.id}': ${validation.errors.join('; ')}`,
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
      if (!provider) throw new Error(`Provider runtime not registered: ${providerId}`);
      return provider;
    },
    list() {
      return [...providers.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
    },
  };
  for (const registration of initialRegistrations) registry.register(registration);
  return registry;
}
export { createProviderRegistry, createProviderRuntimeRegistry };
