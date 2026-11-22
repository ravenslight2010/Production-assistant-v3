export interface SetupCatalogCsvTemplate {
  fileName: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface ParsedSetupCatalogRecord {
  code: string;
  name: string;
  data: Record<string, unknown>;
}

export declare const setupCatalogCsvTemplates: Readonly<Record<string, SetupCatalogCsvTemplate>>;
export declare const setupCatalogCsvLimits: { readonly families: readonly string[]; readonly directoryKeys: readonly string[]; readonly maxRows: number };
export declare function parseSetupCatalogCsv(family: string, csv: string): ParsedSetupCatalogRecord[];
export declare function parseSetupCatalogRecord(family: string, value: unknown): ParsedSetupCatalogRecord;
export declare const setupCatalogRunTemplateFields: readonly {
  readonly key: string;
  readonly kind: "number" | "boolean" | "recipe" | "text";
}[];
