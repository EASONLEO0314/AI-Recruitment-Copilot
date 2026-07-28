import { expect, it } from 'vitest';

import manifest from '../public/manifest.json';


it('registers the fixed localhost proxy as an MV3 service worker', () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background).toEqual({ service_worker: 'background.js' });
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8765/*']);
});
