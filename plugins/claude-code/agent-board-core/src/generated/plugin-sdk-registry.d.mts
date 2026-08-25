export interface BundledProviderRuntimeRegistration {
  readonly manifest: { readonly id: string };
}

export interface BundledProviderRuntimeRegistry<
  TRegistration extends BundledProviderRuntimeRegistration,
> {
  register(registration: TRegistration): void;
  get(providerId: string): TRegistration | undefined;
  require(providerId: string): TRegistration;
  list(): readonly TRegistration[];
}

export function createProviderRuntimeRegistry<
  TRegistration extends BundledProviderRuntimeRegistration,
>(initialRegistrations?: readonly TRegistration[]): BundledProviderRuntimeRegistry<TRegistration>;
