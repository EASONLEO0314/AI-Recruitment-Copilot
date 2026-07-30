import { describe, expect, it } from 'vitest';

import { probePublicJob } from './publicJobProbe';


function createDocument(markup: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${markup}</body></html>`,
    'text/html',
  );
}


describe('probePublicJob', () => {
  it('reads the first visible job card through the public job selectors', () => {
    const targetDocument = createDocument(`
      <section class="job-card-box">
        <a href="/job_detail/first">
          <span class="job-name">  AI
            Engineer  </span>
        </a>
        <span class="company-name">  Example
          Labs </span>
        <span class="job-area"> Shanghai · Pudong </span>
      </section>
      <section class="job-card-box">
        <a href="/job_detail/second"><span class="job-name">Second role</span></a>
        <span class="company-name">Second company</span>
        <span class="job-area">Beijing</span>
      </section>
    `);

    expect(probePublicJob(targetDocument)).toEqual({
      status: 'success',
      title: 'AI Engineer',
      company: 'Example Labs',
      location: 'Shanghai · Pudong',
    });
  });

  it('limits a normalized title to 80 characters', () => {
    const targetDocument = createDocument(`
      <article>
        <a href="/job_detail/long-title">
          <span class="job-title"> ${'T'.repeat(90)} </span>
        </a>
        <span class="company-text">Example</span>
        <span class="job-location">Remote</span>
      </article>
    `);

    expect(probePublicJob(targetDocument).title).toBe('T'.repeat(80));
  });

  it('skips hidden cards and hidden job links', () => {
    const targetDocument = createDocument(`
      <li class="job-card-box" hidden>
        <a href="/job_detail/hidden-card"><span class="job-name">Hidden card</span></a>
      </li>
      <li class="job-card-wrapper">
        <a href="/job_detail/hidden-link" aria-hidden="true">
          <span class="job-name">Hidden link</span>
        </a>
      </li>
      <li class="search-job-card">
        <a href="/job_detail/visible"><span class="job-name">Visible role</span></a>
        <span class="company-name">Visible company</span>
        <span class="job-area">Shenzhen</span>
      </li>
    `);

    expect(probePublicJob(targetDocument)).toEqual({
      status: 'success',
      title: 'Visible role',
      company: 'Visible company',
      location: 'Shenzhen',
    });
  });

  it('returns only bounded whitelisted partial fields when data is missing', () => {
    const targetDocument = createDocument(`
      <div class="job-card-box" id="sensitive-card-id">
        <a href="/job_detail/sensitive-job-id"> Platform Engineer </a>
        <span class="company-name">${'C'.repeat(170)}</span>
        <p class="whole-card-copy">${'private card text '.repeat(50)}</p>
      </div>
    `);

    const result = probePublicJob(targetDocument);

    expect(result).toEqual({
      status: 'partial',
      title: 'Platform Engineer',
      company: 'C'.repeat(160),
    });
    expect(Object.keys(result)).toEqual(['status', 'title', 'company']);
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(JSON.stringify(result)).not.toContain('private card text');
  });

  it('bounds location text without expanding to the whole card', () => {
    const targetDocument = createDocument(`
      <div class="job-card-box">
        <a href="/job_detail/bounded-location">Role</a>
        <span class="job-area">${'L'.repeat(170)}</span>
        <p>${'whole card '.repeat(100)}</p>
      </div>
    `);

    expect(probePublicJob(targetDocument)).toEqual({
      status: 'partial',
      title: 'Role',
      location: 'L'.repeat(160),
    });
  });

  it('returns not_found when no visible job detail link exists', () => {
    const targetDocument = createDocument(`
      <div class="job-card-box"><a href="/jobs/list">Job list</a></div>
      <article><a href="/job_detail/hidden" hidden>Hidden job</a></article>
    `);

    expect(probePublicJob(targetDocument)).toEqual({ status: 'not_found' });
  });
});
