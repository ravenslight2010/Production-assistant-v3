export interface OpeningCountCsvRow {
  productCode: string;
  quantity: string;
}

export declare function parseOpeningCountCsv(text: string, activeProductCodes: string[]): OpeningCountCsvRow[];
