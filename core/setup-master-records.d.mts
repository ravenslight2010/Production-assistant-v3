export type SetupMasterKind = "recipes" | "production-setups";
export interface ParsedSetupMasterRecord {
  code: string;
  name: string;
  productCode: string;
  data: Record<string, unknown>;
}
export declare function parseSetupMasterRecord(kind: string, value: unknown): ParsedSetupMasterRecord;
export declare function emptySetupMasterRecord(kind: string, productCode?: string): ParsedSetupMasterRecord;
export declare const setupMasterRecordLimits: {
  readonly kinds: readonly string[];
  readonly sourceFamilies: Readonly<Record<string, string>>;
};
