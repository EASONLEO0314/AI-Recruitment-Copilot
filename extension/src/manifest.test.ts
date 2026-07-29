import { expect, it } from 'vitest';

import manifest from '../public/manifest.json';


it('registers the fixed localhost proxy as an MV3 service worker', () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background).toEqual({ service_worker: 'background.js' });
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8765/*']);
});


it('injects into supported frames without privileged extension APIs', () => {
  expect(manifest.content_scripts[0].matches).toEqual([
    'https://www.zhipin.com/*',
    'http://127.0.0.1/*',
  ]);
  expect(manifest.content_scripts[0].all_frames).toBe(true);
  expect(manifest.permissions).not.toContain('debugger');
  expect(manifest.permissions).not.toContain('scripting');
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8765/*']);
});
