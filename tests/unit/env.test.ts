import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('окружение', () => {
  it('Node умеет fs.globSync (нужен плагину lessons-meta)', () => {
    expect(typeof fs.globSync).toBe('function');
  });

  it('Node не старше 22', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});
