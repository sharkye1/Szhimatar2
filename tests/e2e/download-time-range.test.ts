import { describe, expect, it } from 'vitest';
import { parseDownloadTimestamp, parseDownloadTimeRange, formatDownloadTimestamp } from '../../src/utils/downloadHelpers';

describe('download time ranges', () => {
  it('accepts seconds and minute/hour timestamps with fractions', () => {
    expect(parseDownloadTimestamp(' 90.5 ')).toBe(90.5);
    expect(parseDownloadTimestamp('01:30.250')).toBe(90.25);
    expect(parseDownloadTimestamp('1:02:03')).toBe(3723);
    expect(parseDownloadTimeRange('1:30', '2:00')).toEqual({ startSeconds: 90, endSeconds: 120 });
  });
  it('supports a blank start or end', () => {
    expect(parseDownloadTimeRange('', '30')).toEqual({ startSeconds: 0, endSeconds: 30 });
    expect(parseDownloadTimeRange('90', '')).toEqual({ startSeconds: 90 });
  });
  it('rejects malformed, empty, negative and reversed ranges', () => {
    for (const value of ['', '-1', '1:60', '1:00:60', '1:2:3:4', 'NaN', 'Infinity', '1e5', '1:01x']) {
      expect(parseDownloadTimestamp(value)).toBeNull();
    }
    for (const [start, end] of [['', ''], ['0', ''], ['30', '20'], ['30', '30'], ['x', '60'], ['0', 'bad']]) {
      expect(parseDownloadTimeRange(start, end)).toBeNull();
    }
  });
  it('formats ranges for queue badges', () => {
    expect(formatDownloadTimestamp(0)).toBe('00:00');
    expect(formatDownloadTimestamp(1.5)).toBe('00:01.5');
    expect(formatDownloadTimestamp(90.5)).toBe('01:30.5');
    expect(formatDownloadTimestamp(3600)).toBe('1:00:00');
  });
});
