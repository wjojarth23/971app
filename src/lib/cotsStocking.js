const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to']);
const EXCLUSIVE_PART_TYPES = new Set([
  'pulley',
  'gear',
  'sprocket',
  'belt',
  'bearing',
  'bolt',
  'washer',
  'nut',
  'screw'
]);
const HARDWARE_TYPES = new Set(['bolt', 'washer', 'nut', 'screw']);

function singularize(token) {
  if (token.length > 3 && token.endsWith('s')) {
    return token.slice(0, -1);
  }
  return token;
}

export function normalizeStockText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(\d+)\s*(tooth|teeth)\b/g, '$1t')
    .replace(/[^a-z0-9+/.\-\s]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalKeyForStock(value) {
  return normalizeStockText(value).replace(/\s+/g, ' ');
}

export function detectHardwareType(value) {
  const tokens = tokenizeStockText(value);
  return tokens.find((token) => HARDWARE_TYPES.has(token)) || null;
}

export function isHardwareStock(value) {
  return !!detectHardwareType(value);
}

export function tokenizeStockText(value) {
  const normalized = normalizeStockText(value);
  const rawTokens = normalized.match(/[a-z0-9+/\.]+/g) || [];
  const tokens = new Set();

  for (const rawToken of rawTokens) {
    const token = singularize(rawToken);
    if (!token || STOP_WORDS.has(token)) continue;
    tokens.add(token);

    const toothMatch = token.match(/^(\d+)t$/);
    if (toothMatch) {
      tokens.add(`tooth:${toothMatch[1]}`);
      tokens.add(toothMatch[1]);
    }
  }

  return [...tokens];
}

function getExclusivePartTypes(tokens) {
  return tokens.filter((token) => EXCLUSIVE_PART_TYPES.has(token));
}

function hasConflictingExclusiveTypes(aTokens, bTokens) {
  const aTypes = getExclusivePartTypes(aTokens);
  const bTypes = getExclusivePartTypes(bTokens);

  if (!aTypes.length || !bTypes.length) return false;
  return !aTypes.some((type) => bTypes.includes(type));
}

function getNumericTokens(tokens) {
  return tokens.filter((token) => /^\d+(?:\/\d+|\.\d+)?$/.test(token) || /^tooth:\d+$/.test(token));
}

function buildCandidatePhrases(item) {
  return [item?.canonical_name, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
    .map((entry) => normalizeStockText(entry))
    .filter(Boolean);
}

function scoreCandidate(item, query) {
  const normalizedQuery = normalizeStockText(query);
  if (!normalizedQuery) return null;

  const queryTokens = tokenizeStockText(normalizedQuery);
  if (!queryTokens.length) return null;

  const phrases = buildCandidatePhrases(item);
  const phraseSet = new Set(phrases);
  const canonicalTokens = tokenizeStockText(item?.canonical_name);
  const candidateTokensList = phrases.flatMap((phrase) => tokenizeStockText(phrase));
  const candidateTokens = new Set(candidateTokensList);
  const queryNumbers = getNumericTokens(queryTokens);
  const candidateNumbers = new Set(getNumericTokens(candidateTokensList));

  if (hasConflictingExclusiveTypes(queryTokens, canonicalTokens)) return null;

  if (queryNumbers.length) {
    const hasAllQueryNumbers = queryNumbers.every((token) => candidateNumbers.has(token));
    if (!hasAllQueryNumbers) return null;
  }

  const overlaps = queryTokens.filter((token) => candidateTokens.has(token));
  const missing = queryTokens.filter((token) => !candidateTokens.has(token));

  if (!overlaps.length) return null;

  let score = overlaps.length * 24 - missing.length * 18;
  const fullCoverage = missing.length === 0;

  if (phraseSet.has(normalizedQuery)) score += 140;
  if (phrases.some((phrase) => phrase.startsWith(normalizedQuery))) score += 18;
  if (fullCoverage) score += 60;
  if (queryTokens.length > 1 && overlaps.length === 1) score -= 30;

  if (score <= 0) return null;

  return {
    item,
    score,
    overlaps,
    missing,
    fullCoverage,
    exactPhrase: phraseSet.has(normalizedQuery)
  };
}

export function findCotsStockMatches(items, query, limit = 8) {
  return (Array.isArray(items) ? items : [])
    .map((item) => scoreCandidate(item, query))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.item?.canonical_name || '').localeCompare(String(b.item?.canonical_name || ''), undefined, {
        sensitivity: 'base'
      });
    })
    .slice(0, limit);
}

export function getPreviewCandidate(items, query, selectedId = null) {
  const normalizedQuery = normalizeStockText(query);
  const list = Array.isArray(items) ? items : [];

  if (selectedId) {
    const selected = list.find((item) => item.id === selectedId);
    if (selected) return { mode: 'existing', item: selected, query: normalizedQuery };
  }

  if (!normalizedQuery) return null;

  const matches = findCotsStockMatches(list, normalizedQuery, 1);
  if (matches.length > 0) {
    return { mode: 'existing', item: matches[0].item, match: matches[0], query: normalizedQuery };
  }

  return {
    mode: 'new',
    item: {
      canonical_name: query.trim(),
      canonical_key: canonicalKeyForStock(query),
      aliases: [],
      quantity: 0
    },
    query: normalizedQuery
  };
}

export function createNewStockPreview(query) {
  return {
    mode: 'new',
    item: {
      canonical_name: query.trim(),
      canonical_key: canonicalKeyForStock(query),
      aliases: [],
      quantity: 0
    },
    query: normalizeStockText(query)
  };
}

export function mergeAliases(existingAliases, query, canonicalName) {
  const normalizedQuery = normalizeStockText(query);
  if (!normalizedQuery) return Array.isArray(existingAliases) ? existingAliases : [];
  if (normalizedQuery === normalizeStockText(canonicalName)) {
    return Array.isArray(existingAliases) ? existingAliases : [];
  }
  if (hasConflictingExclusiveTypes(tokenizeStockText(query), tokenizeStockText(canonicalName))) {
    return Array.isArray(existingAliases) ? existingAliases : [];
  }

  const next = [];
  const seen = new Set();

  for (const alias of Array.isArray(existingAliases) ? existingAliases : []) {
    const normalizedAlias = normalizeStockText(alias);
    if (!normalizedAlias || normalizedAlias === normalizedQuery || seen.has(normalizedAlias)) continue;
    seen.add(normalizedAlias);
    next.push(alias);
  }

  next.unshift(query.trim());
  return next.slice(0, 20);
}
