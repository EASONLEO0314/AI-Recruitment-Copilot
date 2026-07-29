import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';


describe('message suggestion tabs', () => {
  it('makes each full grid column a stable click target', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const rule = styles.match(/\.arc-tabs button\s*{([^}]*)}/)?.[1] ?? '';

    expect(rule).toMatch(/width:\s*100%/);
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/z-index:\s*1/);
    expect(rule).toMatch(/pointer-events:\s*auto/);
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule).toMatch(/justify-content:\s*center/);
  });
});


describe('page-reading styles', () => {
  it('defines every page-reading element inside the extension namespace', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.arc-reading\s*{/);
    expect(styles).toMatch(/\.arc-reading__status\s*{/);
    expect(styles).toMatch(/\.arc-reading__badge\s*{/);
    expect(styles).toMatch(/\.arc-reading__facts\s*{/);
    expect(styles).toMatch(/\.arc-reading__skills\s*{/);
    expect(styles).toMatch(/\.arc-reading__missing\s*{/);
    expect(styles).toMatch(/\.arc-reading[^{]*button[^}]*pointer-events:\s*auto/s);
  });

  it('does not target BOSS candidate or resume layout selectors', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).not.toMatch(/\.candidate-card-wrap|\.resume-content|\.geek-list|\.c-resume/);
  });
});
