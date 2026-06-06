import { z } from 'zod';

const str = (max = 200) => z.string().trim().max(max);
const optStr = (max = 200) => z.string().trim().max(max).optional().default('');

const occupant = z.object({
  fullName: str(120).min(1),
  dob: str(20).min(1),
  age: z.number().nullable().optional(),
  relationship: str(40).min(1),
  isAdult: z.boolean(),
  willCosign: optStr(8),
  cosignEmail: optStr(160),
  cosignPhone: optStr(20),
  cosignIncome: z.number().nonnegative().default(0),
});

const pet = z.object({
  type: optStr(40),
  breed: optStr(60),
  weight: optStr(10),
  age: optStr(10),
  fixed: z.boolean().default(false),
});

const vehicle = z.object({
  makeModel: optStr(80),
  plate: optStr(12),
  parkingNeeded: z.boolean().default(false),
});

const docList = z.array(z.string().max(300)).max(6).default([]);

const prevResidence = z.object({
  street: optStr(160),
  city: optStr(80),
  province: optStr(4),
  postal: optStr(10),
  from: optStr(20),
  to: optStr(20),
});

const emergencyContact = z.object({
  name: str(120).min(1),
  relationship: str(60).min(1),
  phone: str(20).min(1),
});

export const applicationSchema = z.object({
  unit: str(80).min(1),
  unitLabel: optStr(160),
  moveInDate: str(20).min(1),
  leaseTerm: str(30).min(1),
  wantGarage: optStr(8),
  hearAbout: optStr(40),
  applicant: z.object({
    fullName: str(120).min(1),
    preferredName: optStr(80),
    dob: str(20).min(1),
    email: z.string().trim().email().max(160),
    phone: str(20).min(1),
    altPhone: optStr(20),
  }),
  residence: z.object({
    street: str(160).min(1),
    city: str(80).min(1),
    province: str(4).min(1),
    postal: str(10).min(1),
    ownRent: str(12).min(1),
    currentMoveIn: optStr(20),
    reasonLeaving: str(500).min(1),
    currentRent: z.number().nonnegative().default(0),
    landlordName: optStr(120),
    landlordPhone: optStr(20),
    landlordEmail: optStr(160),
    canContactLandlord: optStr(12),
    evicted: str(8).min(1),
    evictedExplain: optStr(500),
    brokeLease: str(8).min(1),
    brokeLeaseExplain: optStr(500),
    previousResidences: z.array(prevResidence).max(15).default([]),
  }),
  employment: z.object({
    status: str(40).min(1),
    employer: optStr(120),
    jobTitle: optStr(120),
    lengthWithEmployer: optStr(40),
    employerPhone: optStr(20),
    grossMonthlyIncome: z.number().nonnegative(),
    additionalIncome: z.number().nonnegative().default(0),
  }),
  occupants: z.array(occupant).min(1).max(20),
  background: z.object({
    hasPets: str(8).min(1),
    pets: z.array(pet).max(10).default([]),
    serviceAnimal: optStr(8),
    smoking: str(20).min(1),
    vehicles: z.array(vehicle).max(10).default([]),
    bankruptcy: optStr(20),
    hasGuarantor: str(8).min(1),
    guarantor: z.object({
      name: optStr(120),
      phone: optStr(20),
      email: optStr(160),
    }),
    emergencyContacts: z.array(emergencyContact).min(1).max(10),
  }),
  documents: z.object({
    proofOfIncome: docList,
    creditReport: docList,
    photoId: docList,
  }),
  consent: z.object({
    infoTrue: z.literal(true),
    noFeeAck: z.literal(true),
    creditConsent: z.literal(true),
    privacyConsent: z.literal(true),
    signature: str(120).min(1),
    signedAt: str(40),
  }),
});

export type Application = z.infer<typeof applicationSchema>;

/** Second-stage (shortlist) document submission. */
export const docSubmitSchema = z.object({
  creditReport: docList,
  photoId: docList,
});
export type DocSubmit = z.infer<typeof docSubmitSchema>;

export const contactSchema = z.object({
  name: str(120).min(1),
  email: z.string().trim().email().max(160),
  phone: optStr(20),
  reason: str(20).min(1),
  message: str(2000).min(1),
  token: str(2048).min(1),
});
export type Contact = z.infer<typeof contactSchema>;
