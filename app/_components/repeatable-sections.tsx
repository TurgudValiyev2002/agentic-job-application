"use client";

import type { Dispatch, SetStateAction } from "react";

import {
  CheckboxField,
  firstError,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "./field";

export type EducationRow = {
  id?: string;
  institution: string;
  degree: string;
  level: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  grade: string;
  description: string;
};

export type ExperienceRow = {
  id?: string;
  company: string;
  jobTitle: string;
  location: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
};

export type SkillRow = {
  id?: string;
  name: string;
  level: string;
  yearsOfExperience: string;
};

export type LanguageRow = {
  id?: string;
  language: string;
  proficiency: string;
};

export type ReferenceRow = {
  id?: string;
  name: string;
  relationship: string;
  company: string;
  email: string;
  phone: string;
};

const addButtonClass =
  "mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950";

const removeButtonClass =
  "rounded-md px-2.5 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600 dark:text-red-400 dark:hover:bg-red-950";

function EmptyState({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </p>
  );
}

function CardHeader({ number, onRemove }: { number: number; onRemove: () => void }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Entry {number}
      </h3>
      <button type="button" onClick={onRemove} className={removeButtonClass}>
        Remove
      </button>
    </div>
  );
}

export function EducationSection({
  rows,
  setRows,
  errors,
}: {
  rows: EducationRow[];
  setRows: Dispatch<SetStateAction<EducationRow[]>>;
  errors?: Record<string, string[]>;
}) {
  const add = () =>
    setRows((current) => [
      ...current,
      {
        institution: "",
        degree: "",
        level: "",
        fieldOfStudy: "",
        startDate: "",
        endDate: "",
        isCurrent: false,
        grade: "",
        description: "",
      },
    ]);

  return (
    <FormSection
      id="education-section"
      title="Education"
    >
      <div className="space-y-5">
        {rows.length === 0 ? (
          <EmptyState>No education entries.</EmptyState>
        ) : null}
        {rows.map((row, index) => {
          const update = (change: Partial<EducationRow>) =>
            setRows((current) =>
              current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, ...change } : item,
              ),
            );
          const prefix = `education.${index}`;
          const id = `education-${index}`;

          return (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-5">
              <CardHeader number={index + 1} onRemove={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField
                  id={`${id}-institution`}
                  name={`_${id}-institution`}
                  label="Institution"
                  value={row.institution}
                  onChange={(event) => update({ institution: event.target.value })}
                  required
                  error={firstError(errors, `${prefix}.institution`)}
                />
                <TextField id={`${id}-degree`} name={`_${id}-degree`} label="Degree or qualification" value={row.degree} onChange={(event) => update({ degree: event.target.value })} error={firstError(errors, `${prefix}.degree`)} />
                <SelectField id={`${id}-level`} name={`_${id}-level`} label="Education level" value={row.level} onChange={(event) => update({ level: event.target.value })} error={firstError(errors, `${prefix}.level`)}>
                  <option value="">Select a level</option>
                  <option value="high_school">High school</option>
                  <option value="vocational">Vocational</option>
                  <option value="associate">Associate</option>
                  <option value="bachelor">Bachelor</option>
                  <option value="master">Master</option>
                  <option value="doctorate">Doctorate</option>
                  <option value="other">Other</option>
                </SelectField>
                <TextField id={`${id}-fieldOfStudy`} name={`_${id}-fieldOfStudy`} label="Field of study" value={row.fieldOfStudy} onChange={(event) => update({ fieldOfStudy: event.target.value })} error={firstError(errors, `${prefix}.fieldOfStudy`)} />
                <TextField id={`${id}-startDate`} name={`_${id}-startDate`} label="Start date" type="date" value={row.startDate} onChange={(event) => update({ startDate: event.target.value })} error={firstError(errors, `${prefix}.startDate`)} />
                <TextField id={`${id}-endDate`} name={`_${id}-endDate`} label="End date" type="date" value={row.endDate} onChange={(event) => update({ endDate: event.target.value })} disabled={row.isCurrent} error={firstError(errors, `${prefix}.endDate`)} />
                <TextField id={`${id}-grade`} name={`_${id}-grade`} label="Grade" value={row.grade} onChange={(event) => update({ grade: event.target.value })} error={firstError(errors, `${prefix}.grade`)} />
                <CheckboxField id={`${id}-isCurrent`} name={`_${id}-isCurrent`} label="I am currently studying here" checked={row.isCurrent} onChange={(event) => update({ isCurrent: event.target.checked, endDate: event.target.checked ? "" : row.endDate })} className="self-end pb-2" />
                <TextAreaField id={`${id}-description`} name={`_${id}-description`} label="Description" rows={4} value={row.description} onChange={(event) => update({ description: event.target.value })} className="sm:col-span-2" error={firstError(errors, `${prefix}.description`)} />
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={add} className={addButtonClass}>Add education</button>
    </FormSection>
  );
}

export function ExperienceSection({
  rows,
  setRows,
  errors,
}: {
  rows: ExperienceRow[];
  setRows: Dispatch<SetStateAction<ExperienceRow[]>>;
  errors?: Record<string, string[]>;
}) {
  const add = () =>
    setRows((current) => [
      ...current,
      { company: "", jobTitle: "", location: "", employmentType: "", startDate: "", endDate: "", isCurrent: false, description: "" },
    ]);

  return (
    <FormSection
      id="experience-section"
      title="Work experience"
    >
      <div className="space-y-5">
        {rows.length === 0 ? <EmptyState>No work experience.</EmptyState> : null}
        {rows.map((row, index) => {
          const update = (change: Partial<ExperienceRow>) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
          const prefix = `experience.${index}`;
          const id = `experience-${index}`;
          return (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-5">
              <CardHeader number={index + 1} onRemove={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField id={`${id}-company`} name={`_${id}-company`} label="Company" value={row.company} onChange={(event) => update({ company: event.target.value })} required error={firstError(errors, `${prefix}.company`)} />
                <TextField id={`${id}-jobTitle`} name={`_${id}-jobTitle`} label="Job title" value={row.jobTitle} onChange={(event) => update({ jobTitle: event.target.value })} required error={firstError(errors, `${prefix}.jobTitle`)} />
                <TextField id={`${id}-location`} name={`_${id}-location`} label="Location" value={row.location} onChange={(event) => update({ location: event.target.value })} error={firstError(errors, `${prefix}.location`)} />
                <SelectField id={`${id}-employmentType`} name={`_${id}-employmentType`} label="Employment type" value={row.employmentType} onChange={(event) => update({ employmentType: event.target.value })} error={firstError(errors, `${prefix}.employmentType`)}>
                  <option value="">Select a type</option>
                  <option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="internship">Internship</option><option value="freelance">Freelance</option><option value="temporary">Temporary</option>
                </SelectField>
                <TextField id={`${id}-startDate`} name={`_${id}-startDate`} label="Start date" type="date" value={row.startDate} onChange={(event) => update({ startDate: event.target.value })} error={firstError(errors, `${prefix}.startDate`)} />
                <TextField id={`${id}-endDate`} name={`_${id}-endDate`} label="End date" type="date" value={row.endDate} onChange={(event) => update({ endDate: event.target.value })} disabled={row.isCurrent} error={firstError(errors, `${prefix}.endDate`)} />
                <CheckboxField id={`${id}-isCurrent`} name={`_${id}-isCurrent`} label="I currently work here" checked={row.isCurrent} onChange={(event) => update({ isCurrent: event.target.checked, endDate: event.target.checked ? "" : row.endDate })} className="sm:col-span-2" />
                <TextAreaField id={`${id}-description`} name={`_${id}-description`} label="Responsibilities and achievements" rows={5} value={row.description} onChange={(event) => update({ description: event.target.value })} className="sm:col-span-2" error={firstError(errors, `${prefix}.description`)} />
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={add} className={addButtonClass}>Add work experience</button>
    </FormSection>
  );
}

export function SkillsSection({ rows, setRows, errors }: { rows: SkillRow[]; setRows: Dispatch<SetStateAction<SkillRow[]>>; errors?: Record<string, string[]> }) {
  return (
    <FormSection title="Skills">
      <div className="space-y-5">
        {rows.length === 0 ? <EmptyState>No skills.</EmptyState> : null}
        {rows.map((row, index) => {
          const update = (change: Partial<SkillRow>) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
          const prefix = `skills.${index}`;
          const id = `skills-${index}`;
          return (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-5">
              <CardHeader number={index + 1} onRemove={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <div className="grid gap-5 sm:grid-cols-3">
                <TextField id={`${id}-name`} name={`_${id}-name`} label="Skill" value={row.name} onChange={(event) => update({ name: event.target.value })} required error={firstError(errors, `${prefix}.name`)} />
                <SelectField id={`${id}-level`} name={`_${id}-level`} label="Level" value={row.level} onChange={(event) => update({ level: event.target.value })} error={firstError(errors, `${prefix}.level`)}>
                  <option value="">Select a level</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option>
                </SelectField>
                <TextField id={`${id}-yearsOfExperience`} name={`_${id}-yearsOfExperience`} label="Years" type="number" min="0" step="1" value={row.yearsOfExperience} onChange={(event) => update({ yearsOfExperience: event.target.value })} error={firstError(errors, `${prefix}.yearsOfExperience`)} />
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setRows((current) => [...current, { name: "", level: "", yearsOfExperience: "" }])} className={addButtonClass}>Add skill</button>
    </FormSection>
  );
}

export function LanguagesSection({ rows, setRows, errors }: { rows: LanguageRow[]; setRows: Dispatch<SetStateAction<LanguageRow[]>>; errors?: Record<string, string[]> }) {
  return (
    <FormSection title="Languages">
      <div className="space-y-5">
        {rows.length === 0 ? <EmptyState>No languages.</EmptyState> : null}
        {rows.map((row, index) => {
          const update = (change: Partial<LanguageRow>) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
          const prefix = `languages.${index}`;
          const id = `languages-${index}`;
          return (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-5">
              <CardHeader number={index + 1} onRemove={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField id={`${id}-language`} name={`_${id}-language`} label="Language" value={row.language} onChange={(event) => update({ language: event.target.value })} required error={firstError(errors, `${prefix}.language`)} />
                <SelectField id={`${id}-proficiency`} name={`_${id}-proficiency`} label="Proficiency" value={row.proficiency} onChange={(event) => update({ proficiency: event.target.value })} required error={firstError(errors, `${prefix}.proficiency`)}>
                  <option value="">Select proficiency</option><option value="basic">Basic</option><option value="conversational">Conversational</option><option value="professional">Professional</option><option value="fluent">Fluent</option><option value="native">Native</option>
                </SelectField>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setRows((current) => [...current, { language: "", proficiency: "" }])} className={addButtonClass}>Add language</button>
    </FormSection>
  );
}

export function ReferencesSection({ rows, setRows, errors }: { rows: ReferenceRow[]; setRows: Dispatch<SetStateAction<ReferenceRow[]>>; errors?: Record<string, string[]> }) {
  return (
    <FormSection title="References">
      <div className="space-y-5">
        {rows.length === 0 ? <EmptyState>No references.</EmptyState> : null}
        {rows.map((row, index) => {
          const update = (change: Partial<ReferenceRow>) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
          const prefix = `references.${index}`;
          const id = `references-${index}`;
          return (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-5">
              <CardHeader number={index + 1} onRemove={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField id={`${id}-name`} name={`_${id}-name`} label="Name" value={row.name} onChange={(event) => update({ name: event.target.value })} required error={firstError(errors, `${prefix}.name`)} />
                <TextField id={`${id}-relationship`} name={`_${id}-relationship`} label="Relationship" value={row.relationship} onChange={(event) => update({ relationship: event.target.value })} error={firstError(errors, `${prefix}.relationship`)} />
                <TextField id={`${id}-company`} name={`_${id}-company`} label="Company" value={row.company} onChange={(event) => update({ company: event.target.value })} error={firstError(errors, `${prefix}.company`)} />
                <TextField id={`${id}-email`} name={`_${id}-email`} label="Email" type="email" value={row.email} onChange={(event) => update({ email: event.target.value })} error={firstError(errors, `${prefix}.email`)} />
                <TextField id={`${id}-phone`} name={`_${id}-phone`} label="Phone" type="tel" value={row.phone} onChange={(event) => update({ phone: event.target.value })} error={firstError(errors, `${prefix}.phone`)} />
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setRows((current) => [...current, { name: "", relationship: "", company: "", email: "", phone: "" }])} className={addButtonClass}>Add reference</button>
    </FormSection>
  );
}
