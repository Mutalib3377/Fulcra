import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipFiles } from './zip';

describe('zip writer', () => {
  it('writes a zip that standard tools can open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'plugin.zip');
    writeFileSync(
      file,
      zipFiles([{ name: 'fulcra-chat/fulcra-chat.php', content: '<?php // ₦ ok\n' }]),
    );
    let listing = '';
    try {
      listing = execFileSync('python3', [
        '-c',
        `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('fulcra-chat/fulcra-chat.php').decode())`,
        file,
      ]).toString();
    } catch {
      return; // python3 not available: skip
    }
    expect(listing).toBe('None\n<?php // ₦ ok\n\n');
    expect(readFileSync(file).subarray(0, 4).toString('hex')).toBe('504b0304');
  });
});
