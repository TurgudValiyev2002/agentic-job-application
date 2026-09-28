"use client";

import { useState } from "react";
import { connectionKindPresets, connectionKinds, privacyNotice, type ConnectionKind } from "@/lib/ai/connection-kinds";
import type { ModelConnection } from "@/lib/ai/connections";
import { cardClass, inputClass, linkButton, primaryButton, secondaryButton } from "./ui";

type Connection = Omit<ModelConnection, "apiKey">;
type Draft = {
  id?: string; name: string; kind: ConnectionKind; baseUrl: string; apiKey: string; model: string;
  timeoutSeconds: number; isDefault: boolean; useForEmbeddings: boolean; embeddingModel: string; keyHint?: string;
};
type Notice = { ok: boolean; message: string } | null;

const json = { "Content-Type": "application/json" };
const blankDraft = (kind: ConnectionKind = "ollama", first = false): Draft => ({
  name: connectionKindPresets[kind].label, kind, baseUrl: connectionKindPresets[kind].baseUrl, apiKey: "", model: "",
  timeoutSeconds: connectionKindPresets[kind].timeoutMs / 1000, isDefault: first, useForEmbeddings: false, embeddingModel: "",
});
const toDraft = (c: Connection): Draft => ({
  id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, apiKey: "", model: c.model, timeoutSeconds: Math.round(c.timeoutMs / 1000),
  isDefault: c.isDefault, useForEmbeddings: Boolean(c.embeddingModel), embeddingModel: c.embeddingModel ?? "", keyHint: c.keyHint,
});

export function ModelConnections({ initial, env, envDefault }: { initial: Connection[]; env: Connection[]; envDefault: string }) {
  const [connections, setConnections] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(initial.length ? null : blankDraft("ollama", true));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [rowNotice, setRowNotice] = useState<Record<string, Notice>>({});
  const [models, setModels] = useState<string[]>([]);

  async function refresh() {
    const response = await fetch("/api/model-connections", { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setConnections(payload.connections);
  }
  async function call(label: string, run: () => Promise<void>) {
    setBusy(label); setNotice(null);
    try { await run(); } catch (error) { setNotice({ ok: false, message: error instanceof Error ? error.message : "Something went wrong." }); }
    finally { setBusy(null); }
  }
  const body = (d: Draft) => ({
    name: d.name.trim(), kind: d.kind, baseUrl: d.baseUrl.trim(), model: d.model.trim(), timeoutSeconds: d.timeoutSeconds, isDefault: d.isDefault,
    embeddingModel: d.useForEmbeddings ? d.embeddingModel.trim() || null : null,
    ...(connectionKindPresets[d.kind].apiKey === "none" ? { apiKey: null } : d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}),
  });
  const probe = (d: Draft) => ({
    ...(d.id ? { id: d.id } : {}), kind: d.kind, baseUrl: d.baseUrl.trim(), model: d.model.trim() || undefined,
    ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}), ...(d.useForEmbeddings && d.embeddingModel.trim() ? { embeddingModel: d.embeddingModel.trim() } : {}),
  });

  const save = (d: Draft) => call("save", async () => {
    const response = await fetch(d.id ? `/api/model-connections/${d.id}` : "/api/model-connections", { method: d.id ? "PUT" : "POST", headers: json, body: JSON.stringify(body(d)) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not save the connection.");
    await refresh(); setDraft(null); setModels([]);
    setNotice({ ok: true, message: `${payload.connection.name} saved.` });
  });
  const test = (d: Draft) => call("test", async () => {
    const response = await fetch("/api/model-connections/test", { method: "POST", headers: json, body: JSON.stringify(probe(d)) });
    const payload = await response.json();
    setNotice(response.ok ? payload : { ok: false, message: payload.error });
  });
  const loadModels = (d: Draft) => call("models", async () => {
    const response = await fetch("/api/model-connections/models", { method: "POST", headers: json, body: JSON.stringify(probe(d)) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    setModels(payload.models);
    setNotice({ ok: true, message: payload.models.length ? `${payload.models.length} models found; pick one in the model field.` : "The server listed no models." });
  });
  const testSaved = (c: Connection) => { setBusy(`test:${c.id}`); setRowNotice((n) => ({ ...n, [c.id]: null }));
    fetch("/api/model-connections/test", { method: "POST", headers: json, body: JSON.stringify(probe(toDraft(c))) })
      .then(async (response) => { const payload = await response.json(); setRowNotice((n) => ({ ...n, [c.id]: response.ok ? payload : { ok: false, message: payload.error } })); })
      .catch(() => setRowNotice((n) => ({ ...n, [c.id]: { ok: false, message: "The test request failed." } })))
      .finally(() => setBusy(null));
  };
  const makeDefault = (c: Connection) => call(`default:${c.id}`, async () => {
    const response = await fetch(`/api/model-connections/${c.id}`, { method: "PUT", headers: json, body: JSON.stringify({ ...body(toDraft(c)), isDefault: true }) });
    if (!response.ok) throw new Error((await response.json()).error);
    await refresh();
  });
  const remove = (c: Connection) => {
    if (!window.confirm(`Delete ${c.name}? Runs that used it will not be able to retry with it.`)) return;
    void call(`delete:${c.id}`, async () => {
      const response = await fetch(`/api/model-connections/${c.id}`, { method: "DELETE", headers: json });
      if (!response.ok) throw new Error((await response.json()).error);
      await refresh(); if (draft?.id === c.id) setDraft(null);
    });
  };
  const importEnv = () => call("import", async () => {
    const response = await fetch("/api/model-connections/import-env", { method: "POST", headers: json, body: "{}" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    await refresh(); setDraft(null);
    setNotice({ ok: true, message: `Imported ${payload.connections.length} connection${payload.connections.length === 1 ? "" : "s"} from .env.local.` });
  });

  return <div className="mt-8 space-y-6">
    {!connections.length && <section className={`${cardClass} p-5 sm:p-6`} aria-label="Current configuration">
      <h2 className="text-base font-semibold text-zinc-950 dark:text-white">From .env.local</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Default: <strong>{env.find((c) => c.id === envDefault)?.name ?? envDefault}</strong></p>
      <ul className="mt-3 space-y-1 text-sm">{env.map((c) => <li key={c.id}><strong>{c.name}</strong> · {c.model} · <span className="text-zinc-500">{c.available ? c.baseUrl : c.unavailableReason}</span></li>)}</ul>
      <button type="button" onClick={importEnv} disabled={busy !== null} className={`${secondaryButton} mt-4`}>{busy === "import" ? "Importing…" : "Import these as connections"}</button>
    </section>}

    {connections.length > 0 && <section aria-label="Saved connections" className="space-y-3">
      {connections.map((c) => {
        const n = rowNotice[c.id];
        return <article key={c.id} className={`${cardClass} p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-zinc-950 dark:text-white">{c.name}
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{connectionKindPresets[c.kind].label}</span>
                {c.isDefault && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">Default</span>}
                {c.embeddingModel && <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-xs font-semibold text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">Embeddings · {c.embeddingModel}</span>}
              </h2>
              <p className="mt-1 break-all text-sm text-zinc-600 dark:text-zinc-400"><code>{c.model}</code> at {c.baseUrl}{c.keyHint ? ` · key ••••${c.keyHint}` : ""}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{privacyNotice(c.kind, c.baseUrl)}</p>
              {!c.available && <p role="alert" className="mt-1 text-sm text-amber-700 dark:text-amber-300">{c.unavailableReason}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => testSaved(c)} disabled={busy !== null} className={secondaryButton}>{busy === `test:${c.id}` ? "Testing…" : "Test"}</button>
              <button type="button" onClick={() => { setDraft(toDraft(c)); setModels([]); setNotice(null); }} disabled={busy !== null} className={secondaryButton}>Edit</button>
              {!c.isDefault && <button type="button" onClick={() => makeDefault(c)} disabled={busy !== null} className={secondaryButton}>Make default</button>}
              <button type="button" onClick={() => remove(c)} disabled={busy !== null} className={linkButton}>Delete</button>
            </div>
          </div>
          {n && <p role="status" className={`mt-3 text-sm ${n.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-300"}`}>{n.message}</p>}
        </article>;
      })}
      {!draft && <button type="button" onClick={() => { setDraft(blankDraft()); setModels([]); setNotice(null); }} className={secondaryButton}>Add a connection</button>}
    </section>}

    {notice && !draft && <p role="status" className={`text-sm ${notice.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-300"}`}>{notice.message}</p>}

    {draft && <ConnectionForm draft={draft} setDraft={setDraft} models={models} busy={busy} notice={notice} canCancel={connections.length > 0}
      onSave={() => save(draft)} onTest={() => test(draft)} onLoadModels={() => loadModels(draft)} onCancel={() => { setDraft(null); setNotice(null); }} />}
  </div>;
}

function ConnectionForm({ draft, setDraft, models, busy, notice, canCancel, onSave, onTest, onLoadModels, onCancel }: {
  draft: Draft; setDraft: (d: Draft) => void; models: string[]; busy: string | null; notice: Notice; canCancel: boolean;
  onSave: () => void; onTest: () => void; onLoadModels: () => void; onCancel: () => void;
}) {
  const preset = connectionKindPresets[draft.kind];
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const pickKind = (kind: ConnectionKind) => {
    const next = connectionKindPresets[kind];
    const untouched = (Object.values(connectionKindPresets) as { label: string; baseUrl: string }[]);
    set({
      kind,
      // Replace values the person has not changed from the previous kind's preset.
      name: !draft.name || untouched.some((p) => p.label === draft.name) ? next.label : draft.name,
      baseUrl: !draft.baseUrl || untouched.some((p) => p.baseUrl === draft.baseUrl) ? next.baseUrl : draft.baseUrl,
      timeoutSeconds: next.timeoutMs / 1000,
      ...(next.embeddings ? {} : { useForEmbeddings: false }),
      ...(next.apiKey === "none" ? { apiKey: "" } : {}),
    });
  };
  const disabled = busy !== null;
  return <section aria-label={draft.id ? `Edit ${draft.name}` : "Add a connection"} className={`${cardClass} p-5 sm:p-6`}>
    <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{draft.id ? `Edit ${draft.name}` : "Add a connection"}</h2>
    <fieldset className="mt-4" disabled={disabled}>
      <legend className="text-sm font-semibold text-zinc-950 dark:text-white">Where the model runs</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-5">
        {connectionKinds.map((kind) => <label key={kind} className={`cursor-pointer rounded-lg border p-3 text-sm ${draft.kind === kind ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30" : "border-zinc-200 dark:border-zinc-700"}`}>
          <input type="radio" name="connection-kind" className="sr-only" checked={draft.kind === kind} onChange={() => pickKind(kind)} />
          <span className="block font-semibold">{connectionKindPresets[kind].label}</span>
          <span className="mt-0.5 block text-xs text-zinc-500">{kind === "custom" ? "OpenAI-compatible URL" : connectionKindPresets[kind].apiKey === "required" ? "API key" : "Local or tunnel"}</span>
        </label>)}
      </div>
    </fieldset>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Name
        <input className={inputClass} value={draft.name} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="text-sm font-medium">{draft.kind === "custom" ? "API link (base URL)" : "Base URL"}
        <input className={inputClass} value={draft.baseUrl} disabled={disabled} placeholder={draft.kind === "custom" ? "https://my-gateway.example.com/v1" : preset.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
        <span className="mt-1 block text-xs text-zinc-500">{draft.kind === "ollama" ? "Server root, not …/api" : draft.kind === "custom" ? "Up to /v1" : ""}</span>
      </label>
      {preset.apiKey !== "none" && <label className="text-sm font-medium">API key {preset.apiKey === "optional" && <span className="font-normal text-zinc-500">(optional)</span>}
        <input className={inputClass} type="password" autoComplete="off" value={draft.apiKey} disabled={disabled}
          placeholder={draft.keyHint ? `Saved key ••••${draft.keyHint}; leave empty to keep it` : preset.apiKey === "required" ? "Paste your key" : "Only if the server needs one"} onChange={(e) => set({ apiKey: e.target.value })} />
      </label>}
      <label className="text-sm font-medium">Model
        <div className="mt-1 flex gap-2">
          <input className={`${inputClass} mt-0`} list="connection-models" value={draft.model} disabled={disabled} placeholder={preset.modelPlaceholder} onChange={(e) => set({ model: e.target.value })} />
          <button type="button" onClick={onLoadModels} disabled={disabled || !draft.baseUrl} className={secondaryButton}>{busy === "models" ? "Loading…" : "Load models"}</button>
        </div>
        <datalist id="connection-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label className="text-sm font-medium">Timeout (seconds)
        <input className={inputClass} type="number" min={10} max={3600} value={draft.timeoutSeconds} disabled={disabled} onChange={(e) => set({ timeoutSeconds: Number(e.target.value) || 0 })} />
      </label>
    </div>
    <div className="mt-5 space-y-3 text-sm">
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-blue-700" checked={draft.isDefault} disabled={disabled} onChange={(e) => set({ isDefault: e.target.checked })} />
        <span><strong>Default connection</strong><span className="block text-xs text-zinc-500">Used for background work</span></span></label>
      {preset.embeddings && <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-blue-700" checked={draft.useForEmbeddings} disabled={disabled} onChange={(e) => set({ useForEmbeddings: e.target.checked })} />
        <span className="flex-1"><strong>Also use for embeddings</strong><span className="block text-xs text-zinc-500">Ranks jobs against your CV</span>
          {draft.useForEmbeddings && <input className={`${inputClass} max-w-sm`} value={draft.embeddingModel} disabled={disabled} placeholder={preset.embeddingPlaceholder} onChange={(e) => set({ embeddingModel: e.target.value })} />}</span></label>}
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
      <button type="button" onClick={onSave} disabled={disabled || !draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()} className={primaryButton}>{busy === "save" ? "Saving…" : "Save connection"}</button>
      <button type="button" onClick={onTest} disabled={disabled || !draft.baseUrl.trim() || !draft.model.trim()} className={secondaryButton}>{busy === "test" ? "Testing…" : "Test connection"}</button>
      {canCancel && <button type="button" onClick={onCancel} disabled={disabled} className={linkButton}>Cancel</button>}
    </div>
    {notice && <p role="status" className={`mt-3 text-sm ${notice.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-300"}`}>{notice.message}</p>}
  </section>;
}
