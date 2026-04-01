import { describe, expect, it } from 'vitest';
import {
  formatPacificDate,
  formatPacificDateTimeInputValue,
  formatPacificDateTimeWithZone,
  formatPacificTimeWithZone,
  parsePacificDateTimeInput
} from './timezone.js';

describe('Pacific timezone helpers', () => {
  it('parses datetime-local values as Pacific time', () => {
    const parsed = parsePacificDateTimeInput('2026-04-03T15:00');
    expect(parsed?.toISOString()).toBe('2026-04-03T22:00:00.000Z');
  });

  it('formats ISO values back into Pacific datetime-local values', () => {
    expect(formatPacificDateTimeInputValue('2026-04-03T22:00:00.000Z')).toBe('2026-04-03T15:00');
  });

  it('formats dates and times with a Pacific label', () => {
    expect(formatPacificDate('2026-04-03T22:00:00.000Z')).toBe('Apr 3, 2026');
    expect(formatPacificDate('2026-04-03')).toBe('Apr 3, 2026');
    expect(formatPacificTimeWithZone('2026-04-03T22:00:00.000Z')).toBe('3:00 PM PT');
    expect(formatPacificDateTimeWithZone('2026-04-03T22:00:00.000Z')).toBe('Apr 3, 2026, 3:00 PM PT');
  });
});
