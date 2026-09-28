import type { CvContent } from "@/lib/cv/content";

export function CvContentPreview({ content }: { content: CvContent }) {
  return (
    <details className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      <summary className="cursor-pointer font-semibold">Preview CV</summary>
      <div className="mt-4 max-h-[32rem] space-y-5 overflow-y-auto pr-2 leading-6">
        <header><p className="text-lg font-semibold">{content.name}</p><p className="text-xs text-zinc-500">{content.contactLine.map((item) => item.text).join(" · ")}</p></header>
        {content.summary && <p>{content.summary}</p>}
        {content.skills.length > 0 && <section><h4 className="mb-2 font-semibold">Skills</h4>{content.skills.map((skill, i) => <p key={i}><strong>{skill.category}:</strong> {skill.items}</p>)}</section>}
        {content.experience.length > 0 && <section><h4 className="mb-2 font-semibold">Experience</h4>{content.experience.map((entry, i) => <div key={i} className="mb-3"><p className="font-medium">{entry.jobTitle} · {entry.company}</p><p className="text-xs text-zinc-500">{[entry.location, entry.dateRange].filter(Boolean).join(" · ")}</p><Bullets items={entry.bullets} /></div>)}</section>}
        {content.projects.length > 0 && <section><h4 className="mb-2 font-semibold">Projects</h4>{content.projects.map((entry, i) => <div key={i} className="mb-3"><p className="font-medium">{entry.title}</p>{entry.linkText && <p className="text-xs text-zinc-500">{entry.linkText}</p>}<Bullets items={entry.bullets} /></div>)}</section>}
        {content.education.length > 0 && <section><h4 className="mb-2 font-semibold">Education</h4>{content.education.map((entry, i) => <p key={i}>{entry.degree} · {entry.school}{entry.date ? ` · ${entry.date}` : ""}</p>)}</section>}
      </div>
    </details>
  );
}

function Bullets({ items }: { items: string[] }) {
  return <ul className="ml-5 list-disc">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
}
