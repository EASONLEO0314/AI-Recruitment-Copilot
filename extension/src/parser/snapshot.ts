import type {
  CandidateProfile,
  EducationExperience,
  PageKind,
  ParserSnapshot,
  ParserStatus,
  ProjectExperience,
  WorkExperience,
} from '../contracts';


const CORE_FIELDS = [
  'work_experiences',
  'education',
  'project_experiences',
  'skills',
  'experience_years',
] as const;

const NON_CORE_FIELDS = [
  'display_name',
  'current_title',
  'location',
  'expected_position',
  'expected_city',
  'summary',
] as const;

export const RESUME_ITEM_RAW_TEXT_MAX_LENGTH = 2_000;


export function normalizeText(value: string | null | undefined, maxLength = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}


function setNormalizedString<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: string | undefined,
  maxLength = 160,
): void {
  const normalized = normalizeText(value, maxLength);
  if (normalized) {
    target[key] = normalized as T[K];
  }
}


function sanitizeEducation(items: EducationExperience[]): EducationExperience[] {
  return items.map((item) => {
    const sanitized: EducationExperience = {};
    setNormalizedString(sanitized, 'school', item.school);
    setNormalizedString(sanitized, 'degree', item.degree);
    setNormalizedString(sanitized, 'major', item.major);
    setNormalizedString(sanitized, 'period', item.period);
    setNormalizedString(
      sanitized,
      'raw_text',
      item.raw_text,
      RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
    );
    return sanitized;
  }).filter((item) => Object.keys(item).length > 0).slice(0, 50);
}


function sanitizeWork(items: WorkExperience[]): WorkExperience[] {
  return items.map((item) => {
    const sanitized: WorkExperience = {};
    setNormalizedString(sanitized, 'company', item.company);
    setNormalizedString(sanitized, 'title', item.title);
    setNormalizedString(sanitized, 'period', item.period);
    setNormalizedString(sanitized, 'description', item.description, 500);
    setNormalizedString(
      sanitized,
      'raw_text',
      item.raw_text,
      RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
    );
    return sanitized;
  }).filter((item) => Object.keys(item).length > 0).slice(0, 50);
}


function sanitizeProjects(items: ProjectExperience[]): ProjectExperience[] {
  return items.map((item) => {
    const sanitized: ProjectExperience = {};
    setNormalizedString(sanitized, 'name', item.name);
    setNormalizedString(sanitized, 'role', item.role);
    setNormalizedString(sanitized, 'period', item.period);
    setNormalizedString(sanitized, 'description', item.description, 500);
    setNormalizedString(
      sanitized,
      'raw_text',
      item.raw_text,
      RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
    );
    return sanitized;
  }).filter((item) => Object.keys(item).length > 0).slice(0, 50);
}


function sanitizeSkills(skills: string[]): string[] {
  const unique = new Set<string>();
  for (const skill of skills) {
    const normalized = normalizeText(skill, 160);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).slice(0, 50);
}


function sanitizeProfile(profile: CandidateProfile): CandidateProfile {
  const sanitized: CandidateProfile = {
    education: sanitizeEducation(profile.education),
    work_experiences: sanitizeWork(profile.work_experiences),
    project_experiences: sanitizeProjects(profile.project_experiences),
    skills: sanitizeSkills(profile.skills),
  };

  setNormalizedString(sanitized, 'display_name', profile.display_name);
  setNormalizedString(sanitized, 'current_title', profile.current_title);
  setNormalizedString(sanitized, 'location', profile.location);
  setNormalizedString(sanitized, 'expected_position', profile.expected_position);
  setNormalizedString(sanitized, 'expected_city', profile.expected_city);
  setNormalizedString(sanitized, 'summary', profile.summary, 500);

  if (Number.isInteger(profile.experience_years)
    && Number(profile.experience_years) >= 0
    && Number(profile.experience_years) <= 80) {
    sanitized.experience_years = profile.experience_years;
  }

  return sanitized;
}


function hasValue(profile: CandidateProfile, field: typeof CORE_FIELDS[number]): boolean {
  const value = profile[field];
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}


function structuralFingerprint(profile: CandidateProfile): string {
  const source = JSON.stringify({
    current_title: profile.current_title ?? '',
    experience_years: profile.experience_years ?? null,
    expected_position: profile.expected_position ?? '',
    expected_city: profile.expected_city ?? '',
    education_count: profile.education.length,
    work_count: profile.work_experiences.length,
    project_count: profile.project_experiences.length,
    skill_count: profile.skills.length,
  });
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}


export function buildProfileSnapshot(
  pageKind: PageKind,
  profile: CandidateProfile,
  now: Date,
): ParserSnapshot {
  const sanitized = sanitizeProfile(profile);
  const presentCoreFields = CORE_FIELDS.filter((field) => hasValue(sanitized, field));
  const presentNonCoreFields = NON_CORE_FIELDS.filter((field) => sanitized[field] !== undefined);
  const missingFields = CORE_FIELDS.filter((field) => !hasValue(sanitized, field));

  return {
    schema_version: 1,
    parser_version: 'boss-dom-v1',
    page_kind: pageKind,
    status: missingFields.length === 0 ? 'ready' : 'partial',
    captured_at: now.toISOString(),
    fingerprint: structuralFingerprint(sanitized),
    profile: sanitized,
    present_fields: [...presentCoreFields, ...presentNonCoreFields],
    missing_fields: missingFields,
    warnings: [],
  };
}


export function buildStatusSnapshot(
  pageKind: PageKind,
  status: ParserStatus,
  warning: string | undefined,
  now: Date,
): ParserSnapshot {
  const normalizedWarning = normalizeText(warning, 160);
  return {
    schema_version: 1,
    parser_version: 'boss-dom-v1',
    page_kind: pageKind,
    status,
    captured_at: now.toISOString(),
    present_fields: [],
    missing_fields: [],
    warnings: normalizedWarning ? [normalizedWarning] : [],
  };
}
