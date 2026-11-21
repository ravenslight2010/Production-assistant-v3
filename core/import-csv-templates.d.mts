export interface ImportCsvTemplate {
  fileName: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export declare function renderImportCsvTemplate(template: ImportCsvTemplate): string;
