const SOURCE_ORDER = Object.freeze([
  "spec-sheets",
  "dough-guides",
  "sauce-guides",
  "premix-sheets",
  "cheese-mix-specs",
  "shipping-guides",
]);

const REFERENCE_FIELDS = Object.freeze([
  "doughRecipeName",
  "doughRecipe",
  "app1CheeseRecipeName",
  "app1CheeseRecipe",
  "app2CheeseRecipeName",
  "app2CheeseRecipe",
  "app3CheeseRecipeName",
  "app3CheeseRecipe",
  "app4CheeseRecipeName",
  "app4CheeseRecipe",
  "frontlineRecipeName",
  "frontlineRecipe",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function blank(value) {
  return value === null || value === undefined || value === "";
}

export function normalizedSetupIdentity(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/gu, "'")
    .replace(/'/gu, "")
    .replace(/\b(?:standard|regular|pizza)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function editDistanceWithinTwo(left, right) {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5 || Math.abs(left.length - right.length) > 2) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let minimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      minimum = Math.min(minimum, current[column]);
    }
    if (minimum > 2) return false;
    previous = current;
  }
  return previous[right.length] <= 2;
}

function digits(value) {
  return String(value).match(/\d+(?:\.\d+)?/gu)?.join("-") ?? "";
}

function fieldsFor(record) {
  const fields = new Map([["name", record.name]]);
  for (const [key, value] of Object.entries(record.data ?? {})) {
    if (key === "values" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [child, childValue] of Object.entries(value)) fields.set(`values.${child}`, childValue);
    } else {
      fields.set(key, value);
    }
  }
  return fields;
}

function citation(importItem, record) {
  return {
    importId: importItem.importId,
    revision: importItem.revision,
    importStatus: importItem.status,
    targetFamily: importItem.family,
    sourceFamily: importItem.sourceSummary.sourceFamily,
    sourceSha256: importItem.sourceSummary.sourceSha256,
    parserVersion: importItem.sourceSummary.parserVersion,
    source: record.source ?? null,
    sourceDetails: record.sourceDetails ?? null,
  };
}

function candidateCode(candidate) {
  return candidate.code;
}

function dependencyCandidates(reference, currentMixes, proposedMixes) {
  const exactCode = reference.trim().toLocaleLowerCase("en-US");
  const exactName = normalizedSetupIdentity(reference);
  const matches = new Map();
  for (const candidate of [...currentMixes, ...proposedMixes]) {
    if (candidate.code.toLocaleLowerCase("en-US") === exactCode
      || (exactName && normalizedSetupIdentity(candidate.name) === exactName)) {
      matches.set(candidate.code, candidate);
    }
  }
  if (matches.size > 0) return { matches: [...matches.values()], suggestions: [] };
  const suggestions = new Map();
  if (exactName) {
    for (const candidate of [...currentMixes, ...proposedMixes]) {
      const candidateName = normalizedSetupIdentity(candidate.name);
      if (digits(candidateName) === digits(exactName) && editDistanceWithinTwo(exactName, candidateName)) {
        suggestions.set(candidate.code, candidate);
      }
    }
  }
  return { matches: [], suggestions: [...suggestions.values()] };
}

export function projectCombinedSetupReview(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.imports)
    || payload.imports.length < 1 || payload.imports.length > 100
    || !Array.isArray(payload.currentRecords)) {
    throw new TypeError("Canonical combined-review inputs are required.");
  }
  const imports = [...payload.imports].sort((left, right) => {
    const familyDifference = SOURCE_ORDER.indexOf(left.sourceSummary.sourceFamily)
      - SOURCE_ORDER.indexOf(right.sourceSummary.sourceFamily);
    return familyDifference || left.importId.localeCompare(right.importId);
  });
  const currentByIdentity = new Map(payload.currentRecords.map((record) => [
    `${record.family}\u0000${record.code.toLocaleLowerCase("en-US")}`,
    record,
  ]));
  const records = [];
  for (const importItem of imports) {
    for (const record of importItem.records) {
      records.push({ importItem, record, fields: fieldsFor(record) });
    }
  }
  const entryGroups = new Map();
  for (const item of records) {
    for (const [field, value] of item.fields) {
      const key = `${item.importItem.family}\u0000${item.record.code.toLocaleLowerCase("en-US")}\u0000${field}`;
      if (!entryGroups.has(key)) entryGroups.set(key, []);
      entryGroups.get(key).push({ ...item, value });
    }
  }
  const entries = [];
  for (const [key, proposals] of entryGroups) {
    const [targetFamily, codeKey, field] = key.split("\u0000");
    const first = proposals[0];
    const currentRecord = currentByIdentity.get(`${targetFamily}\u0000${codeKey}`) ?? null;
    const currentFields = currentRecord ? fieldsFor(currentRecord) : new Map();
    const currentPresent = currentFields.has(field);
    const currentValue = currentPresent ? currentFields.get(field) : null;
    const uniqueValues = [];
    for (const proposal of proposals) {
      if (!uniqueValues.some((value) => sameValue(value, proposal.value))) uniqueValues.push(proposal.value);
    }
    let disposition;
    if (uniqueValues.length > 1) disposition = "conflict";
    else if (currentPresent && sameValue(currentValue, uniqueValues[0])) disposition = "match";
    else if (!currentPresent || blank(currentValue)) disposition = "fill";
    else disposition = "mismatch";
    entries.push({
      targetFamily,
      code: first.record.code,
      field,
      currentRecordPresent: Boolean(currentRecord),
      currentValue,
      proposedValues: uniqueValues,
      disposition,
      requiresDecision: disposition === "conflict" || disposition === "mismatch",
      proposals: proposals.map((proposal) => ({
        code: proposal.record.code,
        value: proposal.value,
        ...citation(proposal.importItem, proposal.record),
      })),
    });
  }
  entries.sort((left, right) => left.targetFamily.localeCompare(right.targetFamily)
    || left.code.toLocaleLowerCase("en-US").localeCompare(right.code.toLocaleLowerCase("en-US"))
    || left.field.localeCompare(right.field));

  const unresolvedMap = new Map();
  const nameGroups = new Map();
  for (const item of records) {
    const normalized = normalizedSetupIdentity(item.record.name);
    if (!normalized) continue;
    const key = `${item.importItem.family}\u0000${normalized}`;
    if (!nameGroups.has(key)) nameGroups.set(key, new Map());
    nameGroups.get(key).set(item.record.code, item);
  }
  for (const [key, candidates] of nameGroups) {
    if (candidates.size < 2) continue;
    const [targetFamily, normalizedName] = key.split("\u0000");
    unresolvedMap.set(`name\u0000${key}`, {
      type: "ambiguous-name",
      targetFamily,
      normalizedName,
      reference: null,
      candidates: [...candidates.values()].map((item) => ({
        code: item.record.code,
        name: item.record.name,
        ...citation(item.importItem, item.record),
      })).sort((left, right) => left.code.localeCompare(right.code)),
      suggestions: [],
    });
  }

  const missingDependencies = [];
  const currentMixes = payload.currentRecords.filter((record) => record.family === "mixes");
  const proposedMixes = records.filter((item) => item.importItem.family === "mixes").map((item) => item.record);
  for (const item of records) {
    if (item.importItem.family !== "run-templates") continue;
    const values = item.record.data?.values ?? {};
    for (const field of REFERENCE_FIELDS) {
      const reference = values[field];
      if (typeof reference !== "string" || !reference.trim()) continue;
      const result = dependencyCandidates(reference, currentMixes, proposedMixes);
      if (result.matches.length === 1) continue;
      const base = {
        targetFamily: "run-templates",
        code: item.record.code,
        field: `values.${field}`,
        reference,
        ...citation(item.importItem, item.record),
      };
      if (result.matches.length > 1) {
        const identityKey = `dependency\u0000${item.importItem.importId}\u0000${item.record.code}\u0000${field}`;
        unresolvedMap.set(identityKey, {
          type: "ambiguous-dependency",
          targetFamily: "run-templates",
          normalizedName: normalizedSetupIdentity(reference),
          reference,
          candidates: result.matches.map((candidate) => ({ code: candidate.code, name: candidate.name }))
            .sort((left, right) => left.code.localeCompare(right.code)),
          suggestions: [],
          ...base,
        });
      } else {
        missingDependencies.push({
          ...base,
          reason: "no-unique-exact-or-normalized-match",
          suggestions: result.suggestions.map((candidate) => ({ code: candidate.code, name: candidate.name }))
            .sort((left, right) => left.code.localeCompare(right.code)),
          suggestionOnly: true,
        });
      }
    }
  }
  missingDependencies.sort((left, right) => left.code.localeCompare(right.code)
    || left.field.localeCompare(right.field) || left.importId.localeCompare(right.importId));
  const unresolvedIdentities = [...unresolvedMap.values()].sort((left, right) =>
    left.type.localeCompare(right.type) || left.targetFamily.localeCompare(right.targetFamily)
    || (left.reference ?? left.normalizedName).localeCompare(right.reference ?? right.normalizedName));
  const summary = {
    imports: imports.length,
    records: records.length,
    fills: entries.filter((entry) => entry.disposition === "fill").length,
    matches: entries.filter((entry) => entry.disposition === "match").length,
    mismatches: entries.filter((entry) => entry.disposition === "mismatch").length,
    conflicts: entries.filter((entry) => entry.disposition === "conflict").length,
    missingDependencies: missingDependencies.length,
    unresolvedIdentities: unresolvedIdentities.length,
  };
  return {
    id: payload.id,
    createdBy: payload.createdBy,
    createdAt: payload.createdAt,
    replayed: payload.replayed === true,
    dependencyOrder: [...SOURCE_ORDER],
    imports: imports.map((importItem) => ({
      importId: importItem.importId,
      revision: importItem.revision,
      family: importItem.family,
      status: importItem.status,
      rowCount: importItem.records.length,
      sourceSummary: importItem.sourceSummary,
    })),
    entries,
    missingDependencies,
    unresolvedIdentities,
    summary,
  };
}

export const combinedSetupReviewLimits = Object.freeze({
  maxImports: 100,
  maxRecords: 2000,
  sourceOrder: SOURCE_ORDER,
});
