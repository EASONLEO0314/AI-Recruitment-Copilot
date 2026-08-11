import type {
  CandidateProfile,
  EducationExperience,
  ParserSnapshot,
  ProjectExperience,
  WorkExperience,
} from '../../contracts';
import { RESUME_ITEM_RAW_TEXT_MAX_LENGTH } from '../../contracts';
import { allTexts, firstText, isHidden, visibleText } from '../dom';
import {
  buildProfileSnapshot,
  buildStatusSnapshot,
  normalizeText,
} from '../snapshot';


const RESUME_ROOTS = ['.resume-content', '.resume-box', '.geek-resume', 'main'];
const SECTION_ROOTS = [
  '.resume-item',
  '.history-section',
  '.section-item',
  '.resume-section',
  '.resume-simple-box',
].join(', ');
const ITEM_ROOTS = [
  ':scope .history-item',
  ':scope .experience-item',
  ':scope .item-content',
  ':scope .work-wrap',
  ':scope .edu-wrap',
  ':scope .resume-item-detail',
].join(', ');
const ITEM_MATCH_SELECTOR = [
  '.history-item',
  '.experience-item',
  '.item-content',
  '.work-wrap',
  '.edu-wrap',
  '.resume-item-detail',
].join(', ');
const HEADING_SELECTORS = ['h1', 'h2', 'h3', '.section-title', '.title'];

const WORK_HEADINGS = new Set(['工作经历', '工作经验']);
const EDUCATION_HEADINGS = new Set(['教育经历', '教育背景']);
const PROJECT_HEADINGS = new Set(['项目经历', '项目经验']);
const SKILL_HEADING_PATTERN = /^(?:专业技能|技能标签|技能特长|个人技能|技能)$/;
const SKILL_HEADING_PREFIX_PATTERN = /^(?:专业技能|技能标签|技能特长|个人技能|技能)\s*[:：\-—]?\s*/;
const NON_SKILL_TOKEN_PATTERN = /^(?:工作经历|工作经验|教育经历|教育背景|项目经历|项目经验|求职意向|个人优势)$/;
const SKILL_CONTAINER_ROOTS = [
  SECTION_ROOTS,
  '.skills',
  '.skill-section',
  '.skill-wrap',
  '.tag-section',
  '.ai-preference-content',
].join(', ');
const SKILL_TOKEN_SELECTORS = [
  ':scope .skills .tag-item',
  ':scope .skill-label',
  ':scope .skill-tag',
  ':scope .tags-wrap .tag-item',
  ':scope .tag-item',
  ':scope .label',
  ':scope .tag',
  ':scope .badge',
  ':scope [class*="tag"]',
  ':scope [class*="skill"]',
  ':scope .ai-preference-content-option .title',
  ':scope .ai-preference-content-option span',
].join(', ');

const workSelectors = {
  company: ['.company-name', '.company-name-wrap', '.company'],
  title: ['.position-name', '.position'],
  period: ['.date-range', '.period'],
  description: ['.description', '.content'],
} as const;

const modernWorkDescriptionSelectors = ['.description', '.item-content', '.content'] as const;

const educationSelectors = {
  school: ['.school-name', '.school-name-wrap', '.school'],
  degree: ['.degree-name', '.degree'],
  major: ['.major-name', '.major'],
  period: ['.date-range', '.period'],
} as const;

const projectSelectors = {
  name: ['.project-name', '.name'],
  role: ['.role-name', '.role'],
  period: ['.date-range', '.period'],
  description: ['.description', '.content'],
} as const;

const LOCATION_EXCLUSIONS = /年|学历|本科|硕士|博士|大专/;

type SectionKind = 'work' | 'education' | 'project';

interface ParsedSection<T> {
  items: T[];
  rawTextTruncated: boolean;
}

interface RawItemText {
  rawText?: string;
  truncated: boolean;
}


function findResumeRoot(document: Document): Element | undefined {
  for (const selector of RESUME_ROOTS) {
    const root = Array.from(document.querySelectorAll(selector))
      .find((element) => !isHidden(element));
    if (root) {
      return root;
    }
  }
  return undefined;
}


function belongsToSection(element: Element, section: Element): boolean {
  return element.closest(SECTION_ROOTS) === section;
}


function sectionHeadings(section: Element): string[] {
  const headings = HEADING_SELECTORS.flatMap((selector) =>
    Array.from(section.querySelectorAll(selector))
      .filter((element) => belongsToSection(element, section) && !isHidden(element))
      .map((element) => normalizeText(element.textContent, 160))
      .filter(Boolean));

  return [...new Set(headings)].slice(0, 50);
}


function visibleItems(section: Element): Element[] {
  return Array.from(section.querySelectorAll(ITEM_ROOTS))
    .filter((item) => belongsToSection(item, section) && !isHidden(item))
    .filter((item) => {
      const ancestorItem = item.parentElement?.closest(ITEM_MATCH_SELECTOR);
      return !ancestorItem || !belongsToSection(ancestorItem, section);
    });
}


function findSectionKind(section: Element, headings: string[]): SectionKind | undefined {
  if (section.matches('.geek-work-experience-wrap')) {
    return 'work';
  }
  if (section.matches('.geek-education-experience-wrap, .resume-simple-box.education')) {
    return 'education';
  }
  if (headings.some((heading) => WORK_HEADINGS.has(heading))) {
    return 'work';
  }
  if (headings.some((heading) => EDUCATION_HEADINGS.has(heading))) {
    return 'education';
  }
  if (headings.some((heading) => PROJECT_HEADINGS.has(heading))) {
    return 'project';
  }
  return undefined;
}


function readRawItemText(item: Element): RawItemText {
  const value = visibleText(item, RESUME_ITEM_RAW_TEXT_MAX_LENGTH + 1);
  if (!value) {
    return { truncated: false };
  }
  return {
    rawText: value.slice(0, RESUME_ITEM_RAW_TEXT_MAX_LENGTH),
    truncated: value.length > RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
  };
}


function parseWorkSection(section: Element): ParsedSection<WorkExperience> {
  let rawTextTruncated = false;
  const items = visibleItems(section).map((item) => {
    const rawText = readRawItemText(item);
    rawTextTruncated ||= rawText.truncated;
    return {
      company: firstText(item, workSelectors.company),
      title: firstText(item, workSelectors.title),
      period: firstText(item, workSelectors.period),
      description: firstText(
        item,
        item.matches('.work-wrap') ? modernWorkDescriptionSelectors : workSelectors.description,
        500,
      ),
      raw_text: rawText.rawText,
    };
  }).filter((item) => Object.values(item).some((value) => value !== undefined));

  return { items, rawTextTruncated };
}


function parseEducationSection(section: Element): ParsedSection<EducationExperience> {
  let rawTextTruncated = false;
  const items = visibleItems(section).map((item) => {
    const rawText = readRawItemText(item);
    rawTextTruncated ||= rawText.truncated;
    return {
      school: firstText(item, educationSelectors.school),
      degree: firstText(item, educationSelectors.degree),
      major: firstText(item, educationSelectors.major),
      period: firstText(item, educationSelectors.period),
      raw_text: rawText.rawText,
    };
  }).filter((item) => Object.values(item).some((value) => value !== undefined));

  return { items, rawTextTruncated };
}


function parseProjectSection(section: Element): ParsedSection<ProjectExperience> {
  let rawTextTruncated = false;
  const items = visibleItems(section).map((item) => {
    const rawText = readRawItemText(item);
    rawTextTruncated ||= rawText.truncated;
    return {
      name: firstText(item, projectSelectors.name),
      role: firstText(item, projectSelectors.role),
      period: firstText(item, projectSelectors.period),
      description: firstText(item, projectSelectors.description, 500),
      raw_text: rawText.rawText,
    };
  }).filter((item) => Object.values(item).some((value) => value !== undefined));

  return { items, rawTextTruncated };
}


function isSkillHeading(element: Element): boolean {
  const text = visibleText(element, 80).replace(/\s+/g, '');
  return SKILL_HEADING_PATTERN.test(text);
}


function isLikelySkillToken(value: string): boolean {
  const text = normalizeText(value, 80);
  return text.length > 0
    && text.length <= 40
    && !SKILL_HEADING_PATTERN.test(text.replace(/\s+/g, ''))
    && !NON_SKILL_TOKEN_PATTERN.test(text.replace(/\s+/g, ''));
}


function addSkillText(values: Set<string>, text: string, splitWhitespace = false): void {
  const normalized = normalizeText(text, 160)
    .replace(SKILL_HEADING_PREFIX_PATTERN, '')
    .replace(/^[:：\-—\s]+/, '');
  if (!normalized) {
    return;
  }

  const fragments = normalized
    .split(/[、,，/|;；]+|\s{2,}/)
    .map((part) => normalizeText(part, 80))
    .filter(Boolean);
  const candidates = splitWhitespace && fragments.length === 1
    ? fragments[0].split(/\s+/).filter((part) => part.length > 0)
    : fragments;

  for (const candidate of candidates) {
    if (isLikelySkillToken(candidate)) {
      values.add(candidate);
    }
  }
}


function collectSkillTokens(container: Element, heading: Element): string[] {
  const values = new Set<string>();
  for (const element of Array.from(container.querySelectorAll(SKILL_TOKEN_SELECTORS))) {
    if (element === heading || element.contains(heading) || isHidden(element)) {
      continue;
    }
    addSkillText(values, visibleText(element, 80));
  }

  if (values.size === 0) {
    for (const element of Array.from(container.children)) {
      if (element === heading || element.contains(heading) || isHidden(element)) {
        continue;
      }
      addSkillText(values, visibleText(element, 120), true);
    }
  }

  return Array.from(values);
}


function nearbySkillContainers(heading: Element, root: Element): Element[] {
  const containers: Element[] = [];
  const closest = heading.closest(SKILL_CONTAINER_ROOTS);
  if (closest && root.contains(closest) && !isHidden(closest)) {
    return visibleText(closest, 1_201).length <= 1_200 ? [closest] : [];
  }

  let parent = heading.parentElement;
  for (let depth = 0; parent && depth < 3; depth += 1) {
    if (parent === root) {
      break;
    }
    if (root.contains(parent) && !isHidden(parent)) {
      containers.push(parent);
    }
    parent = parent.parentElement;
  }

  return [...new Set(containers)]
    .filter((container) => visibleText(container, 1_201).length <= 1_200);
}


function skillTextsNearHeadings(root: Element): string[] {
  const values = new Set<string>();
  const elements = [root, ...Array.from(root.querySelectorAll('*')).slice(0, 500)];
  const headings = elements.filter((element) => !isHidden(element) && isSkillHeading(element));

  for (const heading of headings) {
    for (const container of nearbySkillContainers(heading, root)) {
      for (const skill of collectSkillTokens(container, heading)) {
        values.add(skill);
      }
    }
  }

  return Array.from(values).slice(0, 50);
}


export function parseResumeRoot(
  root: Element,
  pageKind: 'recommend_frame' | 'resume_frame',
  now: Date,
): ParserSnapshot {
  const workExperiences: WorkExperience[] = [];
  const education: EducationExperience[] = [];
  const projectExperiences: ProjectExperience[] = [];
  let unknownWorkStructure = false;
  let unknownEducationStructure = false;
  let unknownProjectStructure = false;
  let unknownSectionKind = false;
  let rawTextTruncated = false;

  const sections = Array.from(root.querySelectorAll(SECTION_ROOTS))
    .filter((section) => !isHidden(section));
  for (const section of sections) {
    const headings = sectionHeadings(section);
    const kind = findSectionKind(section, headings);
    if (!kind) {
      unknownSectionKind ||= section.matches('.resume-simple-box')
        && visibleItems(section).length > 0;
      continue;
    }

    if (kind === 'work') {
      const parsed = parseWorkSection(section);
      workExperiences.push(...parsed.items);
      unknownWorkStructure ||= parsed.items.length === 0;
      rawTextTruncated ||= parsed.rawTextTruncated;
    } else if (kind === 'education') {
      const parsed = parseEducationSection(section);
      education.push(...parsed.items);
      unknownEducationStructure ||= parsed.items.length === 0;
      rawTextTruncated ||= parsed.rawTextTruncated;
    } else {
      const parsed = parseProjectSection(section);
      projectExperiences.push(...parsed.items);
      unknownProjectStructure ||= parsed.items.length === 0;
      rawTextTruncated ||= parsed.rawTextTruncated;
    }
  }

  const baseInfo = allTexts(
    root,
    [
      '.base-info span',
      '.user-info span',
      '.anonymous-info-labels span',
    ],
    80,
  );
  const experienceText = baseInfo.find((value) => /\d+\s*年/.test(value));
  const experienceMatch = experienceText?.match(/(\d+)\s*年/);
  const experienceYears = experienceMatch ? Number(experienceMatch[1]) : undefined;
  const location = baseInfo[0] && !LOCATION_EXCLUSIONS.test(baseInfo[0])
    ? baseInfo[0]
    : undefined;
  const skills = [
    ...allTexts(
      root,
      [
        '.skills .tag-item',
        '.skill-label',
        '.skill-tag',
        '.tags-wrap .tag-item',
      ],
      80,
    ),
    ...skillTextsNearHeadings(root),
  ];

  const profile: CandidateProfile = {
    display_name: firstText(root, ['.resume-name', '.geek-name', '.name'], 80),
    location,
    experience_years: experienceYears,
    education,
    work_experiences: workExperiences,
    project_experiences: projectExperiences,
    skills: [...new Set(skills)].slice(0, 50),
    summary: firstText(
      root,
      ['.candidate-advantage', '.self-description', '.geek-desc .content', '.geek-desc'],
      500,
    ),
  };

  const warnings = [
    ...(unknownWorkStructure ? ['work-section-structure-unknown'] : []),
    ...(unknownEducationStructure ? ['education-section-structure-unknown'] : []),
    ...(unknownProjectStructure ? ['project-section-structure-unknown'] : []),
    ...(unknownSectionKind ? ['resume-section-kind-unknown'] : []),
    ...(rawTextTruncated ? ['resume-item-raw-text-truncated'] : []),
  ];
  const snapshot = buildProfileSnapshot(pageKind, profile, now);

  return {
    ...snapshot,
    warnings: [...snapshot.warnings, ...warnings],
  };
}


export function parseResumeFrame(document: Document, now: Date): ParserSnapshot {
  const root = findResumeRoot(document);
  if (!root) {
    return buildStatusSnapshot(
      'resume_frame',
      'unsupported',
      'resume-root-not-found',
      now,
    );
  }

  return parseResumeRoot(root, 'resume_frame', now);
}
