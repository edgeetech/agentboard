import type { TokenRate } from "../costs/types.ts";

export interface PricingCatalogPort {
  readonly version: number;
  findRate(modelId: string | null | undefined): TokenRate | null;
}
