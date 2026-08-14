import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';


describe('real-assessment controls', () => {
  it('keeps the job selector and analyze control stable inside the extension namespace', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const selectRule = styles.match(/\.arc-job-select\s*{([^}]*)}/)?.[1] ?? '';
    const controlRule = styles.match(/\.arc-assessment-control__body\s*{([^}]*)}/)?.[1] ?? '';
    const compactStateRule = styles.match(/\.arc-state--compact\s*{([^}]*)}/)?.[1] ?? '';

    expect(selectRule).toMatch(/width:\s*206px/);
    expect(selectRule).toMatch(/min-height:\s*27px/);
    expect(selectRule).toMatch(/border-radius:\s*8px/);
    expect(controlRule).toMatch(/grid-template-columns:\s*1fr auto/);
    expect(controlRule).toMatch(/align-items:\s*center/);
    expect(compactStateRule).toMatch(/min-height:\s*112px/);
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
    expect(styles).toMatch(/\.arc-reading__privacy-note\s*{/);
    expect(styles).toMatch(/\.arc-reading__missing\s*{/);
    expect(styles).toMatch(/\.arc-reading[^{]*button[^}]*pointer-events:\s*auto/s);
  });

  it('does not target BOSS candidate or resume layout selectors', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).not.toMatch(/\.candidate-card-wrap|\.resume-content|\.geek-list|\.c-resume/);
  });
});
