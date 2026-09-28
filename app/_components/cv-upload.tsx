"use client";

import { useRef, useState } from "react";

export type UploadedCv = {
  id: string;
  originalFilename: string;
  byteSize: number;
  extractionStatus: "pending" | "ok" | "failed" | "unsupported";
  extractionError: string | null;
  textPreview: string;
  /** Present for CVs written from an improved CV rather than uploaded. */
  sourceLabel?: string | null;
  createdAt?: string;
  selectedAt?: string | null;
};

const allowedExtensions = [".pdf", ".docx", ".txt", ".md"];

function fileExtension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function humanFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function responseError(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

export function CvUpload({
  maxBytes,
  value,
  onChange,
  disabled = false,
  statusLabel = "Uploaded",
  recent,
  uploadUrl = "/api/cv",
}: {
  uploadUrl?: string;
  maxBytes: number;
  value: UploadedCv | null;
  onChange: (document: UploadedCv | null) => void;
  disabled?: boolean;
  /** Eyebrow on the selected-CV card, for example "Saved CV". */
  statusLabel?: string;
  /** Readable CVs offered next to the drop zone so the user need not upload again. */
  recent?: UploadedCv[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  function validateFile(file: File) {
    if (!allowedExtensions.includes(fileExtension(file.name))) {
      return "Choose a PDF, DOCX, TXT, or Markdown file.";
    }
    if (file.size > maxBytes) {
      return `Choose a file no larger than ${humanFileSize(maxBytes)}.`;
    }
    if (!file.size) return "Choose a file that is not empty.";
    return null;
  }

  function upload(file: File) {
    const validationMessage = validateFile(file);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setMessage(null);
    setUploading(true);
    setUploadProgress(0);

    const body = new FormData();
    body.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      setUploading(false);
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = null;
      }

      if (request.status !== 201) {
        setMessage(responseError(payload, "The CV could not be uploaded. Please try again."));
        return;
      }

      onChange(payload as UploadedCv);
      setUploadProgress(100);
      if (inputRef.current) inputRef.current.value = "";
    });
    request.addEventListener("error", () => {
      setUploading(false);
      setMessage("The upload could not reach the server. Please try again.");
    });
    request.send(body);
  }

  function removeDocument() {
    if (!value) return;
    setMessage(null);
    onChange(null);
  }

  function replaceDocument() {
    removeDocument();
    // With a recent list the user picks from it or the drop zone; without one
    // the only option is another file, so open the picker straight away.
    if (!recent?.length) inputRef.current?.click();
  }

  return (
    <div>
      <input type="hidden" name="cvDocumentId" value={value?.id ?? ""} />
      <input
        ref={inputRef}
        id="cv-file"
        type="file"
        disabled={disabled || uploading}
        accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
      />

      {!value ? (
        <>
        <div
          role="button"
          tabIndex={uploading || disabled ? -1 : 0}
          aria-disabled={uploading || disabled}
          onClick={() => !uploading && !disabled && inputRef.current?.click()}
          onKeyDown={(event) => {
            if (!uploading && !disabled && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!uploading && !disabled) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file && !uploading && !disabled) upload(file);
          }}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 sm:p-8 ${
            dragging
              ? "border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
              : "border-zinc-300 bg-zinc-50 hover:border-blue-400 hover:bg-blue-50/50 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-blue-600 dark:hover:bg-blue-950/20"
          } ${uploading || disabled ? "cursor-wait opacity-70" : ""}`}
        >
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-blue-100 text-xl text-blue-700 dark:bg-blue-950 dark:text-blue-300" aria-hidden="true">
            ↑
          </div>
          <p className="mt-3 font-semibold text-zinc-900 dark:text-zinc-100">
            {uploading ? "Uploading your CV…" : "Choose a CV or drag it here"}
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            PDF, DOCX, TXT, or Markdown · up to {humanFileSize(maxBytes)}
          </p>
          {uploading ? (
            <div className="mx-auto mt-4 max-w-sm">
              <div
                role="progressbar"
                aria-label="CV upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              >
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width]"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {uploadProgress}%
              </p>
            </div>
          ) : null}
        </div>
        {recent?.length ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Or pick a recent CV</p>
            <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={uploading || disabled}
                    onClick={() => { setMessage(null); onChange(item); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-zinc-900"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-950 dark:text-white">{item.originalFilename}</span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {item.sourceLabel ?? "Uploaded"} · {humanFileSize(item.byteSize)}{item.createdAt ? ` · ${item.createdAt.slice(0, 10)}` : ""}
                      </span>
                    </span>
                    {item.selectedAt ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Used before</span> : null}
                    <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-blue-700 dark:text-blue-300">Use</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/60 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                {statusLabel}
              </p>
              <p className="mt-1 break-words font-semibold text-zinc-950 dark:text-white">
                {value.originalFilename}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {value.sourceLabel ? `${value.sourceLabel} · ` : ""}{humanFileSize(value.byteSize)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={replaceDocument}
                disabled={disabled}
                className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {recent?.length ? "Use a different CV" : "Replace"}
              </button>
              {!recent?.length && (
                <button
                  type="button"
                  onClick={removeDocument}
                  disabled={disabled}
                  className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {value.extractionStatus !== "ok" ? (
            <p className="mt-4 text-sm leading-6 text-amber-800 dark:text-amber-300" role="alert">
              {value.extractionError || "The CV text could not be extracted."}
            </p>
          ) : null}
        </div>
      )}

      {message ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
