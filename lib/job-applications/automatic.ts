import { isDeepStrictEqual } from "node:util";
import type { ApplicationAdapter } from "./adapter";
import { missingRequired, type AnswerEvidence, type ApplicationField, type ApplicationSnapshot } from "./types";

type Answers = { answers: Record<string, string>; evidence: AnswerEvidence[] };
/** Bounded form filling. Submission remains in the worker's durable, single-attempt state machine. */
export async function fillAutomaticApplication(adapter: ApplicationAdapter, generate: (fields: ApplicationField[]) => Promise<Answers>, checkpoint: (snapshot: ApplicationSnapshot, evidence: AnswerEvidence[]) => Promise<boolean>) {
  for (let step = 0; step < 10; step++) {
    const snapshot = await adapter.snapshot();
    if (!await checkpoint(snapshot, [])) throw new Error("Automatic application cancelled or ownership lost.");
    // Invalid existing answers and challenge notices require user attention; never blindly click through them.
    if (snapshot.notice) return { snapshot, ready: false, message: snapshot.notice };
    const generated = await generate(snapshot.fields);
    if (!Object.keys(generated.answers).length) {
      if (snapshot.readyToSubmit !== false && snapshot.resume && !missingRequired(snapshot.fields).length) return { snapshot, ready: true, message: "All required answers and the tailored CV are ready. Saving it as a draft on Indeed." };
      if (missingRequired(snapshot.fields).length) return { snapshot, ready: false, message: "Automatic filling paused. Add the missing facts or complete the controls below, then save answers to continue automatically." };
      // Optional unsupported questions may stay blank; the adapter only clicks a known Continue control.
    }
    // Reject stale field IDs after a slow model call or edits in the visible browser.
    if (!isDeepStrictEqual(snapshot, await adapter.snapshot())) return { snapshot: await adapter.snapshot(), ready: false, message: "The browser changed while answers were being drafted. Review the current form before continuing." };
    if (!await checkpoint(snapshot, generated.evidence)) throw new Error("Automatic application cancelled or ownership lost.");
    await adapter.fillAnswers(generated.answers);
    const after = await adapter.snapshot();
    if (isDeepStrictEqual(after, snapshot)) return { snapshot: after, ready: false, message: "Indeed did not accept the generated answers. Check the visible form." };
  }
  return { snapshot: await adapter.snapshot(), ready: false, message: "Automatic filling reached its step limit. Complete the remaining form steps below." };
}
