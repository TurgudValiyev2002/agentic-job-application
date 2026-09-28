import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export const inputClassName =
  "mt-2 block min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-blue-400 dark:focus:ring-blue-400/20 dark:disabled:bg-zinc-900 sm:text-sm";

function Descriptions({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string;
  error?: string;
}) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-2 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return [hint && `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ") || undefined;
}

function Label({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
      {children}
      {required ? (
        <span className="ml-1 text-red-600 dark:text-red-400" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "name"> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({
  name,
  label,
  hint,
  error,
  required,
  className,
  id = name,
  ...props
}: TextFieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>{label}</Label>
      <input
        {...props}
        id={id}
        name={name}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClassName}
      />
      <Descriptions id={id} hint={hint} error={error} />
    </div>
  );
}

type TextAreaFieldProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "name"
> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({
  name,
  label,
  hint,
  error,
  required,
  className,
  id = name,
  rows = 5,
  ...props
}: TextAreaFieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>{label}</Label>
      <textarea
        {...props}
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${inputClassName} resize-y`}
      />
      <Descriptions id={id} hint={hint} error={error} />
    </div>
  );
}

type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "name"
> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function SelectField({
  name,
  label,
  hint,
  error,
  required,
  className,
  id = name,
  children,
  ...props
}: SelectFieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>{label}</Label>
      <select
        {...props}
        id={id}
        name={name}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClassName}
      >
        {children}
      </select>
      <Descriptions id={id} hint={hint} error={error} />
    </div>
  );
}

type CheckboxFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "name" | "type"
> & {
  name: string;
  label: ReactNode;
  hint?: string;
  error?: string;
};

export function CheckboxField({
  name,
  label,
  hint,
  error,
  required,
  className,
  id = name,
  ...props
}: CheckboxFieldProps) {
  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <input
          {...props}
          id={id}
          name={name}
          type="checkbox"
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className="mt-0.5 size-5 shrink-0 rounded border-zinc-300 text-blue-700 focus:ring-2 focus:ring-blue-600/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-blue-400"
        />
        <Label htmlFor={id} required={required}>{label}</Label>
      </div>
      <Descriptions id={id} hint={hint} error={error} />
    </div>
  );
}

export function FormSection({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <fieldset id={id} className="border-0 border-t border-zinc-200 pt-10 dark:border-zinc-800">
      <legend className="sr-only">{title}</legend>
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-white">
          {title}
        </h2>
      </div>
      {children}
    </fieldset>
  );
}

export function firstError(errors: Record<string, string[]> | undefined, key: string) {
  return errors?.[key]?.[0];
}

export function errorAnchor(key: string) {
  return key === "_form" ? "application-form" : key.replaceAll(".", "-");
}
