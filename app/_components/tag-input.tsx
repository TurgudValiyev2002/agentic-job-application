"use client";

import { useState } from "react";

import { inputClassName } from "./field";

export function TagInput({
  id,
  label,
  hint,
  tags,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const tag = draft.trim().replace(/,$/, "").trim();
    if (tag && !tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
      onChange([...tags, tag]);
    }
    setDraft("");
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </label>
      <div className="mt-2 rounded-lg border border-zinc-300 bg-white p-2 shadow-sm focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-blue-400 dark:focus-within:ring-blue-400/20">
        {tags.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200"
              >
                <span className="truncate">{tag}</span>
                <button
                  type="button"
                  onClick={() => onChange(tags.filter((item) => item !== tag))}
                  className="rounded-full px-1 text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:text-blue-300 dark:hover:bg-blue-900"
                  aria-label={`Remove ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          className={`${inputClassName} mt-0 border-0 px-1 shadow-none focus:ring-0`}
          aria-describedby={`${id}-hint`}
        />
      </div>
      <p id={`${id}-hint`} className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {hint}
      </p>
    </div>
  );
}
