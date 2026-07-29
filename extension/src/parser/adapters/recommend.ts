import type { CandidateProfile, ParserSnapshot } from '../../contracts';
import { allTexts, firstText, isHidden } from '../dom';
import { buildProfileSnapshot, buildStatusSnapshot } from '../snapshot';


export const CARD_SELECTOR =
  '.candidate-card-wrap, .card-list .card-item, .geek-list .geek-card';
export const ACTIVE_CARD_SELECTOR = [
  '.candidate-card-wrap.active',
  '.candidate-card-wrap.is-active',
  '.card-list .card-item.active',
  '.geek-list .geek-card.active',
  '[aria-selected="true"]',
].join(', ');
export const OBSERVATION_ROOT_SELECTOR = '.card-list, .geek-list-wrap .geek-list';

const LOCATION_EXCLUSIONS = /年|学历|本科|硕士|博士|大专/;


export function findRecommendObservationRoot(document: Document): Element | null {
  return Array.from(document.querySelectorAll(OBSERVATION_ROOT_SELECTOR))
    .find((element) => !isHidden(element)) ?? null;
}


export function parseRecommendFrame(document: Document, now: Date): ParserSnapshot {
  const cards = Array.from(document.querySelectorAll(CARD_SELECTOR))
    .filter((element) => !isHidden(element));
  const activeCard = cards.find((card) => card.matches(ACTIVE_CARD_SELECTOR));
  const card = activeCard ?? (cards.length === 1 ? cards[0] : undefined);

  if (!card) {
    return buildStatusSnapshot(
      'recommend_frame',
      'unsupported',
      'recommend-active-card-not-found',
      now,
    );
  }

  const name = firstText(card, ['.name-wrap .name', '.name'], 80);
  const baseInfo = allTexts(card, ['.base-info span'], 80);
  const experienceText = baseInfo.find((value) => /\d+\s*年/.test(value));
  const experienceMatch = experienceText?.match(/(\d+)\s*年/);
  const experienceYears = experienceMatch ? Number(experienceMatch[1]) : undefined;
  const expectedPosition = firstText(
    card,
    ['.expect-wrap .content', '.expect-wrap .join-text-wrap'],
    160,
  );
  const summary = firstText(card, ['.geek-desc .content'], 500);
  const skills = allTexts(
    card,
    ['.operate .labels .label', '.tags-wrap .tag-item'],
    80,
  );
  const location = baseInfo[0] && !LOCATION_EXCLUSIONS.test(baseInfo[0])
    ? baseInfo[0]
    : undefined;

  const profile: CandidateProfile = {
    display_name: name,
    location,
    experience_years: experienceYears,
    expected_position: expectedPosition,
    education: [],
    work_experiences: [],
    project_experiences: [],
    skills,
    summary,
  };

  return buildProfileSnapshot('recommend_frame', profile, now);
}
