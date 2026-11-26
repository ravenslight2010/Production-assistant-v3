import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { readWorkbookSheets, workbookCapacityImportLimits } from "./workbook-capacity-import.mjs";

const MAX_IMPORT_ROWS = 2000;
const VERSION = "v1-source-import/2";
const FAMILY_LABELS = Object.freeze({
  "spec-sheets": "Spec sheet",
  "premix-sheets": "Premix sheet",
  "cheese-mix-specs": "Cheese mix spec",
  "shipping-guides": "Shipping guide",
  "sauce-guides": "Sauce guide",
  "dough-guides": "Dough guide",
});

const HEADER_FIELDS = Object.freeze({
  dietype: ["dieType", "text"],
  doughrecipe: ["doughRecipeName", "text"],
  doughrecipename: ["doughRecipeName", "text"],
  frontline: ["frontlineRecipeName", "text"],
  frontlinerecipe: ["frontlineRecipeName", "text"],
  frontlinerecipename: ["frontlineRecipeName", "text"],
  saucerecipe: ["frontlineRecipeName", "text"],
  saucerecipename: ["frontlineRecipeName", "text"],
  sauceozpizza: ["sauceOzPerPizza", "number"],
  sauceozperpizza: ["sauceOzPerPizza", "number"],
  targetdoughballweight: ["targetDoughballWeight", "number"],
  targetdoughballweightoz: ["targetDoughballWeight", "number"],
  doughballweight: ["targetDoughballWeight", "number"],
  doughballweightoz: ["targetDoughballWeight", "number"],
  doughballspertray: ["doughballsPerTray", "number"],
  pizzaspercase: ["pizzasPerCase", "number"],
  pizzaspercs: ["pizzasPerCase", "number"],
  pizzascs: ["pizzasPerCase", "number"],
  casesperskid: ["casesPerSkid", "number"],
  casesperlayer: ["casesPerLayer", "number"],
  cartoned: ["cartoned", "text"],
  labelposition: ["labelPosition", "text"],
  cartonspercase: ["cartonsPerCase", "number"],
  cartonsize: ["cartonSize", "text"],
  labelsperroll: ["labelsPerRoll", "number"],
  toplabelsperroll: ["topLabelsPerRoll", "number"],
  bottomlabelsperroll: ["bottomLabelsPerRoll", "number"],
  circles: ["circles", "text"],
  shipper: ["shipper", "text"],
  skidstacking: ["skidStacking", "text"],
  gripsheets: ["gripSheets", "number"],
  slipsheets: ["slipSheets", "number"],
  pretunnelmin: ["preTunnelMin", "number"],
  pressovenmin: ["pressOvenMin", "number"],
  frontlinemin: ["frontlineMin", "number"],
  posttunnelmin: ["postTunnelMin", "number"],
});

const CSV_SPECIAL_FAMILIES = new Set([
  "spec-sheets", "premix-sheets", "cheese-mix-specs",
  "shipping-guides", "sauce-guides", "dough-guides",
]);

export class SourceWorkbookImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceWorkbookImportError";
  }
}

function fail(message) {
  throw new SourceWorkbookImportError(message);
}

function docxText(buffer, fileName) {
  const cleanName = String(fileName ?? "").replaceAll("\\", "/").split("/").at(-1)?.trim() || "";
  if (!/\.docx$/iu.test(cleanName) || cleanName.length > 120 || /[\u0000-\u001f\u007f]/u.test(cleanName)) {
    fail("Sauce guide documents must be valid .docx files.");
  }
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 22 || buffer.byteLength > workbookCapacityImportLimits.maxBytes) {
    fail("Sauce guide documents must be between 22 bytes and 5 MiB.");
  }
  const searchStart = Math.max(0, buffer.byteLength - 65_557);
  let eocd = -1;
  for (let offset = buffer.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50
      && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.byteLength) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) fail("The sauce guide is not a valid DOCX archive.");
  const count = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0
    || buffer.readUInt16LE(eocd + 8) !== count || count < 1 || count > 256 || count === 0xffff
    || directorySize === 0xffffffff || directoryOffset === 0xffffffff
    || directoryOffset + directorySize > eocd) {
    fail("The DOCX archive uses an unsupported or oversized ZIP layout.");
  }
  let offset = directoryOffset;
  let expandedTotal = 0;
  let document = null;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directoryOffset + directorySize || buffer.readUInt32LE(offset) !== 0x02014b50) {
      fail("The DOCX archive has an invalid file directory.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const entryEnd = nameStart + nameLength + extraLength + commentLength;
    if (entryEnd > directoryOffset + directorySize || nameLength < 1
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
      || (flags & 1) !== 0 || ![0, 8].includes(method)
      || compressedSize > workbookCapacityImportLimits.maxBytes || uncompressedSize > 2 * 1024 * 1024) {
      fail("The DOCX archive contains an unsupported, encrypted, or oversized entry.");
    }
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      fail("The DOCX archive contains an invalid file path.");
    }
    expandedTotal += uncompressedSize;
    if (expandedTotal > 10 * 1024 * 1024) fail("The DOCX expands beyond the 10 MiB processing limit.");
    if (name === "word/document.xml") document = { method, compressedSize, uncompressedSize, localOffset, name };
    offset = entryEnd;
  }
  if (offset !== directoryOffset + directorySize || !document) {
    fail("The sauce guide does not contain a readable Word document.");
  }
  if (document.localOffset + 30 > buffer.byteLength || buffer.readUInt32LE(document.localOffset) !== 0x04034b50) {
    fail("The sauce guide document has an invalid ZIP header.");
  }
  const localNameLength = buffer.readUInt16LE(document.localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(document.localOffset + 28);
  const dataOffset = document.localOffset + 30 + localNameLength + localExtraLength;
  if ((buffer.readUInt16LE(document.localOffset + 6) & 1) !== 0
    || buffer.readUInt16LE(document.localOffset + 8) !== document.method
    || document.localOffset >= directoryOffset || dataOffset + document.compressedSize > directoryOffset
    || buffer.toString("utf8", document.localOffset + 30, document.localOffset + 30 + localNameLength) !== document.name) {
    fail("The sauce guide document is truncated.");
  }
  const compressed = buffer.subarray(dataOffset, dataOffset + document.compressedSize);
  let xml;
  try {
    const expanded = document.method === 0 ? compressed
      : inflateRawSync(compressed, { maxOutputLength: 2 * 1024 * 1024 });
    if (expanded.byteLength !== document.uncompressedSize) fail("The sauce guide document has inconsistent ZIP sizes.");
    xml = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
  } catch (error) {
    if (error instanceof SourceWorkbookImportError) throw error;
    fail("The sauce guide Word text could not be read safely.");
  }
  if (/<w:tbl\b/u.test(xml)) {
    return [["DOCX table layout is not supported for automatic sauce-guide parsing."]];
  }
  const decodeEntity = (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&apos;") return "'";
    if (entity === "&quot;") return '"';
    if (/^&#x/iu.test(entity)) return safeXmlCodePoint(Number.parseInt(entity.slice(3, -1), 16));
    if (entity.startsWith("&#")) return safeXmlCodePoint(Number(entity.slice(2, -1)));
    fail("The sauce guide contains an unsupported XML entity.");
  };
  const paragraphs = xml.split(/<w:p[\s>]/u).slice(1);
  const lines = paragraphs.map((paragraph) => [...paragraph.replace(/<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/gu, " ")
    .matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gu)]
    .map((match) => match[1].replace(/&(?:amp|lt|gt|apos|quot);|&#\d+;|&#x[0-9a-f]+;/giu, decodeEntity))
    .join("").trim()).filter(Boolean);
  return lines.map((line) => [line]);
}

function safeXmlCodePoint(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    fail("The sauce guide contains an invalid XML character reference.");
  }
  return String.fromCodePoint(value);
}

function text(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‘’`]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function key(value) {
  return text(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

function numeric(value) {
  const normalized = text(value);
  if (!/^(?:0|[1-9]\d*|(?:\d{1,3}(?:,\d{3})+))(?:\.\d+)?$/u.test(normalized)) return null;
  const result = Number(normalized.replaceAll(",", ""));
  return Number.isFinite(result) && result <= 1_000_000 ? result : null;
}

function sourceRef(sheet, row) {
  return `${sheet}!row ${row + 1}`;
}

function cellRef(sheet, row, column) {
  let value = column + 1;
  let letters = "";
  while (value > 0) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return `${sheet}!${letters}${row + 1}`;
}

function formulaCells(sheet) {
  return new Set(sheet.formulas.map((entry) => `${entry.row}:${entry.column}`));
}

function firstLine(value) {
  return text(String(value ?? "").split(/[\r\n]+/u, 1)[0]);
}

function numericWithParenthetical(value, annotationPattern = null) {
  const match = text(value).match(/^((?:0|[1-9]\d*|(?:\d{1,3}(?:,\d{3})+))(?:\.\d+)?)\s*\(([^()]+)\)$/u);
  if (!match || (annotationPattern && !annotationPattern.test(match[2]))) return null;
  return numeric(match[1]);
}

function cleanDoughReference(value) {
  const raw = firstLine(value);
  const parentheticals = [...raw.matchAll(/\(([^)]*)\)/gu)];
  const base = text(raw.replace(/\([^)]*\)/gu, " "));
  if (parentheticals.length && /^(?:par[\s-]*baked?\s+)?(?:pizza\s+)?(?:crusts?|doughs?|shells?)$/iu.test(base)) {
    for (const match of parentheticals) {
      const inner = text(match[1]);
      if (!/[a-z]/iu.test(inner)) continue;
      const segments = inner.split(/\s*[-–—]\s*/u).map(text)
        .filter((segment) => segment && !/\bdies?\b/iu.test(segment) && /[a-z]/iu.test(segment));
      const cleaned = text(segments.join(" - "))
        .replace(/^\d+(?:\.\d+)?\s*(?:"|”|''|-?\s*in(?:ch(?:es)?)?\b\.?)\s*/iu, "");
      if (/[a-z]/iu.test(cleaned)) return cleaned;
    }
  }
  const withoutQualifiers = text(raw.replace(/\s*\([^()]*(?:\brecipes?\b|made[\s-]*in[\s-]*house|in[\s-]*house|legacy)[^()]*\)/giu, " "));
  const withoutDie = text(withoutQualifiers.replace(/\s*[-–—]\s*[^-–—]*\bdies?\b[^-–—]*$/iu, ""));
  return /[a-z]/iu.test(withoutDie) ? withoutDie : raw;
}

function cleanSauceReference(value) {
  const raw = firstLine(value);
  if (!raw.includes("(")) return raw;
  const stripped = text(raw.replace(/\s*\([^()]*(?:\brecipes?\b|made[\s-]*in[\s-]*house|in[\s-]*house|legacy|bought|purchased)[^()]*\)/giu, " "));
  if (!stripped || stripped === raw) return raw;
  const distinctive = stripped.split(/\s+/u).some((word) => /[a-z]/iu.test(word)
    && !/^(?:sauce|sauces|pizza|the|a|an)$/iu.test(word));
  return distinctive ? stripped : raw;
}

function explicitDieFromCrust(value, doughRecipeName) {
  if (!/\b(?:recipes?|doughs?)\b/iu.test(doughRecipeName)) return null;
  const match = firstLine(value).match(/(\d+(?:\.\d+)?)\s*(?:"|”|''|\s*-?\s*in(?:ch(?:es)?)?\b\.?)\s*[-–—]?\s*dies?\b/iu);
  return match ? `${match[1]}"` : null;
}

function formulaRows(sheet) {
  return new Set(sheet.formulas.map((entry) => entry.row));
}

function nonemptyRows(sheet) {
  return sheet.rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => row.some((cell) => text(cell)));
}

function shortCode(family, sheetName, identity) {
  const familyTag = {
    "spec-sheets": "SPEC",
    "premix-sheets": "MIX",
    "cheese-mix-specs": "CHEESE",
    "shipping-guides": "SHIP",
    "sauce-guides": "SAUCE",
    "dough-guides": "DOUGH",
  }[family];
  const seed = [family, key(sheetName), key(identity)].join("\u0000");
  const slug = `${key(identity).slice(0, 34) || "ROW"}-${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
  return `V1-${familyTag}-${slug}`.slice(0, 80);
}

function unresolved(result, source, reason) {
  result.unresolved.push({ source, reason });
}

function outputRecord(result, family, sheetName, rowIndex, identity, name, brand, flavor, values, source, sourceDetails = null) {
  const targetFamily = family === "premix-sheets" ? "mixes" : "run-templates";
  if (sourceDetails && JSON.stringify(sourceDetails).length > 20_000) {
    fail("A source review row exceeds the 20 KiB evidence limit.");
  }
  const code = shortCode(family, sheetName, identity);
  if (result.codes.has(code.toLocaleLowerCase("en-US"))) {
    unresolved(result, source, "Duplicate source identity; resolve it manually before importing either row.");
    return;
  }
  result.codes.add(code.toLocaleLowerCase("en-US"));
  result.records.push({
    source,
    targetFamily,
    ...(sourceDetails ? { sourceDetails } : {}),
    record: targetFamily === "mixes"
      ? {
        code,
        name,
        data: values,
      }
      : {
        code,
        name,
        data: { brand: brand || "", flavor: flavor || "", values },
      },
  });
  if (result.records.length > MAX_IMPORT_ROWS) fail("A source workbook may produce no more than 2,000 V3 records.");
}

function matchingHeader(sheet, predicate, limit = 150) {
  for (let index = 0; index < Math.min(sheet.rows.length, limit); index += 1) {
    const rawHeaders = sheet.rows[index] ?? [];
    const headers = rawHeaders.map(key);
    if (predicate(headers)) return { index, headers, rawHeaders };
  }
  return null;
}

function findColumn(headers, choices) {
  return headers.findIndex((header) => choices.includes(header));
}

function dataRow(row) {
  return row.some((cell) => text(cell));
}

function specProductRows(result, sheet) {
  const formulas = formulaCells(sheet);
  const isCrust = (row, column) => {
    const value = firstLine(sheet.rows[row]?.[column]);
    return /\b(?:crusts?|doughs?|shells?)\b/iu.test(value)
      && (value.includes("(") || /\d+(?:\.\d+)?\s*(?:"|”|''|x)/iu.test(value));
  };
  const headers = [];
  for (let row = 0; row < sheet.rows.length; row += 1) {
    for (let column = 0; column + 1 < (sheet.rows[row]?.length ?? 0); column += 1) {
      const brand = firstLine(sheet.rows[row]?.[column]);
      const flavor = firstLine(sheet.rows[row]?.[column + 1]);
      if (!brand || !flavor || numeric(brand) !== null || numeric(flavor) !== null
        || /^(?:notes?|oz|target weight|weight spec range)$/iu.test(brand)
        || /^(?:oz|target weight|weight spec range)$/iu.test(flavor)
        || /(?:allergen|revision|\brev\.?\s*\d)/iu.test(`${brand} ${flavor}`)) continue;
      let crustRow = -1;
      for (let lookahead = row + 1; lookahead <= row + 3 && lookahead < sheet.rows.length; lookahead += 1) {
        if (isCrust(lookahead, column)) {
          crustRow = lookahead;
          break;
        }
      }
      if (crustRow >= 0) headers.push({ row, column, crustRow });
    }
  }
  if (!headers.length) return false;

  for (const [headerIndex, header] of headers.entries()) {
    const { row: headerRow, column, crustRow } = header;
    const source = cellRef(sheet.name, headerRow, column);
    result.sourceRows += 1;
    if (formulas.has(`${headerRow}:${column}`) || formulas.has(`${headerRow}:${column + 1}`)) {
      unresolved(result, source, "Formula-derived brand or flavor headers require manager review.");
      continue;
    }
    const brand = text(sheet.rows[headerRow]?.[column])
      .replace(/\s+pizzas?$/iu, "").trim();
    const flavor = text(sheet.rows[headerRow]?.[column + 1]);
    if (!brand || !flavor) {
      unresolved(result, source, "Fixed product blocks must state both brand and flavor explicitly.");
      continue;
    }
    const nextHeader = headers.slice(headerIndex + 1)
      .find((candidate) => candidate.column === column && candidate.row > headerRow);
    const blockEnd = nextHeader?.row ?? sheet.rows.length;
    const values = {};
    const reviewOnly = [];
    let applicatorSlot = 0;
    let pepperoniSlot = 0;
    let sauceSeen = false;
    const review = (row, cellColumn, kind, value = sheet.rows[row]?.[cellColumn]) => {
      reviewOnly.push({ source: cellRef(sheet.name, row, cellColumn), kind, value: text(value) });
    };
    const reviewExtras = (row) => {
      for (let cellColumn = column + 2; cellColumn < (sheet.rows[row]?.length ?? 0); cellColumn += 1) {
        if (!text(sheet.rows[row]?.[cellColumn])) break;
        review(row, cellColumn, formulas.has(`${row}:${cellColumn}`) ? "formula" : "alternate-or-unmapped");
      }
    };
    const primaryNumber = (row, kind) => {
      if (formulas.has(`${row}:${column + 1}`)) {
        review(row, column + 1, "formula");
        return null;
      }
      const value = numeric(sheet.rows[row]?.[column + 1]);
      if (value === null && text(sheet.rows[row]?.[column + 1])) review(row, column + 1, kind);
      return value;
    };

    for (let row = crustRow; row < blockEnd; row += 1) {
      const label = firstLine(sheet.rows[row]?.[column]);
      if (!label) continue;
      if (/^weight spec range$/iu.test(label)) {
        review(row, column + 1, "weight-spec-range");
        reviewExtras(row);
        break;
      }
      if (/^target weight$/iu.test(label)) {
        review(row, column + 1, "target-weight");
        reviewExtras(row);
        continue;
      }
      if (isCrust(row, column)) {
        const doughRecipeName = cleanDoughReference(label);
        if (doughRecipeName) values.doughRecipeName = doughRecipeName;
        const dieType = explicitDieFromCrust(label, doughRecipeName);
        if (dieType) values.dieType = dieType;
        const weight = primaryNumber(row, "crust-weight");
        if (weight !== null) {
          if (/\b(?:recipes?|doughs?)\b/iu.test(doughRecipeName)) values.targetDoughballWeight = weight;
          else review(row, column + 1, "purchased-crust-weight");
        }
        reviewExtras(row);
        continue;
      }
      if (/^app(?:licator|lcator)\s*-/iu.test(label)) {
        applicatorSlot += 1;
        const type = text(label.replace(/^app(?:licator|lcator)\s*-\s*/iu, ""));
        if (applicatorSlot <= 4) {
          values[`app${applicatorSlot}Type`] = type;
          const ounces = primaryNumber(row, "applicator-weight");
          if (ounces !== null) values[`app${applicatorSlot}OzPerPizza`] = ounces;
        } else {
          review(row, column, "more-than-four-applicators", label);
          review(row, column + 1, "more-than-four-applicators");
        }
        reviewExtras(row);
        continue;
      }
      if (/^pepperoni\b/iu.test(label)) {
        pepperoniSlot += 1;
        const type = text(firstLine(label).replace(/\s*\([^()]*\).*$/u, ""));
        if (pepperoniSlot <= 2) {
          values[`pep${pepperoniSlot}Type`] = type;
          if (formulas.has(`${row}:${column + 1}`)) {
            review(row, column + 1, "formula");
          } else {
            const amount = text(sheet.rows[row]?.[column + 1]);
            const match = amount.match(/^(\d+)\s*=\s*((?:0|[1-9]\d*)(?:\.\d+)?)(?:\s+(.+))?$/u);
            const ounces = numeric(amount);
            if (match) {
              values[`pep${pepperoniSlot}Sticks`] = Number(match[1]);
              values[`pep${pepperoniSlot}OzPerPizza`] = Number(match[2]);
              if (match[3]) review(row, column + 1, "pepperoni-annotation", match[3]);
            } else if (ounces !== null) {
              values[`pep${pepperoniSlot}OzPerPizza`] = ounces;
              review(row, column + 1, "pepperoni-stick-count-unavailable");
            } else if (amount) review(row, column + 1, "pepperoni-amount");
          }
        } else {
          review(row, column, "more-than-two-pepperoni-slots", label);
          review(row, column + 1, "more-than-two-pepperoni-slots");
        }
        reviewExtras(row);
        continue;
      }
      if (/^(?:oz|soy(?:\s*&\s*\w+)?\s+allergen)$/iu.test(label)) continue;
      if (!sauceSeen) {
        sauceSeen = true;
        values.frontlineRecipeName = cleanSauceReference(label);
        const ounces = primaryNumber(row, "sauce-weight");
        if (ounces !== null) values.sauceOzPerPizza = ounces;
      } else {
        review(row, column, "additional-unmapped-product-row", label);
        review(row, column + 1, "additional-unmapped-product-row");
      }
      reviewExtras(row);
    }
    if (!Object.keys(values).length) {
      unresolved(result, source, "No literal fixed-block values map safely to a V3 profile.");
      continue;
    }
    outputRecord(result, "spec-sheets", sheet.name, headerRow, `${brand} ${flavor}`,
      `${brand} · ${flavor}`, brand, flavor, values, source,
      { layout: "fixed-product-block", reviewOnly });
    if (reviewOnly.length) {
      unresolved(result, source, "Alternate values, formulas, target ranges, or unmapped product cells remain review-only.");
    }
  }
  return true;
}

function specRows(result, sheet) {
  const header = matchingHeader(sheet, (headers) => headers.includes("brand") && headers.includes("flavor"));
  if (!header) {
    if (specProductRows(result, sheet)) return;
    if (nonemptyRows(sheet).length) {
      result.sourceRows += 1;
      unresolved(result, `${sheet.name}!sheet`, "No supported Brand/Flavor profile table or fixed product block was found; this sheet remains review-only.");
    }
    return;
  }
  const brandColumn = findColumn(header.headers, ["brand"]);
  const flavorColumn = findColumn(header.headers, ["flavor", "productflavor", "pizza"]);
  const supportedColumns = header.headers.map((column, index) => {
    const rawHeader = text(header.rawHeaders[index]);
    const app = rawHeader.match(/^Applicator\s+([1-4])\s+(Type|oz\/pizza|Recipe)$/iu);
    if (app && app[2].toLocaleLowerCase("en-US") !== "recipe") {
      return { column, index, field: [
        `app${app[1]}${app[2].toLocaleLowerCase("en-US") === "type" ? "Type" : "OzPerPizza"}`,
        app[2].toLocaleLowerCase("en-US") === "type" ? "text" : "number",
      ] };
    }
    const pepperoni = rawHeader.match(/^Pepperoni\s+([1-2])\s+(Type|Sticks|oz\/pizza)$/iu);
    if (pepperoni) {
      const slot = pepperoni[1];
      const field = pepperoni[2].toLocaleLowerCase("en-US") === "type" ? `pep${slot}Type`
        : pepperoni[2].toLocaleLowerCase("en-US") === "sticks" ? `pep${slot}Sticks` : `pep${slot}OzPerPizza`;
      return { column, index, field: [field, field.endsWith("Type") ? "text" : "number"] };
    }
    if (/^Applicator\s+[1-4]\s+Recipe$/iu.test(rawHeader)) return null;
    return HEADER_FIELDS[column] ? { column, index, field: HEADER_FIELDS[column] } : null;
  }).filter(Boolean);
  const formula = formulaRows(sheet);
  for (let rowIndex = header.index + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    if (!dataRow(row)) continue;
    result.sourceRows += 1;
    const brand = text(row[brandColumn]);
    const flavor = text(row[flavorColumn]);
    if (!brand && !flavor && row.every((cell) => !text(cell) || /^(?:total|notes?)$/iu.test(text(cell)))) {
      result.skippedRows += 1;
      continue;
    }
    if (formula.has(rowIndex)) {
      unresolved(result, sourceRef(sheet.name, rowIndex), "Formula or cached formula value requires manager review.");
      continue;
    }
    if (!brand || !flavor) {
      unresolved(result, sourceRef(sheet.name, rowIndex), "Brand and flavor must both be explicit.");
      continue;
    }
    const values = {};
    let unsupportedData = false;
    const unmapped = [];
    for (let column = 0; column < header.headers.length; column += 1) {
      const cell = text(row[column]);
      if (!cell || column === brandColumn || column === flavorColumn) continue;
      const mapping = supportedColumns.find((entry) => entry.index === column);
      if (!mapping) {
        unsupportedData = true;
        unmapped.push({ header: text(header.rawHeaders[column]) || `Column ${column + 1}`, value: cell });
        continue;
      }
      if (mapping.field[1] === "number") {
        const number = numeric(cell);
        if (number === null) {
          unsupportedData = true;
          unmapped.push({ header: text(header.rawHeaders[column]) || `Column ${column + 1}`, value: cell });
          continue;
        }
        values[mapping.field[0]] = number;
      } else {
        values[mapping.field[0]] = cell;
      }
    }
    const name = `${brand} · ${flavor}`;
    if (Object.keys(values).length === 0) {
      unresolved(result, sourceRef(sheet.name, rowIndex), "No source field maps safely to a V3 profile value.");
      continue;
    }
    outputRecord(result, "spec-sheets", sheet.name, rowIndex, `${brand} ${flavor}`, name, brand, flavor, values,
      sourceRef(sheet.name, rowIndex), unmapped.length ? { unmapped } : null);
    if (unsupportedData) {
      unresolved(result, sourceRef(sheet.name, rowIndex), "One or more populated columns have no approved V3 field mapping.");
    }
  }
}

function premixRows(result, sheet) {
  const formula = formulaRows(sheet);
  const headerPairs = [];
  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
    const headers = (sheet.rows[rowIndex] ?? []).map(key);
    const pizzaColumns = headers.flatMap((value, column) =>
      value === "perpizza" || value === "pertpizza" || value.includes("ozperpizza") || value.includes("perpizzaoz")
        ? [column] : []);
    const batchColumns = headers.flatMap((value, column) =>
      value === "perbatch" || value.includes("lbsperbatch") || value.includes("perbatchlbs")
        ? [column] : []);
    for (const pizzaColumn of pizzaColumns) {
      const batchColumn = batchColumns.find((column) => column > pizzaColumn);
      if (batchColumn === undefined) continue;
      const namedIngredientColumn = headers.findIndex((value) => ["ingredient", "ingredientname", "mixingredient"].includes(value));
      const ingredientColumn = namedIngredientColumn >= 0 ? namedIngredientColumn : pizzaColumn - 1;
      if (ingredientColumn < 0) continue;
      headerPairs.push({ rowIndex, pizzaColumn, batchColumn, ingredientColumn });
    }
  }
  if (!headerPairs.length) {
    if (nonemptyRows(sheet).length) {
      result.sourceRows += 1;
      unresolved(result, `${sheet.name}!sheet`, "No supported Per Pizza / Per Batch ingredient table was found.");
    }
    return;
  }

  const prepSetting = (() => {
    for (const row of sheet.rows) {
      for (let column = 0; column < row.length; column += 1) {
        const cell = text(row[column]);
        const match = cell.match(/is\s*prep\s*[:=]?\s*(yes|no|true|false)\b/iu);
        if (match) return /^(?:yes|true)$/iu.test(match[1]);
        if (key(cell) === "isprep") {
          const value = text(row[column + 1]);
          if (/^(?:yes|true|no|false)$/iu.test(value)) return /^(?:yes|true)$/iu.test(value);
        }
      }
    }
    return null;
  })();
  const pullNote = sheet.rows.flat().map(text).find((cell) => /pull\s+\d+\s+days?\s+(?:early|prior)/iu.test(cell)) || "";
  const pullDays = pullNote.match(/pull\s+(\d+)\s+days?\s+(?:early|prior)/iu);

  for (const header of headerPairs) {
    const { rowIndex: headerIndex, pizzaColumn, batchColumn, ingredientColumn } = header;
    const beforeRows = sheet.rows.slice(Math.max(0, headerIndex - 8), headerIndex);
    const titleCell = beforeRows.map((row) => text(row[ingredientColumn])).findLast((value) =>
      value && !/^(?:ingredient|per pizza|per batch|total|# of mixes)$/iu.test(value));
    const title = (titleCell || "").replace(/\*\*\*.*?\*\*\*/gu, "").replace(/pull\s+\d+\s+days?\s+(?:early|prior)/iu, "").trim();
    if (!title) {
      result.sourceRows += 1;
      unresolved(result, sourceRef(sheet.name, headerIndex), "The premix block has no explicit recipe name.");
      continue;
    }
    const components = [];
    let batchSizeLbs = null;
    let blockRows = 0;
    let cursor = headerIndex + 1;
    for (; cursor < sheet.rows.length; cursor += 1) {
      const row = sheet.rows[cursor] ?? [];
      const ingredient = text(row[ingredientColumn]).replace(/\s+/gu, " ").split("\n")[0].trim();
      if (/^total\b/iu.test(ingredient)) {
        batchSizeLbs = numeric(row[batchColumn]);
        result.skippedRows += 1;
        break;
      }
      if (!ingredient) {
        if (dataRow(row)) continue;
        if (blockRows > 0) break;
        continue;
      }
      if (/^(?:ingredient|per pizza|per batch|# of mixes|total cases needed|max batches at a time)$/iu.test(ingredient)) {
        result.skippedRows += 1;
        continue;
      }
      if (/^pull\b/iu.test(ingredient) || /\b(?:days early|days prior)\b/iu.test(ingredient)) {
        result.skippedRows += 1;
        continue;
      }
      result.sourceRows += 1;
      blockRows += 1;
      if (formula.has(cursor)) {
        unresolved(result, sourceRef(sheet.name, cursor), "Formula or cached premix quantity requires manager review.");
        continue;
      }
      const perPizzaOz = numeric(row[pizzaColumn]);
      const perBatchLbs = numeric(row[batchColumn]);
      if (perPizzaOz === null && perBatchLbs === null) {
        unresolved(result, sourceRef(sheet.name, cursor), "Ingredient row has no readable per-pizza ounces or per-batch pounds.");
        continue;
      }
      components.push({ ingredientName: ingredient, perPizzaOz, perBatchLbs });
    }
    if (blockRows === 0 || components.length === 0) {
      unresolved(result, sourceRef(sheet.name, headerIndex), "The premix block has no readable ingredient quantities.");
      continue;
    }
    outputRecord(result, "premix-sheets", sheet.name, headerIndex, title, title.slice(0, 200), "", "", {
      brand: "",
      flavor: "",
      batchSizeLbs,
      daysEarly: pullDays ? Number(pullDays[1]) : null,
      notes: pullNote,
      isPrep: prepSetting,
      enabled: null,
      components,
    }, sourceRef(sheet.name, headerIndex));
  }
}

function cheeseRows(result, sheet) {
  const formula = formulaRows(sheet);
  const brand = text(sheet.name);
  const assignments = [];
  const blocks = [];
  const amountColumns = new Set();
  for (const row of sheet.rows) {
    for (let column = 1; column < row.length; column += 1) {
      if (key(row[column]) === "lbs") amountColumns.add(column);
    }
  }
  const nameColumns = [...amountColumns].map((column) => column - 1).sort((a, b) => a - b);
  for (const nameColumn of nameColumns) {
    const amountColumn = nameColumn + 1;
    let rowIndex = 0;
    while (rowIndex < sheet.rows.length) {
      const recipeName = text(sheet.rows[rowIndex]?.[nameColumn]);
      const recipeKey = key(recipeName);
      if (!recipeName || ["lbs", "total", "percent", "cellulose"].includes(recipeKey)
        || recipeName.includes(":") || /^rev(?:ision)?\b/iu.test(recipeName)) {
        rowIndex += 1;
        continue;
      }
      let lbsRow = -1;
      for (let lookahead = rowIndex + 1; lookahead <= rowIndex + 3 && lookahead < sheet.rows.length; lookahead += 1) {
        if (key(sheet.rows[lookahead]?.[amountColumn]) === "lbs") {
          lbsRow = lookahead;
          break;
        }
      }
      if (lbsRow < 0) {
        rowIndex += 1;
        continue;
      }
      const slotText = sheet.rows.slice(rowIndex + 1, lbsRow)
        .map((row) => row.map(text).join(" ")).join(" ");
      const slotMatch = slotText.match(/\b(?:for\s+)?(1st|first|2nd|second|3rd|third|4th|fourth|[1-4])\s+(?:cheese\s+)?applicator\b/iu);
      const slot = slotMatch ? ({
        "1st": 1, first: 1, "2nd": 2, second: 2, "3rd": 3, third: 3,
        "4th": 4, fourth: 4, "1": 1, "2": 2, "3": 3, "4": 4,
      })[slotMatch[1].toLocaleLowerCase("en-US")] : null;
      const components = [];
      const issues = [];
      let cursor = lbsRow + 1;
      for (; cursor < sheet.rows.length; cursor += 1) {
        const componentName = text(sheet.rows[cursor]?.[nameColumn]);
        const amountText = text(sheet.rows[cursor]?.[amountColumn]);
        if (key(componentName) === "total" || key(componentName) === "percent") break;
        if (!componentName && !amountText) break;
        if (!componentName) break;
        result.sourceRows += 1;
        const amount = numeric(amountText)
          ?? numericWithParenthetical(amountText, /^(?:0|[1-9]\d*)(?:\.\d+)?\s*oz$/iu);
        if (formula.has(cursor)) {
          issues.push(`${sourceRef(sheet.name, cursor)}: formula or cached quantity needs review`);
        } else if (amount === null) {
          issues.push(`${sourceRef(sheet.name, cursor)}: ingredient batch pounds are missing or not numeric`);
        } else {
          components.push({ ingredient: componentName, lbs: amount });
        }
      }
      blocks.push({
        recipeName,
        rowIndex,
        slot,
        components,
        issues,
      });
      rowIndex = Math.max(cursor + 1, rowIndex + 1);
    }
  }

  if (blocks.length === 0) {
    if (nonemptyRows(sheet).length) {
      result.sourceRows += 1;
      unresolved(result, `${sheet.name}!sheet`, "No recognizable cheese LBS recipe blocks were found.");
    }
    return;
  }
  const firstBlockRow = Math.min(...blocks.map((block) => block.rowIndex));
  for (let rowIndex = 0; rowIndex < firstBlockRow; rowIndex += 1) {
    for (const cell of sheet.rows[rowIndex] ?? []) {
      const value = text(cell);
      if (!value || !value.includes(":") || /^\*\*/u.test(value) || /\b(?:note|shredder setting)\b/iu.test(value)) continue;
      const separator = value.indexOf(":");
      const flavor = text(value.slice(0, separator));
      const mixName = text(value.slice(separator + 1));
      if (flavor && mixName) assignments.push({ flavor: /^(?:all varieties|all flavors)$/iu.test(flavor) ? "" : flavor, mixName });
    }
  }
  const normalized = (value) => key(text(value).toLocaleLowerCase("en-US")
    .replace(/\bmozz\b/gu, "mozzarella")
    .replace(/\bmoz\b/gu, "mozzarella")
    .replace(/\bparm\b/gu, "parmesan")
    .replace(/\bprov\b/gu, "provolone"));
  const groups = new Map();
  for (const block of blocks) {
    const matches = assignments.filter((assignment) => normalized(assignment.mixName) === normalized(block.recipeName));
    const targets = matches.length ? [...new Set(matches.map((match) => match.flavor))] : [""];
    for (const flavor of targets) {
      const groupKey = normalized(`${brand} ${flavor}`);
      const group = groups.get(groupKey) ?? {
        flavor,
        blocks: [],
        values: {},
        issues: [],
      };
      group.blocks.push(block);
      if (!block.slot) group.issues.push("The recipe block does not explicitly name a cheese applicator slot.");
      if (!matches.length) group.issues.push("No exact flavor-to-recipe assignment was found; confirm the profile target.");
      if (block.issues.length) group.issues.push(...block.issues);
      if (block.slot && block.issues.length === 0 && block.components.length > 0) {
        const nameField = `app${block.slot}CheeseRecipeName`;
        const recipeField = `app${block.slot}CheeseRecipe`;
        if (Object.hasOwn(group.values, recipeField)) {
          group.issues.push(`More than one source recipe maps to applicator ${block.slot}; resolve the conflict manually.`);
        } else {
          group.values[nameField] = block.recipeName;
          group.values[recipeField] = block.components;
        }
      } else if (block.slot) {
        group.issues.push(`Applicator ${block.slot} recipe data is incomplete and must be corrected before staging.`);
      }
      groups.set(groupKey, group);
    }
  }
  for (const group of groups.values()) {
    const source = [...new Set(group.blocks.map((block) => sourceRef(sheet.name, block.rowIndex)))].join(", ").slice(0, 240);
    const sourceDetails = {
      recipes: group.blocks.map((block) => ({
        recipeName: block.recipeName,
        batchUnit: "lbs",
        components: block.components,
        explicitApplicatorSlot: block.slot,
        source: sourceRef(sheet.name, block.rowIndex),
      })),
      flavor: group.flavor || "unassigned",
    };
    outputRecord(result, "cheese-mix-specs", sheet.name, group.blocks[0].rowIndex,
      `${brand} ${group.flavor}`, `${brand} · ${group.flavor || "unassigned flavor"} · cheese setup`.slice(0, 200),
      brand, group.flavor, group.values, source, sourceDetails);
    for (const reason of [...new Set(group.issues)]) unresolved(result, source, reason);
  }
  for (const { row, index } of nonemptyRows(sheet)) {
    if (row.some((cell) => /\bshredder\s+setting\b|\bcellulose\s+percent\b/iu.test(text(cell)))) {
      unresolved(result, sourceRef(sheet.name, index), "This cheese mix field has no V3 profile mapping and remains review-only.");
    }
  }
}

function shippingRows(result, sheet) {
  const header = matchingHeader(sheet, (headers) =>
    headers.some((item) => ["pizza", "product", "brand"].includes(item))
      && headers.some((item) => item === "box" || item === "shipper")
      && headers.some((item) => item.startsWith("pizzas") || item === "pizzascs"));
  if (!header) {
    if (nonemptyRows(sheet).length) {
      result.sourceRows += 1;
      unresolved(result, `${sheet.name}!sheet`, "No supported product / pizzas-per-case header was found.");
    }
    return;
  }
  const nameColumn = header.headers.findIndex((item) => ["pizza", "product", "brand", "flavor"].includes(item));
  const firstColumn = (choices) => header.headers.findIndex((value) => choices.some((choice) =>
    value === choice || value.startsWith(choice)));
  const boxColumn = firstColumn(["box", "shipper"]);
  const circleColumn = firstColumn(["circle"]);
  const pizzasColumn = firstColumn(["pizzas"]);
  const casesColumn = header.headers.findIndex((value) => value === "cases" || value.startsWith("casesp"));
  const gripColumn = firstColumn(["gripshe"]);
  const stackingColumn = firstColumn(["stack"]);
  const knownColumns = new Set([nameColumn, boxColumn, circleColumn, pizzasColumn, casesColumn, gripColumn, stackingColumn]);
  const formula = formulaRows(sheet);
  for (let rowIndex = header.index + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    if (!dataRow(row)) continue;
    result.sourceRows += 1;
    const name = text(row[nameColumn]);
    if (!name || /^(?:total|notes?)$/iu.test(name)) {
      result.skippedRows += 1;
      continue;
    }
    if (formula.has(rowIndex)) {
      unresolved(result, sourceRef(sheet.name, rowIndex), "Formula or cached shipping value requires manager review.");
      continue;
    }
    const values = {};
    const unmapped = [];
    const box = boxColumn >= 0 ? text(row[boxColumn]) : "";
    if (box) {
      const lower = box.toLocaleLowerCase("en-US");
      const size = lower.match(/\b(7|11|12)\s*(?:''|["”]|in\b|”)?/u)?.[1];
      if (lower.includes("hsc")) values.shipper = "costco";
      else if (lower.includes("edw")) values.shipper = "edwardos";
      else if (size) values.shipper = `${size}in`;
      else unmapped.push(`Box: ${box}`);
    }
    const circle = circleColumn >= 0 ? text(row[circleColumn]) : "";
    if (circle) {
      const lower = circle.toLocaleLowerCase("en-US");
      const size = lower.match(/\b(7|11|12)\b/u)?.[1];
      if (/^(?:n\s*\/?\s*a|none)$/iu.test(circle)) values.circles = "none";
      else if (lower.includes("suscept") || lower.includes("microw")) values.circles = "microwave";
      else if (size) values.circles = `${size}in`;
      else unmapped.push(`Circle: ${circle}`);
    }
    const pizzas = pizzasColumn >= 0 ? text(row[pizzasColumn]) : "";
    if (pizzas) {
      const multipack = pizzas.match(/^([1-9]\d*)\s*[-–x×]\s*([1-9]\d*)\s*[- ]?\s*(?:pack|pk)s?$/iu);
      const quantity = multipack ? Number(multipack[1]) * Number(multipack[2]) : numeric(pizzas);
      if (Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100) values.pizzasPerCase = quantity;
      else unmapped.push(`Pizzas/CS: ${pizzas}`);
    }
    const cases = casesColumn >= 0 ? text(row[casesColumn]) : "";
    if (cases) {
      const quantity = numeric(cases);
      if (Number.isSafeInteger(quantity) && quantity > 0) values.casesPerSkid = quantity;
      else unmapped.push(`Cases: ${cases}`);
    }
    const grip = gripColumn >= 0 ? text(row[gripColumn]) : "";
    if (grip) {
      if (/^(?:n\s*\/?\s*a|none)$/iu.test(grip)) values.gripSheets = "none";
      else unmapped.push(`Grip sheets: ${grip}`);
    }
    const stacking = stackingColumn >= 0 ? text(row[stackingColumn]) : "";
    if (stacking) {
      const lower = stacking.toLocaleLowerCase("en-US");
      if (lower.includes("production-assistant")) values.skidStacking = "production-assistant";
      else if (lower.includes("hannaford")) values.skidStacking = "hannaford";
      else if (lower.includes("column")) values.skidStacking = "column";
      else unmapped.push(`Stacking: ${stacking}`);
    }
    for (let column = 0; column < header.headers.length; column += 1) {
      const cell = text(row[column]);
      if (cell && !knownColumns.has(column)) unmapped.push(`${header.headers[column] || `Column ${column + 1}`}: ${cell}`);
    }
    const brandColumn = findColumn(header.headers, ["brand"]);
    const flavorColumn = findColumn(header.headers, ["flavor"]);
    const brand = brandColumn >= 0 ? text(row[brandColumn]) : name;
    const flavor = flavorColumn >= 0 ? text(row[flavorColumn]) : "";
    outputRecord(result, "shipping-guides", sheet.name, rowIndex, name,
      `${FAMILY_LABELS["shipping-guides"]}: ${name}`.slice(0, 200), brand, flavor, values,
      sourceRef(sheet.name, rowIndex), { sourceLabel: name, unmapped });
    if (unmapped.length) {
      unresolved(result, sourceRef(sheet.name, rowIndex), `Unmapped shipping values remain review-only: ${unmapped.join("; ")}`);
    }
  }
}

function splitGuideFlavors(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(text(value.slice(start, index)));
      start = index + 1;
    }
  }
  parts.push(text(value.slice(start)));
  return parts.filter(Boolean);
}

function extractTrailingParentheses(value) {
  if (!value.endsWith(")")) return null;
  let depth = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === ")") depth += 1;
    else if (value[index] === "(") {
      depth -= 1;
      if (depth === 0) return {
        brand: text(value.slice(0, index)),
        flavors: text(value.slice(index + 1, -1)),
      };
    }
  }
  return null;
}

function sauceProcedureRows(result, sheet) {
  const formulas = formulaCells(sheet);
  let recipeName = "";
  let titleCell = null;
  for (let row = 0; row < Math.min(sheet.rows.length, 12); row += 1) {
    for (let column = 0; column < (sheet.rows[row]?.length ?? 0); column += 1) {
      const value = firstLine(sheet.rows[row]?.[column]);
      if (!/\bsauce\b/iu.test(value) || /^(?:materials|sauce barrel)$/iu.test(value)
        || /^(?:all ingredients|always tare|notes?:)/iu.test(value)) continue;
      recipeName = text(value.replace(/\s+(?:drum\s+)?procedure$/iu, ""));
      titleCell = { row, column };
      break;
    }
    if (recipeName) break;
  }
  if (!recipeName) return false;
  const allText = sheet.rows.flat().map(text).join(" ");
  const procedureLike = /\bmaterials\b/iu.test(allText) || /\bprocess\b/iu.test(allText)
    || sheet.rows.some((row) => row.some((cell) => ["lbs", "drumbatch"].includes(key(cell))));
  if (!procedureLike) return false;

  const reviewOnly = [];
  const procedure = [];
  const consumed = new Set();
  const consume = (row, column) => consumed.add(`${row}:${column}`);
  const review = (row, column, kind, value = sheet.rows[row]?.[column]) => {
    reviewOnly.push({ source: cellRef(sheet.name, row, column), kind, value: text(value) });
  };
  let table = null;
  for (let row = 0; row < sheet.rows.length && !table; row += 1) {
    for (let column = 1; column < (sheet.rows[row]?.length ?? 0); column += 1) {
      if (key(sheet.rows[row]?.[column]) !== "lbs") continue;
      const labelColumn = column - 1;
      const firstIngredient = text(sheet.rows[row + 1]?.[labelColumn]);
      if (!firstIngredient || numeric(firstIngredient) !== null) continue;
      table = { layout: "literal-lbs", headerRow: row, labelColumn, amountColumn: column, startRow: row + 1 };
      break;
    }
  }
  if (!table) {
    for (let row = 0; row < sheet.rows.length && !table; row += 1) {
      for (let column = 0; column + 2 < (sheet.rows[row]?.length ?? 0); column += 1) {
        if (key(sheet.rows[row]?.[column]) !== "drumbatch") continue;
        const full = key(sheet.rows[row]?.[column + 1]);
        const half = key(sheet.rows[row]?.[column + 2]);
        if (!full.startsWith("full") || !half.startsWith("half")) {
          unresolved(result, cellRef(sheet.name, row, column),
            "DRUM BATCH tables must explicitly identify adjacent full and half columns; this sheet remains review-only.");
          table = { invalid: true };
          break;
        }
        table = { layout: "drum-full-batch", headerRow: row, labelColumn: column, amountColumn: column + 1, startRow: row + 1 };
      }
    }
  }

  if (table?.invalid) {
    table = null;
  }
  if (!table) {
    const candidates = [];
    for (let labelColumn = 0; labelColumn + 2 < Math.max(0, ...sheet.rows.map((row) => row.length)); labelColumn += 1) {
      for (let amountColumn = labelColumn + 1; amountColumn <= labelColumn + 2; amountColumn += 1) {
        const unitColumn = amountColumn + 1;
        let start = -1;
        const finish = (end) => {
          if (start >= 0 && end - start >= 2) candidates.push({ labelColumn, amountColumn, unitColumn, startRow: start, endRow: end });
          start = -1;
        };
        for (let row = 0; row <= sheet.rows.length; row += 1) {
          const unit = key(sheet.rows[row]?.[unitColumn]);
          const ingredient = text(sheet.rows[row]?.[labelColumn]);
          const amount = text(sheet.rows[row]?.[amountColumn]);
          const spacerIsBlank = amountColumn === labelColumn + 1 || !text(sheet.rows[row]?.[labelColumn + 1]);
          const candidate = row < sheet.rows.length && ingredient && numeric(ingredient) === null && spacerIsBlank
            && /^(?:lbs?|qt|each|gallons?|oz|ounces?)(?:\b|\d)/iu.test(unit)
            && (numeric(amount) !== null || formulas.has(`${row}:${amountColumn}`));
          if (candidate) {
            if (start < 0) start = row;
          } else finish(row);
        }
      }
    }
    if (candidates.length) {
      candidates.sort((left, right) => (right.endRow - right.startRow) - (left.endRow - left.startRow));
      const candidate = candidates[0];
      table = { ...candidate, layout: "per-row-lbs", headerRow: candidate.startRow - 1 };
    }
  }

  const collectProcedure = () => {
    for (const { row, index } of nonemptyRows(sheet)) {
      const cells = row.flatMap((value, column) => {
        if (!text(value) || consumed.has(`${index}:${column}`)) return [];
        if (titleCell?.row === index && titleCell.column === column) return [];
        return [{ column, value: text(value) }];
      });
      if (!cells.length) continue;
      const line = cells.map((cell) => cell.value).join(" ");
      if (/^(?:\d{1,2}[\/]\d{1,2}[\/]\d{2,4}\s*)?(?:rev(?:ision)?\.?\s*\d+)$/iu.test(line)
        || /^\d{1,2}[\/]\d{1,2}[\/]\d{2,4}\s+(?:rev(?:ision)?\.?\s*\d+)$/iu.test(line)) continue;
      procedure.push({ source: cellRef(sheet.name, index, cells[0].column), text: line.slice(0, 1000) });
    }
  };

  if (!table) {
    result.sourceRows += 1;
    unresolved(result, `${sheet.name}!sheet`, "No literal sauce recipe table was recognized; the procedure remains review-only.");
    collectProcedure();
    for (const entry of procedure) unresolved(result, entry.source, `Review-only sauce procedure text: ${entry.text}`);
    return true;
  }

  const mixedOrExperimental = /(?:\bnot tested\b|\btested and\b|\bexperimental\b)/iu.test(allText)
    || (table.layout === "per-row-lbs" && Array.from({ length: table.endRow - table.startRow }, (_, offset) => {
      const unit = key(sheet.rows[table.startRow + offset]?.[table.unitColumn]);
      return !/^lbs?(?:\b|\d)/iu.test(unit);
    }).some(Boolean));
  if (mixedOrExperimental) {
    result.sourceRows += 1;
    for (let row = table.startRow; row < (table.endRow ?? sheet.rows.length); row += 1) {
      consume(row, table.labelColumn);
      consume(row, table.amountColumn);
      if (table.unitColumn !== undefined) consume(row, table.unitColumn);
    }
    collectProcedure();
    unresolved(result, cellRef(sheet.name, table.startRow, table.labelColumn),
      "Mixed-unit or experimental/test-not-tested sauce tables remain review-only; no recipe was staged.");
    for (const entry of procedure) unresolved(result, entry.source, `Review-only sauce procedure text: ${entry.text}`);
    return true;
  }

  result.sourceRows += 1;
  const components = [];
  let totalRow = -1;
  const endRow = table.endRow ?? sheet.rows.length;
  for (let row = table.startRow; row < endRow; row += 1) {
    const ingredient = firstLine(sheet.rows[row]?.[table.labelColumn]);
    if (/^total(?:\s+weight)?$/iu.test(ingredient)) {
      totalRow = row;
      consume(row, table.labelColumn);
      consume(row, table.amountColumn);
      break;
    }
    if (!ingredient) {
      if (table.layout === "per-row-lbs") continue;
      if (dataRow(sheet.rows[row] ?? [])) continue;
      if (components.length) break;
      continue;
    }
    consume(row, table.labelColumn);
    consume(row, table.amountColumn);
    if (table.unitColumn !== undefined) consume(row, table.unitColumn);
    const amountText = text(sheet.rows[row]?.[table.amountColumn]);
    let amount = null;
    if (formulas.has(`${row}:${table.amountColumn}`)) {
      review(row, table.amountColumn, "formula");
    } else {
      amount = numeric(amountText) ?? (table.layout === "per-row-lbs" ? null : numericWithParenthetical(amountText));
      if (amount === null) review(row, table.amountColumn, "nonliteral-or-missing-lbs");
    }
    if (amount !== null) components.push({ ingredient, lbs: amount });
    for (let column = table.amountColumn + 1; column < (sheet.rows[row]?.length ?? 0); column += 1) {
      if (column === table.unitColumn || !text(sheet.rows[row]?.[column])) continue;
      review(row, column, formulas.has(`${row}:${column}`) ? "alternate-formula-batch" : "alternate-or-annotation");
    }
  }
  if (table.headerRow >= 0) {
    for (let column = 0; column < (sheet.rows[table.headerRow]?.length ?? 0); column += 1) consume(table.headerRow, column);
  }
  if (totalRow >= 0 && !formulas.has(`${totalRow}:${table.amountColumn}`)) {
    const total = numeric(sheet.rows[totalRow]?.[table.amountColumn])
      ?? numericWithParenthetical(sheet.rows[totalRow]?.[table.amountColumn]);
    if (total !== null) table.total = total;
    else if (text(sheet.rows[totalRow]?.[table.amountColumn])) review(totalRow, table.amountColumn, "nonliteral-total");
  } else if (totalRow >= 0) review(totalRow, table.amountColumn, "formula-total");
  collectProcedure();
  if (!components.length) {
    unresolved(result, cellRef(sheet.name, table.startRow, table.labelColumn),
      "The sauce table has no readable literal base-batch ingredients; no recipe was staged.");
    for (const entry of procedure) unresolved(result, entry.source, `Review-only sauce procedure text: ${entry.text}`);
    return true;
  }
  const values = { frontlineRecipeName: recipeName, frontlineRecipe: components };
  if (table.total !== undefined) values.sauceBarrelLbs = table.total;
  const source = cellRef(sheet.name, table.startRow, table.labelColumn);
  outputRecord(result, "sauce-guides", sheet.name, Math.max(0, table.headerRow), recipeName,
    `${FAMILY_LABELS["sauce-guides"]}: ${recipeName}`, "", "", values, source,
    { layout: table.layout, reviewOnly, procedure });
  unresolved(result, source,
    "Materials, instructions, formula totals, alternate batches, and annotations remain review-only where present.");
  return true;
}

function sauceRows(result, sheet) {
  if (sauceProcedureRows(result, sheet)) return;
  const formula = formulaRows(sheet);
  const lines = nonemptyRows(sheet);
  let recognized = 0;
  for (const { row, index } of lines) {
    const line = row.map(text).filter(Boolean).join(" ");
    if (!line || /^(?:brand|flavor|recipe|sauce guide)\b/iu.test(line)) {
      result.sourceRows += 1;
      result.skippedRows += 1;
      continue;
    }
    result.sourceRows += 1;
    if (formula.has(index)) {
      unresolved(result, sourceRef(sheet.name, index), "Formula or cached guide text requires manager review.");
      continue;
    }
    const match = line.match(/^(.+?)\s+uses\s+(.+?)\s+(?:on|for)\s+(.+?)\s+at\s+([\d.]+)\s*oz(.*)?$/iu);
    if (!match) {
      unresolved(result, sourceRef(sheet.name, index), "Guide row does not match the supported explicit sauce-assignment sentence.");
      continue;
    }
    const brand = text(match[1]);
    const recipeRaw = text(match[2]);
    const recipeName = /^their(?:\s+\w+)?\s+recipe$/iu.test(recipeRaw) ? brand : recipeRaw;
    const parseFlavors = (raw) => {
      const flavorText = text(raw).replace(/[.]$/u, "");
      if (/^all(?:\s+(?:(?:other)\s+)?(?:(?:\d+["']?\s*)?(?:varieties|sizes?|flavors?|9"|12")))?$/iu.test(flavorText)
        || /^all\s+other\b/iu.test(flavorText)) return [""];
      const tokens = [];
      let depth = 0;
      let current = "";
      for (const character of flavorText) {
        if (character === "(") depth += 1;
        else if (character === ")") depth -= 1;
        if (depth === 0 && (character === "," || character === "&")) {
          if (text(current)) tokens.push(text(current));
          current = "";
        } else current += character;
      }
      if (text(current)) tokens.push(text(current));
      return tokens;
    };
    const flavors = parseFlavors(match[3]);
    const ounces = Number(match[4]);
    if (!brand || !recipeName || flavors.length === 0 || !Number.isFinite(ounces) || ounces <= 0) {
      unresolved(result, sourceRef(sheet.name, index), "Brand, recipe, and flavor assignment must be explicit.");
      continue;
    }
    const assignments = [{ flavors, ounces }];
    const continuation = /\band\s+(?:on|for)\s+(.+?)\s+at\s+([\d.]+)\s*oz/giu;
    let continued;
    while ((continued = continuation.exec(match[5] || "")) !== null) {
      const continuationOunces = Number(continued[2]);
      const continuationFlavors = parseFlavors(continued[1]);
      if (continuationOunces > 0 && continuationFlavors.length) {
        assignments.push({ flavors: continuationFlavors, ounces: continuationOunces });
      } else {
        unresolved(result, sourceRef(sheet.name, index), "A sauce-guide continuation has invalid flavor or ounce values.");
      }
    }
    for (const assignment of assignments) {
      for (const flavor of assignment.flavors) {
        const values = { frontlineRecipeName: recipeName, sauceOzPerPizza: assignment.ounces };
        outputRecord(result, "sauce-guides", sheet.name, index, `${brand} ${flavor}`,
          `${FAMILY_LABELS["sauce-guides"]}: ${brand}${flavor ? ` · ${flavor}` : " · all flavors"}`,
          brand, flavor, values, sourceRef(sheet.name, index));
      }
    }
    recognized += 1;
  }
  if (!recognized && lines.length === 0) return;
}

function doughRows(result, sheet) {
  const formula = formulaRows(sheet);
  for (const { row, index } of nonemptyRows(sheet)) {
    const line = text(row[0]);
    if (!line) continue;
    if (/^pizza\s+(?:to\s+)?dough\b/iu.test(line)) {
      result.skippedRows += 1;
      continue;
    }
    result.sourceRows += 1;
    if (formula.has(index)) {
      unresolved(result, sourceRef(sheet.name, index), "Formula or cached guide text requires manager review.");
      continue;
    }
    const match = line.match(/^(.+\))\s*=\s*(.+?)\s*$/u);
    if (!match) {
      unresolved(result, sourceRef(sheet.name, index), "First-column guide row must state Brand (flavors) = Dough Recipe Name.");
      continue;
    }
    const left = text(match[1]);
    const recipeName = text(match[2]);
    const assignment = extractTrailingParentheses(left);
    const brand = assignment?.brand ?? "";
    const flavors = assignment
      ? (/^all$/iu.test(assignment.flavors) ? [""] : splitGuideFlavors(assignment.flavors))
      : [];
    if (!brand || !recipeName || flavors.length === 0) {
      unresolved(result, sourceRef(sheet.name, index), "Brand and dough recipe name must be explicit.");
      continue;
    }
    for (const flavor of flavors) {
      outputRecord(result, "dough-guides", sheet.name, index, `${brand} ${flavor}`,
        `${FAMILY_LABELS["dough-guides"]}: ${brand}${flavor ? ` · ${flavor}` : " · all flavors"}`,
        brand, flavor, { doughRecipeName: recipeName }, sourceRef(sheet.name, index));
    }
  }
}

const PARSERS = Object.freeze({
  "spec-sheets": specRows,
  "premix-sheets": premixRows,
  "cheese-mix-specs": cheeseRows,
  "shipping-guides": shippingRows,
  "sauce-guides": sauceRows,
  "dough-guides": doughRows,
});

export function parseSourceWorkbook(family, buffer, fileName) {
  if (!CSV_SPECIAL_FAMILIES.has(family)) fail("Choose one of the six supported V1 source families.");
  if (!Buffer.isBuffer(buffer) || buffer.byteLength > workbookCapacityImportLimits.maxBytes) {
    fail("Source workbooks must be no larger than 5 MiB.");
  }
  const parsedFile = family === "sauce-guides" && /\.docx$/iu.test(String(fileName ?? ""))
    ? {
      fileName,
      fileSha256: createHash("sha256").update(buffer).digest("hex"),
      sheets: [{ name: "Document", rows: docxText(buffer, fileName), formulas: [] }],
    }
    : readWorkbookSheets(buffer, fileName);
  const result = { records: [], unresolved: [], sourceRows: 0, skippedRows: 0, codes: new Set() };
  for (const sheet of parsedFile.sheets) PARSERS[family](result, sheet);
  if (result.sourceRows > MAX_IMPORT_ROWS || result.unresolved.length > MAX_IMPORT_ROWS) {
    fail("A source workbook may contain no more than 2,000 reviewable source rows.");
  }
  if (result.records.length === 0 && result.unresolved.length === 0) {
    fail("No rows were found for this source family.");
  }
  const response = {
    family,
    targetFamily: family === "premix-sheets" ? "mixes" : "run-templates",
    parserVersion: VERSION,
    fileSha256: parsedFile.fileSha256,
    sourceRows: result.sourceRows,
    proposedRows: result.records.length,
    skippedRows: result.skippedRows,
    unresolvedRows: result.unresolved,
    records: result.records,
  };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > 2 * 1024 * 1024) {
    fail("The source preview exceeds the 2 MiB response limit; split the workbook into smaller files.");
  }
  return response;
}

export const sourceWorkbookImportLimits = Object.freeze({
  families: Object.freeze(Object.keys(PARSERS)),
  maxBytes: workbookCapacityImportLimits.maxBytes,
  maxRows: MAX_IMPORT_ROWS,
  parserVersion: VERSION,
});
