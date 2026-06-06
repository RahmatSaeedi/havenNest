/**
 * Shared option lists and the document/contract shape for the rental
 * application. The client form (apply.astro / apply.ts) renders from these, and
 * the Cloudflare Worker's Zod schema mirrors the same shape for server-side
 * re-validation. Keep the two in sync.
 */

export const LEASE_TERMS = [
  { value: '12-month', label: '12-month fixed' },
  { value: '6-month', label: '6-month fixed' },
  { value: 'month-to-month', label: 'Month-to-month' },
] as const;

export const PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
] as const;

export const OWN_RENT = [
  { value: 'rent', label: 'I rent' },
  { value: 'own', label: 'I own' },
  { value: 'other', label: 'Other' },
] as const;

export const EMPLOYMENT_STATUS = [
  { value: 'employed-ft', label: 'Employed — full-time' },
  { value: 'employed-pt', label: 'Employed — part-time' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'student', label: 'Student' },
  { value: 'retired', label: 'Retired' },
  { value: 'other', label: 'Other' },
] as const;

export const RELATIONSHIPS = [
  'Self', 'Spouse or partner', 'Child', 'Parent', 'Sibling', 'Roommate', 'Other',
] as const;

export const HEAR_ABOUT = [
  'Website', 'Kijiji', 'Realtor.ca', 'Referral', 'Drive-by sign', 'Social media', 'Other',
] as const;

export const SMOKING = [
  { value: 'non-smoker', label: 'Non-smoker' },
  { value: 'outdoors-only', label: 'Smoke/vape outdoors only' },
  { value: 'indoors', label: 'Smoke/vape indoors' },
] as const;

export const CONTACT_REASONS = ['rent', 'tour', 'builder', 'other'] as const;

/**
 * Document upload types. We use a TWO-STAGE model (Alberta OIPC minimization):
 *  - INITIAL_DOC_TYPES are collected from every applicant in the application.
 *  - SHORTLIST_DOC_TYPES are requested only from shortlisted applicants, via a
 *    secure per-applicant link, on the /documents page.
 */
export const INITIAL_DOC_TYPES = [
  {
    key: 'proofOfIncome',
    label: 'Proof of income',
    help: 'Recent pay stubs, an employment letter, or a benefit / pension statement. Any lawful source of income is accepted.',
    required: true,
    max: 3,
  },
] as const;

export const SHORTLIST_DOC_TYPES = [
  {
    key: 'creditReport',
    label: 'Credit report',
    help: 'Your own recent credit report (e.g. from Equifax or TransUnion). No SIN is required.',
    required: true,
    max: 1,
  },
  {
    key: 'photoId',
    label: 'Government photo ID',
    help: 'A clear photo or scan of a government-issued photo ID (e.g. driver’s licence). Used only to verify identity.',
    required: true,
    max: 2,
  },
] as const;

/** Full allowlist (used by the Worker to validate any upload). */
export const DOC_TYPES = [...INITIAL_DOC_TYPES, ...SHORTLIST_DOC_TYPES];

export type DocTypeKey = (typeof DOC_TYPES)[number]['key'];

/** File-upload constraints (enforced on client AND re-checked in the Worker). */
export const UPLOAD = {
  acceptMime: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  acceptExt: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  maxBytesPerFile: 10 * 1024 * 1024, // 10 MB
  maxFilesTotal: 12,
} as const;

export const STEPS = [
  { id: 'unit', title: 'Unit & move-in' },
  { id: 'applicant', title: 'About you' },
  { id: 'residence', title: 'Residence history' },
  { id: 'employment', title: 'Employment & income' },
  { id: 'occupants', title: 'Occupants' },
  { id: 'background', title: 'Pets, vehicles & more' },
  { id: 'documents', title: 'Documents' },
  { id: 'consent', title: 'Review & consent' },
] as const;
