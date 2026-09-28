import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Page } from "playwright";
import type { ApplicationAdapter } from "./adapter";
import { indeedJobUrl, isIndeedHost } from "../jobs/sources/indeed-data";
import { APPLY_FORM_CHALLENGE_MARKERS, INDEED_APPLY_SELECTOR, INDEED_EXTERNAL_APPLY_SELECTOR, awaitVerification, pageProblem, readIndeedPostingState, readSignedInFlag, type VerificationWait } from "../indeed/browser";
import { missingRequired, type ApplicantProfile, type ApplicationField, type ApplicationSnapshot, type IndeedDraft } from "./types";

// Indeed Apply speaks the country site's language; every control the adapter clicks is matched in English, German,
// French, Spanish, Italian, Dutch and Portuguese. Keep SUBMIT_LABEL in step with the copy inside open() below.
const SUBMIT_LABEL = /submit (?:your )?application|bewerbung (?:jetzt )?(?:absenden|senden|einreichen|abschicken)|^absenden$|^submit$|envoyer (?:votre |la |ma )?candidature|^envoyer$|enviar (?:tu |la |mi )?(?:solicitud|candidatura)|^enviar$|invia (?:la (?:tua )?)?candidatura|^invia$|sollicitatie (?:verzenden|versturen|indienen)|^verzenden$|^versturen$|enviar (?:a (?:sua |minha )?)?candidatura|^submeter$/i;
const CONTINUE_LABEL = /^(?:continue|weiter|next|save and continue|speichern und weiter|review your application|bewerbung (?:prüfen|überprüfen)|continuer|suivant|enregistrer et continuer|vérifier (?:votre |ma )?candidature|continuar|siguiente|guardar y continuar|revisar (?:tu |mi )?(?:solicitud|candidatura)|continua|avanti|salva e continua|rivedi (?:la (?:tua )?)?candidatura|doorgaan|volgende|opslaan en doorgaan|sollicitatie (?:controleren|bekijken)|próximo|seguinte|salvar e continuar|guardar e continuar|rever (?:a (?:sua )?)?candidatura)$/i;
const CONFIRMATION = /application (?:has been |was )?(?:submitted|sent|received)|you(?:'ve| have) applied|thanks for applying|thank you for applying|bewerbung (?:wurde )?(?:gesendet|abgeschickt|eingereicht|übermittelt)|erfolgreich beworben|candidature (?:a été )?(?:envoyée|transmise|reçue)|merci (?:d'avoir postulé|pour votre candidature)|(?:solicitud|candidatura) (?:ha sido )?(?:enviada|recibida)|gracias por (?:postularte|tu solicitud)|candidatura (?:è stata )?(?:inviata|ricevuta)|grazie per (?:la (?:tua )?candidatura|aver inviato)|sollicitatie (?:is )?(?:verzonden|verstuurd|ontvangen)|bedankt voor (?:je|uw) sollicitatie|candidatura (?:foi )?(?:enviada|recebida)|obrigad[oa] por (?:se candidatar|sua candidatura)/i;
const MAX_STEPS = 10;
/** Shown while Indeed's "I'm not a robot" box blocks the submit button; the worker resumes on its own once it is ticked. */
export const CAPTCHA_NOTICE = "Indeed requires reCAPTCHA verification in the open Indeed window.";
export const SUBMISSION_PENDING_NOTICE = "Indeed has not enabled its Submit button yet. Waiting for the page to become ready.";

/**
 * Indeed marks a started application on the posting itself: the apply control reads "Continue application" and the header says
 * "You started this application …". This holds on every country site, unlike My jobs, which lists drafts only for the account's
 * own country. Returns the evidence line, or null when the posting shows a fresh Apply control.
 */
export async function verifyIndeedDraft(page: Page, postingUrl: string, attempts = 3): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await page.waitForTimeout(5_000);
    await page.goto(postingUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForFunction((selector) => Boolean(document.querySelector(selector)), `${INDEED_APPLY_SELECTOR}, ${INDEED_EXTERNAL_APPLY_SELECTOR}`, { timeout: 15_000 }).catch(() => {});
    const evidence = await page.evaluate((selector) => {
      const control = document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const started = document.body.innerText.split("\n").map((line) => line.trim()).find((line) => /you started this application|sie haben (?:diese |mit dieser )?bewerbung .*begonnen|bewerbung begonnen|vous avez commencé (?:cette |votre )?candidature|candidature commencée|has comenzado (?:esta |tu )?(?:solicitud|candidatura)|hai iniziato (?:questa |la (?:tua )?)?candidatura|je bent (?:met )?(?:deze |je )?sollicitatie begonnen|você começou (?:esta |a (?:sua )?)?candidatura/i.test(line)) ?? "";
      const continues = /continue application|bewerbung fortsetzen|continuer (?:la |votre |ma )?candidature|continuar (?:la |tu |mi |a |sua )?(?:solicitud|candidatura)|continua (?:la (?:tua )?)?candidatura|sollicitatie (?:voortzetten|hervatten)/i.test(control);
      return continues || started ? `Indeed shows "${control || started}"${continues && started ? ` and "${started}"` : ""} on the posting.` : null;
    }, INDEED_APPLY_SELECTOR).catch(() => null);
    if (evidence) return evidence;
  }
  return null;
}

/** Contact answers by label; eligibility, compensation or demographic questions are never inferred. */
export function profileAnswer(label: string, profile: ApplicantProfile): string | null {
  const text = label.toLowerCase().replace(/\s*\((?:required|optional|erforderlich)\)\s*|\s*\*\s*$/g, "").trim();
  const [first, ...rest] = profile.name.trim().split(/\s+/);
  if (/^(?:first name|given name|vorname)$/.test(text)) return first ?? null;
  if (/^(?:last name|surname|family name|nachname)$/.test(text)) return rest.join(" ") || null;
  if (/^(?:(?:full )?name|vollständiger name)$/.test(text)) return profile.name;
  if (/^(?:e-?mail(?: address)?|e-mail-adresse)$/.test(text)) return profile.email;
  if (/^(?:phone(?: number)?|telephone(?: number)?|telefon(?:nummer)?|mobile(?: number)?|handy(?:nummer)?)$/.test(text)) return profile.phone || null;
  if (/^linkedin(?: (?:url|profile))?$/.test(text)) return profile.linkedin || null;
  if (/^github(?: (?:url|profile))?$/.test(text)) return profile.github || null;
  if (/^(?:portfolio|website|webseite|personal site)(?: url)?$/.test(text)) return profile.portfolio || null;
  if (/^(?:current (?:company|employer)|aktueller arbeitgeber|company name)$/.test(text)) return profile.currentCompany || null;
  if (/^(?:city|town|location|stadt|wohnort|ort)$/.test(text)) return profile.location || null;
  return null;
}

/**
 * Indeed Apply is a multi-step form on smartapply.indeed.com (contact → resume → employer questions → review).
 * The adapter fills contact details, uploads ONLY the selected tailored PDF, advances while every required
 * answer is present, and stops for the person at employer questions and at the review step.
 */
export class IndeedApplyBrowser implements ApplicationAdapter {
  private submissionAllowed = false;
  private submissionDispatched = false;
  private submissionRequests: string[] = [];
  private resumeName = "";
  private prepared?: { profile: ApplicantProfile; pdf: Uint8Array; filename: string };
  private submissionAttempted = false;
  private draftSaveAttempted = false;
  private answeredStep: string | null = null;
  /** Text of Indeed's "Preview what the employer sees" once it confirmed the tailored CV; appended to every later review snapshot. */
  private employerPreview: string | null = null;
  /** The resume step showed the tailored file's name after the upload (Indeed's current review page lists no resume at all). */
  private resumeSeenOnStep = false;
  private employerPreviewChecked = false;
  private pauseForQuestions: boolean;
  private verification: VerificationWait;
  constructor(public page: Page, public url: string, options: { pauseForQuestions?: boolean; verification?: VerificationWait } = {}) {
    this.pauseForQuestions = options.pauseForQuestions ?? false;
    // By default a bot check keeps the visible window open for the person to clear it (INDEED_VERIFICATION_WAIT_MS).
    this.verification = options.verification ?? {};
  }
  // `page` starts on the job posting and becomes the smartapply form tab after open().
  allowsNavigation(url: string) {
    try { const target = new URL(url); return target.protocol === "https:" && !target.port && !target.username && !target.password && isIndeedHost(target.hostname); } catch { return false; }
  }
  async open() {
    if (!indeedJobUrl(this.url)) throw new Error("Invalid Indeed posting URL.");
    // Applied to the whole context so the guard and detection also cover the smartapply tab Indeed opens.
    await this.page.context().addInitScript(() => {
      // Enter and Indeed's final button must not submit during preparation/review; other steps may continue.
      const final = /submit (?:your )?application|bewerbung (?:jetzt )?(?:absenden|senden|einreichen|abschicken)|^absenden$|^submit$|envoyer (?:votre |la |ma )?candidature|^envoyer$|enviar (?:tu |la |mi )?(?:solicitud|candidatura)|^enviar$|invia (?:la (?:tua )?)?candidatura|^invia$|sollicitatie (?:verzenden|versturen|indienen)|^verzenden$|^versturen$|enviar (?:a (?:sua |minha )?)?candidatura|^submeter$/i;
      // Destructured so the TypeScript loader used by tests does not inject a name helper into browser code.
      const [allowed] = [() => (window as unknown as { __orchSubmitAllowed?: boolean }).__orchSubmitAllowed === true];
      Object.assign(window, { __orchSubmitAllowed: false });
      document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("button, input[type=submit]") : null;
        if (target && final.test((target.getAttribute("aria-label") || target.textContent?.trim() || (target as HTMLInputElement).value || "").trim()) && !allowed()) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      document.addEventListener("submit", (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        const finalButton = form && [...form.querySelectorAll("button, input[type=submit]")].some((button) => final.test((button.getAttribute("aria-label") || button.textContent?.trim() || (button as HTMLInputElement).value || "").trim()));
        if (finalButton && !allowed()) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
    });
    this.page.context().on("request", (request) => {
      // Only a form request counts as a dispatched submission; Indeed's pages also POST telemetry beacons to their own hosts.
      const host = (() => { try { return new URL(request.url()).hostname; } catch { return ""; } })();
      // Only the apply services count; Indeed's pages also POST telemetry (rum-proxy, Datadog forwarders, beacons) to their own hosts.
      const applyService = /^(?:smartapply|apply|apis|secure)\.indeed\.com$/.test(host);
      if (this.submissionAllowed && request.method() === "POST" && applyService && !/\/(?:rpc\/)?(?:log|beacon|track|event|metrics|telemetry|collect|ping|rum)\b/i.test(new URL(request.url()).pathname) && !/[?&]dd(?:forward|source)=/.test(request.url())) {
        this.submissionDispatched = true;
        this.submissionRequests.push(request.url().slice(0, 200));
      }
    });
    await this.page.goto(this.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await this.assertNoProblem();
    // A cleared bot check navigates to the posting on its own: wait for its server-side model (or a rendered apply control) to arrive.
    await this.page.waitForFunction((selector) => Boolean((window as unknown as { _initialData?: unknown })._initialData) || Boolean(document.querySelector(selector)), `${INDEED_APPLY_SELECTOR}, ${INDEED_EXTERNAL_APPLY_SELECTOR}`, { timeout: 15_000 }).catch(() => {});
    const posting = await readIndeedPostingState(this.page);
    if (posting.expired) throw new Error("This Indeed posting has expired.");
    // Fall back to the shared header/account heuristic when the page exposes no explicit flag.
    const signedIn = posting.loggedIn ?? await readSignedInFlag(this.page);
    if (!signedIn) throw new Error("This browser is not signed in to Indeed. Sign in to Indeed on the Pipeline page, then prepare the application again.");
    // The header with the apply control is rendered client-side, so give it time when the model promises Indeed Apply.
    const applyButton = this.page.locator(INDEED_APPLY_SELECTOR).filter({ visible: true }).first();
    // Checked repeatedly rather than once: the header can re-render right after the button first shows.
    const applyButtonShown = async (timeout: number) => {
      for (const deadline = Date.now() + timeout; ; await this.page.waitForTimeout(500)) {
        if (await applyButton.count().catch(() => 0)) return true;
        if (Date.now() >= deadline) return false;
      }
    };
    let shown = posting.indeedApply === false ? Boolean(await applyButton.count()) : await applyButtonShown(posting.indeedApply ? 15_000 : 8_000);
    // One reload before giving up: a posting that promises Indeed Apply sometimes renders without its header control.
    if (!shown && posting.indeedApply) {
      await this.page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
      await this.assertNoProblem();
      shown = await applyButtonShown(15_000);
    }
    if (!shown) {
      if (posting.indeedApply === false || await this.page.locator(INDEED_EXTERNAL_APPLY_SELECTOR).count()) throw new Error("This posting sends applicants to the company's own website; Indeed Apply is not offered. Apply on the company site manually.");
      if (!posting.indeedApply) throw new Error("This posting does not offer Indeed Apply. Apply on the company site manually.");
      // A bot check can replace the page after it first loaded; that is a verification, not a missing button.
      await this.assertNoProblem();
      // Record what the page showed so the cause can be told apart later (layout change, closed posting, …).
      const seen = await this.page.evaluate(() => ({
        title: document.title.slice(0, 120),
        buttons: [...document.querySelectorAll("a, button")].filter((element) => (element as HTMLElement).offsetParent !== null)
          .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()).filter((text) => text && text.length < 40).slice(0, 8),
      })).catch(() => ({ title: "", buttons: [] as string[] }));
      const capture = await this.capture("apply-button-missing");
      console.warn(`Indeed apply button missing on ${this.url}: title "${seen.title}", visible buttons: ${seen.buttons.join(" | ")}${capture ? `; page saved to ${capture}` : ""}`);
      throw new Error(`Indeed's apply button did not appear on the posting (page "${seen.title}"${seen.buttons.length ? `; visible buttons: ${seen.buttons.slice(0, 5).join(", ")}` : ""}). Open the posting to check it is still open.`);
    }
    // Indeed Apply opens the form in a new tab (occasionally it navigates the same tab). Handle both.
    const jobTab = this.page;
    // Same-tab navigation should not incur the full popup timeout on every application.
    const popupPromise = jobTab.waitForEvent("popup", { timeout: 30_000 });
    const sameTab = jobTab.waitForURL(url => url.hostname === "smartapply.indeed.com" || url.hostname === "secure.indeed.com", { timeout: 30_000 }).then(() => null);
    const opened = Promise.any([popupPromise, sameTab]).catch(() => null);
    await applyButton.click({ timeout: 10_000 });
    const popup = await opened;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      this.page = popup;
      // The job posting tab is no longer needed; the form tab is the working page.
      if (jobTab !== popup) await jobTab.close().catch(() => {});
    } else {
      await jobTab.waitForURL((url) => ["smartapply.indeed.com", "secure.indeed.com"].includes(url.hostname), { timeout: 30_000 }).catch(() => {});
    }
    await this.page.waitForURL((url) => url.hostname === "smartapply.indeed.com", { timeout: 30_000 }).catch(() => {});
    this.page.setDefaultTimeout(15_000);
    // The form tab can be challenged as well; the person clears it in the same visible window.
    await this.assertNoProblem(APPLY_FORM_CHALLENGE_MARKERS);
    if (new URL(this.page.url()).hostname !== "smartapply.indeed.com") throw new Error("Indeed did not open the application form. Sign in to Indeed on the Pipeline page, then prepare again.");
    await this.settle();
    await this.assertNoProblem(APPLY_FORM_CHALLENGE_MARKERS);
  }
  /** Sign-in redirects and blocks fail at once; a bot check waits for the person, then fails only when the wait runs out. */
  private async assertNoProblem(markers?: string) {
    const problem = await awaitVerification(this.page, await pageProblem(this.page, markers), this.verification, markers);
    if (problem) throw new Error(problem);
  }
  assertDestination() {
    const hostname = new URL(this.page.url()).hostname;
    if (!this.allowsNavigation(this.page.url()) || (hostname !== "smartapply.indeed.com" && indeedJobUrl(this.page.url()) !== this.url)) throw new Error("The browser left the Indeed application. Preparation stopped.");
  }
  /** Saves a screenshot and the HTML of the current page for diagnosing a step Indeed rendered differently. Local only. */
  private async capture(reason: string) {
    if (process.env.NODE_TEST_CONTEXT) return null;
    try {
      const directory = path.join(process.cwd(), ".cache", "application-diagnosis");
      await mkdir(directory, { recursive: true });
      const base = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}`);
      await this.page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 10_000 });
      await writeFile(`${base}.html`, await this.page.content());
      return base;
    } catch { return null; }
  }
  /** Waits until no Indeed loading spinner (an svg labelled by an "ifl-Spinner-title" element) is visible. */
  private async waitForSpinners(timeout: number) {
    await this.page.waitForFunction(() => ![...document.querySelectorAll('svg[aria-labelledby^="ifl-Spinner-title"]')].some((element) => element.getClientRects().length > 0), {}, { timeout }).catch(() => {});
  }
  private async settle() {
    await this.page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await this.page.waitForFunction(() => !document.querySelector('[aria-busy="true"], [role="progressbar"]:not([aria-hidden="true"])'), {}, { timeout: 10_000 }).catch(() => {});
    await this.page.waitForTimeout(500);
    // SmartApply can temporarily render only its navigation shell between modules.
    // Do not mistake an empty module for a completed form with no required fields.
    await this.page.locator('h1, main h2, form input, form textarea, form select, [data-testid="resume-selection-file-resume-radio-card-input"]')
      .filter({ visible: true }).first().waitFor({ state: "visible", timeout: 15_000 });
  }
  private submitButton() {
    return this.page.getByRole("button", { name: SUBMIT_LABEL }).filter({ visible: true });
  }
  private async onReview() {
    return (await this.submitButton().count()) > 0;
  }
  /** Observe verification state without interacting with or attempting to solve a challenge. */
  private async captchaPending() {
    return this.page.evaluate(() => {
      // Destructured so the TypeScript test loader does not inject a helper into browser code.
      const [visible] = [(element: Element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        }
        return true;
      }];
      const widgets = [...document.querySelectorAll<HTMLElement>('iframe[src*="recaptcha"][src*="anchor"], .g-recaptcha')].filter(element =>
        visible(element) && !element.closest('.grecaptcha-badge, [data-size="invisible"]') && !/[?&]size=invisible(?:&|$)/.test(element.getAttribute("src") ?? ""));
      const activeChallenge = [...document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]')].some(visible);
      const solved = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[name^="g-recaptcha-response"], input[name^="g-recaptcha-response"]')].some(field => field.value.trim().length > 0);
      return activeChallenge || (widgets.length > 0 && !solved);
    });
  }
  async snapshot(): Promise<ApplicationSnapshot> {
    this.assertDestination();
    const data = await this.page.evaluate(async () => {
      const container = document.querySelector("main") ?? document.body;
      // Destructured so the TypeScript loader used by tests does not inject a name helper into browser code.
      const [visible, text] = [(element: Element) => element.getClientRects().length > 0, (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, " ").trim() ?? ""];
      const controls = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")];
      const fields: ApplicationField[] = [];
      const groups = new Set<string>();
      for (const [index, element] of controls.entries()) {
        const type = element instanceof HTMLTextAreaElement ? "textarea" : element instanceof HTMLSelectElement ? "select" : element.type;
        if (["hidden", "submit", "button", "reset", "password", "search"].includes(type) || element.disabled || (element as HTMLInputElement).readOnly || (type !== "file" && !visible(element))) continue;
        if (type === "radio" && groups.has(element.name)) continue;
        if (type === "radio") groups.add(element.name);
        const id = `field-${index}`;
        element.setAttribute("data-orch-field", id);
        const radios = type === "radio" ? controls.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === "radio" && item.name === element.name) : [];
        for (const radio of radios) radio.setAttribute("data-orch-field", id);
        const group = element.closest("fieldset, [role=group], [role=radiogroup]");
        const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((ref) => text(document.getElementById(ref))).filter(Boolean).join(" ");
        // A label wrapping its control must not repeat the control's option text.
        const own = [...(element.labels ?? [])].map((label) => { const copy = label.cloneNode(true) as HTMLElement; copy.querySelectorAll("input, select, textarea, button").forEach((node) => node.remove()); return text(copy); }).filter(Boolean).join(" ");
        const legend = text(group?.querySelector("legend, [id$='-label'], h2, h3, label"));
        const nearby = text(element.closest("div")?.parentElement?.querySelector("label, legend, h2, h3, [id$='-label']"));
        // Indeed labels free-text answers "Enter text"; the question itself is the heading or legend above the control.
        // Destructured so the TypeScript loader used by tests does not inject a name helper into browser code.
        const [generic] = [(value: string | null) => value && /^(?:enter text|text eingeben|your answer|ihre antwort|antwort eingeben|type here|hier eingeben|saisir du texte|entrez votre réponse|escribe aquí|inserisci il testo|voer tekst in|digite aqui)$/i.test(value.trim()) ? "" : value ?? ""];
        const label = ((type === "radio" || type === "checkbox") && legend ? legend : labelledBy || own || generic(element.getAttribute("aria-label")) || generic(element.getAttribute("placeholder")) || legend || nearby || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || `Question ${index + 1}`).slice(0, 2000);
        const options = element instanceof HTMLSelectElement ? [...element.options].filter((option) => !option.disabled && option.value !== "").map((option) => ({ value: option.value, label: option.text }))
          : radios.map((radio) => ({ value: radio.value, label: [...(radio.labels ?? [])].map(text).join(" ") || radio.value }));
        const value = type === "file" ? (element as HTMLInputElement).files?.[0]?.name ?? "" : type === "checkbox" ? String((element as HTMLInputElement).checked) : type === "radio" ? radios.find((radio) => radio.checked)?.value ?? "" : element.value;
        const file = type === "file" ? (element as HTMLInputElement).files?.[0] : null;
        const fileHash = file ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("") : undefined;
        const required = element.required || radios.some((radio) => radio.required) || element.getAttribute("aria-required") === "true" || group?.getAttribute("aria-required") === "true" || /\*\s*$|\((?:required|erforderlich|pflichtfeld)\)/i.test(label);
        fields.push({ ...(fileHash ? { fileHash } : {}), id, name: element.name || id, label, type, value, required, options });
      }
      const heading = text(container.querySelector("h1, h2"));
      const notice = [...container.querySelectorAll<HTMLElement>('[role="alert"], [aria-live="assertive"], [id*="error" i], [class*="error" i]')].filter(visible).map((node) => node.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").slice(0, 1500);
      // Indeed's review module renders its summary cards outside <main>, so the whole page is what the person reviews.
      return { fields, heading, notice, title: document.title, reviewText: document.body.innerText.trim().slice(0, 20_000) };
    });
    if (data.fields.length > 100) throw new Error("This form has too many fields for the first version. Apply manually.");
    const review = await this.onReview();
    if (review && this.resumeName && !data.reviewText.includes(this.resumeName)) {
      // Indeed's current review page lists nothing itself; the resume and answers sit behind "Preview what the employer sees".
      if (!this.employerPreview && !this.employerPreviewChecked) {
        this.employerPreviewChecked = true;
        const preview = await this.employerPreviewText();
        if (preview.includes(this.resumeName)) this.employerPreview = preview;
        // Indeed's preview is often a generic sample application, which proves nothing either way.
        else if (preview) console.warn(`Indeed's employer preview does not show the uploaded CV "${this.resumeName}". Preview lines mentioning a file or resume: ${JSON.stringify(preview.split("\n").filter((line) => /\.pdf|resume|lebenslauf|cv\b/i.test(line)).slice(0, 12))}; first lines: ${JSON.stringify(preview.split("\n").filter(Boolean).slice(0, 12))}`);
      }
      if (this.employerPreview) data.reviewText = `${data.reviewText}\n\n[Preview what the employer sees]\n${this.employerPreview}`.slice(0, 20_000);
    }
    // The review page confirms the CV by name, or it lists no resume at all and the upload step showed the file; a different named
    // resume (for example Indeed's own) is never accepted as the tailored CV.
    const mentionsAnyResume = /\.(?:pdf|docx?|rtf|txt)\b|indeed[- ]?(?:resume|lebenslauf)/i.test(data.reviewText);
    const resumeConfirmed = Boolean(this.resumeName && (data.reviewText.includes(this.resumeName) || (this.resumeSeenOnStep && !mentionsAnyResume)));
    const captcha = review && await this.captchaPending();
    const submit = this.submitButton();
    const disabled = review && await submit.count() === 1 && (await submit.first().isDisabled() || await submit.first().getAttribute("aria-disabled") === "true");
    const submissionBlock = captcha ? "captcha" as const : disabled && !data.notice && resumeConfirmed ? "pending" as const : undefined;
    const notice = captcha ? CAPTCHA_NOTICE : data.notice || (disabled ? SUBMISSION_PENDING_NOTICE : "") || (review && !resumeConfirmed ? "Indeed's review page does not confirm the selected tailored CV. Check the resume step before submitting." : "");
    return { fields: data.fields, title: [data.title, data.heading].filter(Boolean).join(" · "), resume: review && !resumeConfirmed ? "" : this.resumeName,
      notice, ...(submissionBlock ? { submissionBlock } : {}), url: this.page.url(), readyToSubmit: review && resumeConfirmed && !notice, ...(review ? { reviewText: data.reviewText } : {}) };
  }
  /** Opens Indeed's employer preview (a dialog, or occasionally a new tab), reads its text and closes it again. */
  private async employerPreviewText() {
    const pattern = /preview what the employer sees|vorschau|aperçu|vista previa|anteprima|voorbeeld|pré-visualiza/i;
    const trigger = this.page.getByRole("button", { name: pattern }).or(this.page.getByRole("link", { name: pattern })).or(this.page.getByText(pattern)).filter({ visible: true }).first();
    if (!await trigger.count()) return "";
    const popupPromise = this.page.context().waitForEvent("page", { timeout: 4_000 }).catch(() => null);
    await trigger.click({ timeout: 5_000 }).catch(() => {});
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await popup.waitForTimeout(1_500);
      const text = await popup.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      await popup.close().catch(() => {});
      return text.trim().slice(0, 20_000);
    }
    const dialog = this.page.locator('[role="dialog"], [aria-modal="true"]').filter({ visible: true }).first();
    await dialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    await this.page.waitForTimeout(1_500);
    const text = await (await dialog.count() ? dialog : this.page.locator("body")).innerText({ timeout: 5_000 }).catch(() => "");
    const close = dialog.getByRole("button", { name: /close|schließen|zurück|back|fermer|retour|cerrar|volver|chiudi|indietro|sluiten|terug|fechar|voltar/i }).first();
    if (await close.count()) await close.click({ timeout: 3_000 }).catch(() => {});
    else await this.page.keyboard.press("Escape").catch(() => {});
    await this.settle();
    return text.trim().slice(0, 20_000);
  }
  private continueButton() {
    return this.page.getByRole("button", { name: CONTINUE_LABEL }).filter({ visible: true });
  }
  /** Clicks Continue once and reports whether Indeed moved to another step without a validation message. */
  private async advance() {
    const button = this.continueButton();
    if (await button.count() !== 1 || await this.onReview()) return false;
    const before = await this.page.evaluate(() => `${location.href}\n${document.querySelector("main h1, main h2, h1, h2")?.textContent ?? ""}`);
    await button.first().click({ timeout: 10_000 });
    await this.page.waitForFunction((previous) => `${location.href}\n${document.querySelector("main h1, main h2, h1, h2")?.textContent ?? ""}` !== previous || Boolean(document.querySelector('[role="alert"], [aria-live="assertive"]')?.textContent?.trim()), before, { timeout: 15_000 }).catch(() => {});
    await this.settle();
    this.assertDestination();
    const after = await this.page.evaluate(() => `${location.href}\n${document.querySelector("main h1, main h2, h1, h2")?.textContent ?? ""}`);
    return after !== before;
  }
  private async uploadResume(pdf: Uint8Array, filename: string) {
    // The resume module first shows a spinner while it loads the account's saved resumes; its controls appear afterwards.
    await this.waitForSpinners(20_000);
    // The current resume module keeps an unlabelled file input hidden behind a saved-CV card.
    // Select that card, then target its explicit resume input rather than an arbitrary upload.
    const resumeCard = this.page.getByTestId("resume-selection-file-resume-radio-card-input");
    if (await resumeCard.count() === 1 && !await resumeCard.isChecked()) {
      const cardLabel = this.page.getByTestId("resume-selection-file-resume-radio-card-label");
      if (await cardLabel.isVisible()) await cardLabel.click();
      else await resumeCard.check();
      if (!await resumeCard.isChecked()) throw new Error("Indeed did not select the file-resume option.");
      await this.settle();
    }
    const file = this.page.locator('input[type="file"]');
    const currentResumeInput = this.page.getByTestId("resume-selection-file-resume-radio-card-file-input");
    if (!await currentResumeInput.count() && (!await file.count() || !await file.first().isVisible())) {
      // A saved Indeed Resume hides the upload control behind an "upload" choice.
      for (const reveal of [this.page.getByRole("radio", { name: /upload|hochladen|importer|télécharger|subir|cargar|carica|uploaden|carregar/i }), this.page.getByRole("button", { name: /upload|hochladen|replace|different file|andere datei|importer|télécharger|remplacer|subir|cargar|reemplazar|carica|sostituisci|uploaden|vervangen|carregar|substituir/i }), this.page.getByText(/upload (?:a |your )?(?:resume|cv)|lebenslauf hochladen|importer (?:un |votre |mon )?cv|télécharger (?:un |votre |mon )?cv|subir (?:un |tu |mi )?(?:cv|currículum)|carica (?:il (?:tuo )?)?cv|cv uploaden|carregar (?:o (?:seu |meu )?)?(?:cv|currículo)/i)]) {
        if (await reveal.count()) { await reveal.first().click({ timeout: 5_000 }).catch(() => {}); await this.settle(); break; }
      }
    }
    if (!await file.count()) {
      const capture = await this.capture("resume-upload-missing");
      console.warn(`Indeed resume step (${this.page.url()}): no file input found; the tailored CV was not uploaded.${capture ? ` Page saved to ${capture}` : ""}`);
      return false;
    }
    const candidates = await file.evaluateAll(elements => elements.map((element, index) => {
      const input = element as HTMLInputElement;
      const label = [...(input.labels ?? [])].map(item => item.textContent ?? "").join(" ");
      return { index, resume: input.getAttribute("data-testid") === "resume-selection-file-resume-radio-card-file-input" || /\b(?:resume|cv|lebenslauf)\b/i.test(`${label} ${input.name} ${input.getAttribute("aria-label") ?? ""}`) };
    }).filter(item => item.resume));
    if (candidates.length !== 1) { console.warn(`Indeed resume step (${this.page.url()}): ${candidates.length} resume upload controls among ${await file.count()} file inputs; the tailored CV was not uploaded.`); return false; }
    const resumeInput = file.nth(candidates[0].index);
    // Upload ONLY the selected, audited tailored CV. No arbitrary file paths.
    await resumeInput.setInputFiles({ name: filename, mimeType: "application/pdf", buffer: Buffer.from(pdf) });
    try {
      // A hidden duplicate must not mask the visible uploaded-file receipt.
      await this.page.getByText(filename, { exact: false }).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      const detail = await this.page.locator('[role="alert"], [aria-live="assertive"]').allTextContents().catch(() => []);
      throw new Error(`Indeed did not confirm the tailored CV upload (${filename}).${detail.join(" ").trim() ? ` ${detail.join(" ").trim().slice(0, 400)}` : " The application remains unsubmitted; inspect the resume step."}`);
    }
    await this.settle();
    this.resumeName = filename;
    this.resumeSeenOnStep = true;
    return true;
  }
  async fillProfile(profile: ApplicantProfile, pdf: Uint8Array, filename: string) {
    this.prepared = { profile, pdf, filename };
    for (let step = 0; step < MAX_STEPS; step++) {
      this.assertDestination();
      if (await this.onReview()) break;
      const emailFields = await this.page.locator("input").evaluateAll(elements => elements.map(element => element as HTMLInputElement).filter(element => element.getClientRects().length > 0 && (
        element.type === "email" || /^(?:email|e-mail)(?: address)?$/i.test([...(element.labels ?? [])].map(label => label.textContent?.replace(/\*/g, "").trim()).join(" "))
      )).map(element => element.value.trim()).filter(Boolean));
      if (emailFields.some(email => email.toLowerCase() !== profile.email.toLowerCase())) throw new Error("Indeed's contact email differs from the applicant email. Confirm the correct account and contact details before uploading a CV.");
      const snapshot = await this.snapshot();
      const answers: Record<string, string> = {};
      for (const field of snapshot.fields) {
        if (field.value || !["text", "email", "tel", "url"].includes(field.type)) continue;
        const answer = profileAnswer(field.label, profile);
        if (answer) answers[field.id] = answer;
      }
      if (Object.keys(answers).length) await this.writeAnswers(answers);
      if (!this.resumeName) await this.uploadResume(pdf, filename);
      const current = await this.snapshot();
      if (missingRequired(current.fields).length) break;
      if (this.pauseForQuestions && this.answeredStep !== `${current.url}\n${current.title}` && current.fields.some(field => !field.value && ["text", "textarea", "email", "tel", "url", "number", "date", "select", "radio"].includes(field.type))) break;
      if (!await this.advance()) break;
    }
  }
  private async writeAnswers(answers: Record<string, string>) {
    const snapshot = await this.snapshot();
    for (const [id, answer] of Object.entries(answers)) {
      const field = snapshot.fields.find((item) => item.id === id);
      if (!field || field.type === "file") throw new Error("The form changed. Refresh it before entering answers.");
      const control = this.page.locator(`[data-orch-field="${field.id}"]`);
      if (field.type === "checkbox") await control.setChecked(answer === "true");
      else if (field.type === "radio") {
        const index = field.options.findIndex((option) => option.value === answer);
        if (index < 0) { if (!answer) continue; throw new Error("Choose an available answer."); }
        await control.nth(index).check({ force: true });
      } else if (field.type === "select") await control.selectOption(answer);
      else await control.fill(answer);
    }
  }
  /** Applies edited answers, then moves through fully answered steps until Indeed needs the person or shows the review. */
  async fillAnswers(answers: Record<string, string>) {
    const step = await this.snapshot();
    await this.writeAnswers(answers);
    this.answeredStep = `${step.url}\n${step.title}`;
    if (this.prepared) {
      const { profile, pdf, filename } = this.prepared;
      await this.fillProfile(profile, pdf, filename);
      return;
    }
    for (let step = 0; step < MAX_STEPS; step++) {
      if (await this.onReview() || missingRequired((await this.snapshot()).fields).length) break;
      if (!await this.advance()) break;
    }
  }
  async validateForSubmission(expected: ApplicationSnapshot) {
    const current = await this.snapshot();
    if (!isDeepStrictEqual(current.fields, expected.fields) || current.resume !== expected.resume || current.title !== expected.title || current.url !== expected.url || current.reviewText !== expected.reviewText) return { ok: false as const, snapshot: current, message: "The browser form changed. Review the updated answers before submitting." };
    if (current.notice) return { ok: false as const, snapshot: current, message: current.notice };
    if (!current.resume) return { ok: false as const, snapshot: current, message: "The tailored CV was not uploaded. Choose the upload option on Indeed's resume step, then refresh from the browser." };
    if (missingRequired(current.fields).length) return { ok: false as const, snapshot: current, message: "Complete the required fields before submitting." };
    if (await this.submitButton().count() !== 1) return { ok: false as const, snapshot: current, message: "Indeed has not reached the review step yet. Save answers to continue, or finish the remaining steps in the visible browser and refresh." };
    return { ok: true as const, snapshot: current };
  }
  async saveDraft(): Promise<{ saved: true; draft: IndeedDraft } | { saved: false; attempted: boolean; message: string }> {
    if (this.submissionAttempted || this.submissionDispatched || this.submissionAllowed) throw new Error("Check the submission outcome before saving a draft.");
    if (this.draftSaveAttempted) return { saved: false, attempted: true, message: "Draft saving was already attempted. Check My jobs on Indeed before continuing." };
    this.assertDestination();
    const triggerName = /^(?:save and close|speichern und schließen|enregistrer et fermer|guardar y cerrar|salva e chiudi|opslaan en sluiten|salvar e fechar|guardar e fechar)$/i;
    const trigger = this.page.getByRole("button", { name: triggerName }).or(this.page.getByRole("link", { name: triggerName })).filter({ visible: true });
    const saveName = /^(?:save|speichern|enregistrer|guardar|salva|opslaan|salvar)$/i;
    const dialog = this.page.getByRole("dialog").filter({ visible: true }).filter({ has: this.page.getByRole("button", { name: saveName }) });
    if (!await dialog.count() && await trigger.count() !== 1) return { saved: false, attempted: false, message: "Indeed does not offer Save and close on this step. The application remains open; no Indeed draft save was confirmed." };
    try {
      if (!await dialog.count()) await trigger.click();
      const save = dialog.getByRole("button", { name: saveName });
      await save.waitFor({ state: "visible", timeout: 5_000 });
      if (await save.count() !== 1) throw new Error("Could not identify the draft Save button.");
      this.draftSaveAttempted = true;
      // The submission guard stays on. Only the explicit save control is clicked.
      await save.click();
      const confirmation = this.page.getByText(/^(?:your )?application (?:has been |was )?saved[.!]?$|^(?:ihre )?bewerbung (?:wurde )?gespeichert[.!]?$|^(?:votre )?candidature (?:a été )?enregistrée[.!]?$|^(?:tu )?(?:solicitud|candidatura) (?:ha sido )?guardada[.!]?$|^(?:la (?:tua )?)?candidatura (?:è stata )?salvata[.!]?$|^(?:je |uw )?sollicitatie (?:is )?opgeslagen[.!]?$|^(?:a (?:sua )?)?candidatura (?:foi )?(?:salva|guardada)[.!]?$/i).filter({ visible: true });
      await confirmation.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      let evidence = this.allowsNavigation(this.page.url()) ? await confirmation.first().innerText({ timeout: 500 }).catch(() => "") : "";
      // Indeed usually answers the save with a redirect and no receipt. The posting page is the proof: it now offers
      // "Continue application" for a started application, on any country site. My jobs cannot be used for this because it
      // lists drafts only for the account's own country.
      if (!evidence) {
        const posting = await this.page.context().newPage();
        try { evidence = await verifyIndeedDraft(posting, this.url) ?? ""; }
        finally { await posting.close().catch(() => {}); }
      }
      if (evidence) return { saved: true, draft: { savedAt: new Date().toISOString(), continueUrl: this.url, evidence } };
      const alerts = (await this.page.locator('[role="alert"], [role="dialog"]').filter({ visible: true }).allTextContents().catch(() => [])).join(" ").trim().slice(0, 500);
      return { saved: false, attempted: true, message: `Save was clicked, but the posting does not show Continue application yet.${alerts ? ` Indeed says: ${alerts}` : ""} Open the posting on Indeed to check before retrying. Nothing was submitted by this save action.` };
    } catch {
      return { saved: false, attempted: this.draftSaveAttempted, message: this.draftSaveAttempted ? "Indeed's draft save outcome could not be confirmed. Open the posting on Indeed to check before retrying." : "Indeed's Save dialog could not be used. The browser remains open; no draft save was confirmed." };
    }
  }
  /** Re-checks the posting after an unconfirmed save, for the worker's later ticks. */
  async verifyDraft(): Promise<IndeedDraft | null> {
    const posting = await this.page.context().newPage();
    try {
      const evidence = await verifyIndeedDraft(posting, this.url, 1);
      return evidence ? { savedAt: new Date().toISOString(), continueUrl: this.url, evidence } : null;
    } finally { await posting.close().catch(() => {}); }
  }
  /** What the page shows right now: for judging a submission that produced no confirmation. */
  private async pageDetail() {
    const state = await this.page.evaluate(() => ({
      alerts: [...document.querySelectorAll<HTMLElement>('[role="alert"], [aria-live="assertive"], [aria-live="polite"], [id*="error" i], [class*="error" i]')].filter((node) => node.getClientRects().length).map((node) => node.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5),
      dialog: [...document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]')].filter((node) => node.getClientRects().length).map((node) => node.innerText.replace(/\s+/g, " ").trim().slice(0, 300)).slice(0, 2),
      lines: document.body.innerText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 25),
    })).catch(() => ({ alerts: [], dialog: [], lines: [] }));
    return `page ${this.page.url()} · title "${await this.page.title().catch(() => "")}"${state.alerts.length ? ` · alerts: ${JSON.stringify(state.alerts)}` : ""}${state.dialog.length ? ` · dialog: ${JSON.stringify(state.dialog)}` : ""} · requests: ${JSON.stringify(this.submissionRequests)} · text: ${JSON.stringify(state.lines.join(" | ").slice(0, 900))}`;
  }
  async submitOnce(timeoutMs = 20_000): Promise<{ confirmation: string | null; dispatched: boolean; detail?: string }> {
    if (this.draftSaveAttempted) throw new Error("Draft saving was already attempted. Continue from My jobs on Indeed.");
    if (this.submissionAttempted) throw new Error("Submission was already attempted. Check the outcome; it will not be retried.");
    this.assertDestination();
    const button = this.submitButton();
    if (await button.count() !== 1) throw new Error("Could not identify a single submit button. No automatic retry will be made.");
    const current = await this.snapshot();
    if (!current.readyToSubmit || missingRequired(current.fields).length) throw new Error("The final review must confirm the tailored CV and all required answers before submission.");
    this.submissionAttempted = true;
    this.submissionAllowed = true;
    this.submissionDispatched = false;
    this.submissionRequests = [];
    await this.page.evaluate(() => { Object.assign(window, { __orchSubmitAllowed: true }); });
    try {
      // One click only. A timeout after this point is an uncertain submission.
      try { await button.first().click({ timeout: 10_000 }); }
      catch (error) { return { confirmation: null, dispatched: this.submissionDispatched, detail: `the submit click failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"} · ${await this.pageDetail()}` }; }
      await this.page.waitForFunction((pattern) => new RegExp(pattern, "i").test(document.body.innerText) || /post-apply|confirmation|success/.test(location.pathname), CONFIRMATION.source, { timeout: timeoutMs });
      if (!this.allowsNavigation(this.page.url())) return { confirmation: null, dispatched: this.submissionDispatched, detail: await this.pageDetail() };
      const confirmation = await this.page.locator("body").innerText().then((text) => text.match(new RegExp(`[^\\n]*(?:${CONFIRMATION.source})[^\\n]*`, "i"))?.[0]?.trim().slice(0, 1000) ?? null);
      return { confirmation: this.submissionDispatched ? confirmation : null, dispatched: this.submissionDispatched, ...(confirmation ? {} : { detail: await this.pageDetail() }) };
    } catch { return { confirmation: null, dispatched: this.submissionDispatched, detail: `no confirmation within ${Math.round(timeoutMs / 1000)}s · ${await this.pageDetail()}` }; }
    finally {
      this.submissionAllowed = false;
      // A click that sent no request (for example Indeed demanding its CAPTCHA first) is not a submission; a later attempt stays allowed.
      if (!this.submissionDispatched) this.submissionAttempted = false;
      await this.page.evaluate(() => { Object.assign(window, { __orchSubmitAllowed: false }); }).catch(() => {});
    }
  }
}
