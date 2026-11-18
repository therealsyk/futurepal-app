import { describe, it, expect } from 'vitest';
import { compareVersions, parseVersion, versionCode, APP_VERSION } from './version';

describe('version', () => {
  it('parses loose versions', () => {
    expect(parseVersion('v1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('1.2.3-beta')).toEqual([1, 2, 3]);
    expect(parseVersion('')).toEqual([0, 0, 0]);
  });
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });
  it('versionCode always grows', () => {
    expect(versionCode('1.2.3')).toBe(10203);
    expect(versionCode('1.10.0')).toBeGreaterThan(versionCode('1.9.99'));
  });
  it('APP_VERSION comes from package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
