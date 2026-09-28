import { z } from "zod";

const nonEmptyString = z.string().trim().min(1).max(500);
const bulletString = z.string().trim().min(1).max(700);

export const cvContentSchema = z
  .object({
    name: nonEmptyString,
    // 2-3 sentences. Optional so existing rewrites without one still parse.
    summary: z.string().trim().min(1).max(700).optional(),
    // Provenance shown in the app; these labels are not printed in the CV.
    addedSkills: z.array(z.object({ skill: z.string().trim().min(1).max(80), jobQuote: z.string().trim().min(1).max(1500), reason: z.string().trim().min(1).max(300) }).strict()).max(3).optional(),
    contactLine: z
      .array(
        z
          .object({
            text: nonEmptyString,
            url: nonEmptyString.optional(),
          })
          .strict(),
      )
      .max(8),
    skills: z
      .array(
        z
          .object({
            category: nonEmptyString,
            items: nonEmptyString,
          })
          .strict(),
      )
      .max(12),
    experience: z
      .array(
        z
          .object({
            jobTitle: nonEmptyString,
            company: nonEmptyString,
            location: z.string().trim().max(500),
            dateRange: z.string().trim().max(500),
            bullets: z.array(bulletString).min(1).max(6),
          })
          .strict(),
      )
      .max(15),
    projects: z
      .array(
        z
          .object({
            title: nonEmptyString,
            linkText: nonEmptyString.optional(),
            linkUrl: nonEmptyString.optional(),
            bullets: z.array(bulletString).min(1).max(6),
          })
          .strict(),
      )
      .max(12),
    education: z
      .array(
        z
          .object({
            school: nonEmptyString,
            degree: nonEmptyString,
            date: z.string().trim().max(500),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export type CvContent = z.infer<typeof cvContentSchema>;
