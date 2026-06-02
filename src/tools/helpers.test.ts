import { describe, expect, it } from 'vitest';
import { SnApiError } from '../clients/servicenow.js';
import {
  boolStr,
  handleError,
  isSysId,
  resolveDisplay,
  resolveValue,
} from './helpers.js';

describe('resolveValue', () => {
  it('returns the value field from an SnReference', () => {
    expect(resolveValue({ value: 'sys123', display_value: 'Hardware' })).toBe(
      'sys123',
    );
  });

  it('returns value when display_value is empty', () => {
    expect(resolveValue({ value: 'abc', display_value: '' })).toBe('abc');
  });
});

describe('resolveDisplay', () => {
  it('returns display_value from an SnReference', () => {
    expect(resolveDisplay({ value: 'sys123', display_value: 'Hardware' })).toBe(
      'Hardware',
    );
  });

  it('falls back to value when display_value is empty', () => {
    expect(resolveDisplay({ value: 'sys123', display_value: '' })).toBe(
      'sys123',
    );
  });
});

describe('boolStr', () => {
  it('returns true when value is "true"', () => {
    expect(boolStr({ value: 'true', display_value: 'true' })).toBe(true);
  });

  it('returns false when value is "false"', () => {
    expect(boolStr({ value: 'false', display_value: 'false' })).toBe(false);
  });

  it('returns false for other values', () => {
    expect(boolStr({ value: '', display_value: '' })).toBe(false);
    expect(boolStr({ value: '1', display_value: '1' })).toBe(false);
  });
});

describe('isSysId', () => {
  it('returns true for a 32-char lowercase hex string', () => {
    expect(isSysId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true);
  });

  it('returns true for uppercase hex', () => {
    expect(isSysId('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4')).toBe(true);
  });

  it('returns false when shorter than 32 chars', () => {
    expect(isSysId('a1b2c3d4')).toBe(false);
  });

  it('returns false when longer than 32 chars', () => {
    expect(isSysId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4ff')).toBe(false);
  });

  it('returns false when string contains non-hex characters', () => {
    expect(isSysId('z1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(false);
  });
});

describe('handleError', () => {
  it('returns structured content for an SnApiError', () => {
    const err = new SnApiError(
      404,
      'Not Found',
      'record not found',
      'https://dev.service-now.com/api',
    );
    const result = handleError(err);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('404');
    expect(result.content[0].text).toContain('https://dev.service-now.com/api');
  });

  it('returns structured content for a generic Error', () => {
    const result = handleError(new Error('something went wrong'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('something went wrong');
  });

  it('handles non-Error throws', () => {
    const result = handleError('raw string thrown');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('raw string thrown');
  });
});
