import { describe, expect, it } from 'vitest';
import {
  canonicalKeyForStock,
  createNewStockPreview,
  detectHardwareType,
  findCotsStockMatches,
  getPreviewCandidate,
  isHardwareStock,
  mergeAliases,
  tokenizeStockText
} from './cotsStocking.js';

const items = [
  { id: 'gear', canonical_name: 'Gear 84T', aliases: ['84 tooth gear'], quantity: 5 },
  { id: 'belt', canonical_name: '84T HTD Belt', aliases: ['htd 84t'], quantity: 2 },
  { id: 'bearing', canonical_name: '1/2 Bearing', aliases: [], quantity: 9 },
  { id: 'pulley32', canonical_name: '32T HTD Pulley', aliases: ['32 tooth htd pulley'], quantity: 6 },
  { id: 'gear32', canonical_name: '32T Gear', aliases: ['32 tooth gear'], quantity: 4 },
  { id: 'pulley36', canonical_name: '36T HTD Pulley', aliases: ['36 tooth htd pulley'], quantity: 1 }
];

describe('cots stocking helpers', () => {
  it('normalizes tooth counts into comparable tokens', () => {
    expect(tokenizeStockText('84 tooth gear')).toContain('tooth:84');
    expect(tokenizeStockText('84t gear')).toContain('tooth:84');
    expect(canonicalKeyForStock('Gear   84 Tooth')).toBe('gear 84t');
  });

  it('prefers gear matches over unrelated 84t items', () => {
    const matches = findCotsStockMatches(items, '84t gear');
    expect(matches[0]?.item?.id).toBe('gear');
    expect(matches.some((match) => match.item.id === 'belt')).toBe(false);
  });

  it('treats pulleys, gears, sprockets, belts, and bearings as mutually exclusive', () => {
    const matches = findCotsStockMatches(items, '32 tooth htd pulley');
    expect(matches[0]?.item?.id).toBe('pulley32');
    expect(matches.some((match) => match.item.id === 'gear32')).toBe(false);
  });

  it('ignores conflicting aliases when canonical part types disagree', () => {
    const poisonedItems = [
      { id: 'gear32', canonical_name: '32T Gear', aliases: ['32t htd pulley'], quantity: 4 }
    ];

    const preview = getPreviewCandidate(poisonedItems, '32t htd pulley');
    expect(preview?.mode).toBe('new');
  });

  it('requires exact number matches', () => {
    const matches = findCotsStockMatches(items, '32t htd pulley');
    expect(matches.some((match) => match.item.id === 'pulley36')).toBe(false);
  });

  it('returns a new preview when no stock item matches', () => {
    const preview = getPreviewCandidate(items, 'new sprocket');
    expect(preview?.mode).toBe('new');
    expect(preview?.item?.quantity).toBe(0);
  });

  it('detects hardware categories for level-based tracking', () => {
    expect(detectHardwareType('10-32 bolt')).toBe('bolt');
    expect(detectHardwareType('3/8 washer')).toBe('washer');
    expect(isHardwareStock('1/4 nylock nut')).toBe(true);
    expect(isHardwareStock('32t gear')).toBe(false);
  });

  it('can force a new preview even when a saved item would otherwise match', () => {
    const preview = createNewStockPreview('84 tooth gear');
    expect(preview?.mode).toBe('new');
    expect(preview?.item?.canonical_name).toBe('84 tooth gear');
  });

  it('keeps learned aliases unique and capped', () => {
    // '84 tooth gear' normalizes to '84t gear' (tooth → t), so it dedupes
    // against the incoming query rather than surviving as a third alias.
    const aliases = mergeAliases(['84 tooth gear', 'gear eighty four'], '84t gear', 'Gear 84T');
    expect(aliases).toEqual(['84t gear', 'gear eighty four']);
  });

  it('does not learn aliases with conflicting exclusive part types', () => {
    const aliases = mergeAliases(['32 tooth gear'], '32t htd pulley', '32T Gear');
    expect(aliases).toEqual(['32 tooth gear']);
  });
});
