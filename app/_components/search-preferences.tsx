"use client";
import type { ReactNode } from "react";
import { internationalSearchCountries } from "@/lib/jobs/locations";
import { acceptedArrangements, acceptedSeniorities, jobAgeLabels, jobAgeOptions, seniorityLabels, seniorityOptions, workArrangementLabels, workArrangementOptions, type SearchPreferences } from "@/lib/jobs/preferences";

const inputClass = "mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
export function SearchPreferencesFields({ value, onChange, disabled = false, children }: {
  value: SearchPreferences; onChange: (value: SearchPreferences) => void; disabled?: boolean; children?: ReactNode;
}) {
  return <fieldset disabled={disabled} className="mt-5 grid gap-4 sm:grid-cols-2">
    <legend className="mb-2 text-sm font-semibold">Job search preferences</legend>
    <label className="text-sm">Target roles
      <input className={inputClass} placeholder="Backend developer, platform engineer" maxLength={504}
        value={value.titles.join(",")} onChange={(e) => onChange({ ...value, titles: e.target.value.split(",").slice(0, 5) })} />
      <span className="mt-1 block text-xs text-zinc-500">Comma-separated; blank uses your CV</span>
    </label>
    <label className="text-sm">Locations
      <input className={inputClass} placeholder="Vienna, Austria" maxLength={504}
        value={value.locations.join(",")} onChange={(e) => onChange({ ...value, locations: e.target.value.split(",").slice(0, 5) })} />
      <span className="mt-1 block text-xs text-zinc-500">Blank searches {internationalSearchCountries.length} countries</span>
    </label>
    <ChoiceGroup label="Work arrangement" hint="None means any" options={workArrangementOptions} labels={workArrangementLabels} selected={acceptedArrangements(value)}
      onChange={(workArrangements) => onChange({ ...value, workArrangements, remotePreference: "any" })} />
    <ChoiceGroup label="Seniority" hint="None means your CV's level" options={seniorityOptions} labels={seniorityLabels} selected={acceptedSeniorities(value)}
      onChange={(seniorities) => onChange({ ...value, seniorities, seniority: "any" })} />
    <label className="text-sm">Posted within
      <select className={inputClass} value={value.maxAgeDays} onChange={(e) => onChange({ ...value, maxAgeDays: Number(e.target.value) as SearchPreferences["maxAgeDays"] })}>
        {jobAgeOptions.map((days) => <option key={days} value={days}>{jobAgeLabels[days]}</option>)}
      </select>
    </label>
    {children}
  </fieldset>;
}

/** A row of toggle chips backed by checkboxes, so several options can be chosen and the group still reads as one field. */
function ChoiceGroup<T extends string>({ label, hint, options, labels, selected, onChange }: { label: string; hint: string; options: readonly T[]; labels: Record<T, string>; selected: T[]; onChange: (next: T[]) => void }) {
  return <fieldset className="text-sm">
    <legend className="text-sm">{label}</legend>
    <div className="mt-1 flex flex-wrap gap-2">
      {options.map((option) => {
        const checked = selected.includes(option);
        return <label key={option} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition ${checked ? "border-blue-600 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-100" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"}`}>
          <input type="checkbox" className="size-3.5 accent-blue-700" checked={checked} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />
          {labels[option]}
        </label>;
      })}
    </div>
    <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
  </fieldset>;
}

export function cleanSearchPreferences(value: SearchPreferences): SearchPreferences {
  return { ...value, titles: value.titles.map((item) => item.trim()).filter(Boolean), locations: value.locations.map((item) => item.trim()).filter(Boolean) };
}
