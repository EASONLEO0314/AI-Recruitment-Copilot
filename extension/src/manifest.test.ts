import { expect, it } from 'vitest';

import manifest from '../public/manifest.json';


it('registers the fixed localhost proxy as an MV3 service worker', () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background).toEqual({ service_worker: 'background.js' });
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8765/*']);
});


it('injects into supported frames without privileged extension APIs', () => {
  const contentScript = manifest.content_scripts[0];

  expect(contentScript.matches).toEqual([
    'https://www.zhipin.com/*',
    'http://127.0.0.1/*',
  ]);
  expect(contentScript.all_frames).toBe(true);
  expect(contentScript).not.toHaveProperty('match_about_blank');
  expect(contentScript).not.toHaveProperty('match_origin_as_fallback');
  expect(manifest.permissions).toEqual(['clipboardWrite', 'storage']);
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8765/*']);
});
