import { describe, expect, it } from 'vitest';

import { classifyPage } from './pageClassifier';


function createAnonymousDocument(markup = ''): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${markup}</body></html>`,
    'text/html',
  );
}


describe('classifyPage', () => {
  it('classifies the top-level BOSS page as logged out for an exact visible login link', () => {
    const targetDocument = createAnonymousDocument('<a>登录/注册</a>');

    expect(classifyPage(targetDocument, 'https://www.zhipin.com/', true)).toBe('logged_out');
  });

  it.each(['登录', '立即登录', '登录/注册', '扫码登录'])(
    'accepts the exact visible login label %s',
    (label) => {
      const targetDocument = createAnonymousDocument(`<button>\n  ${label}\t</button>`);

      expect(classifyPage(targetDocument, 'https://www.zhipin.com/web/geek/job', true)).toBe(
        'logged_out',
      );
    },
  );

  it.each([
    ['a hidden ancestor', '<section hidden><a>登录</a></section>'],
    ['an aria-hidden ancestor', '<section aria-hidden="true"><button>立即登录</button></section>'],
    ['a non-exact label', '<a>立即登录账户</a>'],
  ])('ignores %s as a login signal', (_description, markup) => {
    const targetDocument = createAnonymousDocument(markup);

    expect(classifyPage(targetDocument, 'https://www.zhipin.com/', true)).toBe('non_candidate');
  });

  it.each([
    ['/web/frame/recommend', 'recommend_frame'],
    ['/web/frame/recommend/list', 'recommend_frame'],
    ['/web/frame/c-resume', 'resume_frame'],
    ['/web/frame/c-resume/example', 'resume_frame'],
    ['/web/frame/unknown', 'unsupported'],
  ] as const)('classifies a child frame at %s as %s', (pathname, expected) => {
    expect(
      classifyPage(createAnonymousDocument(), `https://www.zhipin.com${pathname}`, false),
    ).toBe(expected);
  });

  it.each([
    ['recommend list', '<main class="candidate-recommend"></main>'],
    [
      'resume dialog',
      '<div class="dialog-lib-resume"><section class="lib-standard-resume"></section></div>',
    ],
  ])('classifies an unknown BOSS child frame from a visible %s signature', (_description, markup) => {
    expect(
      classifyPage(
        createAnonymousDocument(markup),
        'https://www.zhipin.com/web/frame/unknown',
        false,
      ),
    ).toBe('recommend_frame');
  });

  it('ignores a hidden candidate structure on an unknown child frame', () => {
    expect(
      classifyPage(
        createAnonymousDocument(
          '<div hidden><div class="dialog-lib-resume"><div class="lib-standard-resume"></div></div></div>',
        ),
        'https://www.zhipin.com/web/frame/unknown',
        false,
      ),
    ).toBe('unsupported');
  });

  it('does not use a candidate DOM signature outside a BOSS child frame', () => {
    expect(
      classifyPage(
        createAnonymousDocument('<main class="candidate-recommend"></main>'),
        'https://example.invalid/web/frame/unknown',
        false,
      ),
    ).toBe('unsupported');
  });

  it('does not classify a supported frame path in the top-level page', () => {
    expect(
      classifyPage(
        createAnonymousDocument(),
        'https://www.zhipin.com/web/frame/recommend',
        true,
      ),
    ).toBe('non_candidate');
  });

  it('classifies an invalid URL as unsupported', () => {
    expect(classifyPage(createAnonymousDocument(), 'not a URL', true)).toBe('unsupported');
  });

  it.each([
    [true, 'non_candidate'],
    [false, 'unsupported'],
  ] as const)('uses the safe fallback for a non-BOSS URL when isTopFrame is %s', (isTopFrame, expected) => {
    expect(
      classifyPage(createAnonymousDocument('<a>登录</a>'), 'https://example.invalid/', isTopFrame),
    ).toBe(expected);
  });
});
