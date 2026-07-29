import type {
  CandidateProfile,
  EducationExperience,
  ParserSnapshot,
  ProjectExperience,
  WorkExperience,
} from '../../contracts';
import { allTexts, firstText, isHidden } from '../dom';
import { buildProfileSnapshot, buildStatusSnapshot } from '../snapshot';


const RESUME_ROOTS = ['.resume-content', '.resume-box', '.geek-resume', 'main'];
const SECTION_ROOTS = '.resume-item, .history-section, .section-item';
const ITEM_ROOTS = ':scope .history-item, :scope .experience-item, :scope .item-content';
const HEADING_SELECTORS = ['h1', 'h2', 'h3', '.section-title', '.title'];

const WORK_HEADINGS = new Set(['工作经历', '工作经验']);
const EDUCATION_HEADINGS = new Set(['教育经历', '教育背景']);
const PROJECT_HEADINGS = new Set(['项目经历', '项目经验']);

const workSelectors = {
  company: ['.company-name', '.company'],
  title: ['.position-name', '.position'],
  period: ['.date-range', '.period'],
  description: ['.description', '.content'],
} as const;

const educationSelectors = {
  school: ['.school-name', '.school'],
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


function visibleItems(section: Element): Element[] {
  return Array.from(section.querySelectorAll(ITEM_ROOTS))
    .filter((item) => !isHidden(item));
}


function parseWorkSection(section: Element): WorkExperience[] {
  return visibleItems(section).map((item) => ({
    company: firstText(item, workSelectors.company),
    title: firstText(item, workSelectors.title),
    period: firstText(item, workSelectors.period),
    description: firstText(item, workSelectors.description, 500),
  })).filter((item) => Object.values(item).some((value) => value !== undefined));
}


function parseEducationSection(section: Element): EducationExperience[] {
  return visibleItems(section).map((item) => ({
    school: firstText(item, educationSelectors.school),
    degree: firstText(item, educationSelectors.degree),
    major: firstText(item, educationSelectors.major),
    period: firstText(item, educationSelectors.period),
  })).filter((item) => Object.values(item).some((value) => value !== undefined));
}


function parseProjectSection(section: Element): ProjectExperience[] {
  return visibleItems(section).map((item) => ({
    name: firstText(item, projectSelectors.name),
    role: firstText(item, projectSelectors.role),
    period: firstText(item, projectSelectors.period),
    description: firstText(item, projectSelectors.description, 500),
  })).filter((item) => Object.values(item).some((value) => value !== undefined));
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

  const workExperiences: WorkExperience[] = [];
  const education: EducationExperience[] = [];
  const projectExperiences: ProjectExperience[] = [];
  let unknownWorkStructure = false;
  let unknownEducationStructure = false;
  let unknownProjectStructure = false;

  const sections = Array.from(root.querySelectorAll(SECTION_ROOTS))
    .filter((section) => !isHidden(section));
  for (const section of sections) {
    const headings = allTexts(section, HEADING_SELECTORS);
    if (headings.some((heading) => WORK_HEADINGS.has(heading))) {
      const items = parseWorkSection(section);
      workExperiences.push(...items);
      unknownWorkStructure ||= items.length === 0;
    } else if (headings.some((heading) => EDUCATION_HEADINGS.has(heading))) {
      const items = parseEducationSection(section);
      education.push(...items);
      unknownEducationStructure ||= items.length === 0;
    } else if (headings.some((heading) => PROJECT_HEADINGS.has(heading))) {
      const items = parseProjectSection(section);
      projectExperiences.push(...items);
      unknownProjectStructure ||= items.length === 0;
    }
  }

  const baseInfo = allTexts(root, ['.base-info span', '.user-info span'], 80);
  const experienceText = baseInfo.find((value) => /\d+\s*年/.test(value));
  const experienceMatch = experienceText?.match(/(\d+)\s*年/);
  const experienceYears = experienceMatch ? Number(experienceMatch[1]) : undefined;
  const location = baseInfo[0] && !LOCATION_EXCLUSIONS.test(baseInfo[0])
    ? baseInfo[0]
    : undefined;

  const profile: CandidateProfile = {
    display_name: firstText(root, ['.resume-name', '.geek-name', '.name'], 80),
    location,
    experience_years: experienceYears,
    education,
    work_experiences: workExperiences,
    project_experiences: projectExperiences,
    skills: allTexts(
      root,
      ['.skills .tag-item', '.skill-label', '.tags-wrap .tag-item'],
      80,
    ),
    summary: firstText(
      root,
      ['.candidate-advantage', '.self-description', '.geek-desc .content'],
      500,
    ),
  };

  const warnings = [
    ...(unknownWorkStructure ? ['work-section-structure-unknown'] : []),
    ...(unknownEducationStructure ? ['education-section-structure-unknown'] : []),
    ...(unknownProjectStructure ? ['project-section-structure-unknown'] : []),
  ];
  const snapshot = buildProfileSnapshot('resume_frame', profile, now);

  return {
    ...snapshot,
    warnings: [...snapshot.warnings, ...warnings],
  };
}
