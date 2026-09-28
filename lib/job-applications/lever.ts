import { isDeepStrictEqual } from "node:util";
import type { Page } from "playwright";
import type { ApplicationAdapter } from "./adapter";
import { leverApplicationUrl } from "./urls";
import { missingRequired, type ApplicantProfile, type ApplicationField, type ApplicationSnapshot } from "./types";

export class LeverBrowser implements ApplicationAdapter {
  private submissionAllowed = false;
  private submissionDispatched = false;
  constructor(public page: Page, public url: string) {}
  allowsNavigation(url: string) {
    try { return new URL(url).origin === new URL(this.url).origin; } catch { return false; }
  }
  async open() {
    await this.page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && leverApplicationUrl(request.url()) === this.url) {
        if (!this.submissionAllowed || this.submissionDispatched) return route.abort();
        this.submissionDispatched = true;
      }
      return route.fallback();
    });
    await this.page.addInitScript(() => {
      // Enter and the employer's button must not submit during preparation/review.
      Object.assign(window, { __orchSubmitAllowed: false });
      document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("button, input[type=submit]") : null;
        if (target && (target.id === "btn-submit" || target.getAttribute("type") === "submit") && !(window as unknown as { __orchSubmitAllowed: boolean }).__orchSubmitAllowed) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      }, true);
      document.addEventListener("submit", (event) => {
        if (!(window as unknown as { __orchSubmitAllowed: boolean }).__orchSubmitAllowed) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
    });
    await this.page.goto(this.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await this.page.locator('input[name="resume"]').waitFor({ state: "attached", timeout: 15_000 });
    this.assertDestination();
  }
  assertDestination() {
    if (leverApplicationUrl(this.page.url()) !== this.url) throw new Error("The browser left the selected Lever application. Preparation stopped.");
  }
  async snapshot(): Promise<ApplicationSnapshot> {
    this.assertDestination();
    const data = await this.page.evaluate(async () => {
      const upload = document.querySelector<HTMLInputElement>('input[name="resume"]');
      const form = upload?.form;
      if (!form) throw new Error("The Lever application form is unavailable. Check the browser for an expired job or challenge.");
      const controls = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")];
      const fields: ApplicationField[] = [];
      const groups = new Set<string>();
      for (const [index, element] of controls.entries()) {
        const type = element instanceof HTMLTextAreaElement ? "textarea" : element instanceof HTMLSelectElement ? "select" : element.type;
        if (["hidden", "submit", "button", "reset", "password"].includes(type) || element.disabled || (type !== "file" && !element.getClientRects().length)) continue;
        if (type === "radio" && groups.has(element.name)) continue;
        if (type === "radio") groups.add(element.name);
        const id = `field-${index}`;
        element.setAttribute("data-orch-field", id);
        const container = element.closest(".application-question, fieldset") ?? element.closest(".application-field");
        const heading = container?.querySelector(".application-label, legend");
        const labels = [...(element.labels ?? [])].map((label) => label.textContent?.trim()).filter(Boolean).join(" ");
        const label = (heading?.textContent?.trim() || labels || element.getAttribute("aria-label") || element.name || `Question ${index + 1}`).slice(0, 2000);
        const radios = type === "radio" ? controls.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === "radio" && item.name === element.name) : [];
        for (const radio of radios) radio.setAttribute("data-orch-field", id);
        const options = element instanceof HTMLSelectElement ? [...element.options].filter((option) => !option.disabled).map((option) => ({ value: option.value, label: option.text })) : radios.map((radio) => ({ value: radio.value, label: [...(radio.labels ?? [])].map((label) => label.textContent?.trim()).join(" ") || radio.value }));
        const value = type === "file" ? (element as HTMLInputElement).files?.[0]?.name ?? "" : type === "checkbox" ? String((element as HTMLInputElement).checked) : type === "radio" ? radios.find((radio) => radio.checked)?.value ?? "" : element.value;
        const file = type === "file" ? (element as HTMLInputElement).files?.[0] : null;
        const fileHash = file ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("") : undefined;
        fields.push({ ...(fileHash ? { fileHash } : {}), id, name: element.name, label, type, value, required: element.required || radios.some((radio) => radio.required) || element.getAttribute("aria-required") === "true" || Boolean(heading?.querySelector(".required")) || /\*\s*$/.test(heading?.textContent ?? ""), options });
      }
      const error = [...form.querySelectorAll<HTMLElement>('.error, .error-message, [role="alert"]')].filter((node) => node.getClientRects().length).map((node) => node.innerText).filter(Boolean).join(" ").slice(0, 1500);
      return { fields, title: document.title, resume: upload?.files?.[0]?.name ?? "", notice: error };
    });
    if (data.fields.length > 100) throw new Error("This form has too many fields for the first version. Apply manually.");
    return { ...data, url: this.page.url() };
  }
  async fillProfile(profile: ApplicantProfile, pdf: Uint8Array, filename: string) {
    this.assertDestination();
    const snapshot = await this.snapshot();
    const standard: Record<string, string> = { name: profile.name, email: profile.email, phone: profile.phone, org: profile.currentCompany, location: profile.location, "urls[LinkedIn]": profile.linkedin, "urls[GitHub]": profile.github, "urls[Portfolio]": profile.portfolio };
    const answers: Record<string, string> = {};
    for (const field of snapshot.fields) {
      const answer = standard[field.name];
      if (answer && ["text", "email", "tel", "url"].includes(field.type)) answers[field.id] = answer;
    }
    await this.fillAnswers(answers);
    // Upload ONLY the selected, audited tailored CV. No arbitrary file paths.
    await this.page.locator('input[name="resume"]').setInputFiles({ name: filename, mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  }
  async fillAnswers(answers: Record<string, string>) {
    const snapshot = await this.snapshot();
    for (const [id, answer] of Object.entries(answers)) {
      const field = snapshot.fields.find((item) => item.id === id);
      if (!field || field.type === "file") throw new Error("The form changed. Refresh it before entering answers.");
      const control = this.page.locator(`[data-orch-field="${field.id}"]`);
      if (field.type === "checkbox") await control.setChecked(answer === "true");
      else if (field.type === "radio") {
        const index = field.options.findIndex((option) => option.value === answer);
        if (index < 0) { if (!answer) continue; throw new Error("Choose an available answer."); }
        await control.nth(index).check();
      } else if (field.type === "select") await control.selectOption(answer);
      else await control.fill(answer);
    }
  }
  async validateForSubmission(expected: ApplicationSnapshot) {
    const current = await this.snapshot();
    if (!isDeepStrictEqual(current.fields, expected.fields) || current.resume !== expected.resume || current.title !== expected.title) return { ok: false as const, snapshot: current, message: "The browser form changed. Review the updated answers before submitting." };
    if (missingRequired(current.fields).length || !current.resume) return { ok: false as const, snapshot: current, message: "Complete the required fields before submitting." };
    const valid = await this.page.locator('input[name="resume"]').evaluate((input: HTMLInputElement) => input.form?.reportValidity() ?? false);
    if (!valid) return { ok: false as const, snapshot: current, message: "The employer form has invalid or missing answers. Check the visible browser." };
    return { ok: true as const, snapshot: current };
  }
  async submitOnce(timeoutMs = 20_000): Promise<{ confirmation: string | null; dispatched: boolean }> {
    this.assertDestination();
    const form = this.page.locator("form").filter({ has: this.page.locator('input[name="resume"]') });
    const namedButton = this.page.getByRole("button", { name: /^submit application$/i });
    const button = await namedButton.count() === 1 ? namedButton : form.locator('button[type="submit"]:visible, input[type="submit"]:visible');
    if (await button.count() !== 1) throw new Error("Could not identify a single submit button. No automatic retry will be made.");
    this.submissionAllowed = true;
    this.submissionDispatched = false;
    await this.page.evaluate(() => { Object.assign(window, { __orchSubmitAllowed: true }); });
    try {
      // One click only. A timeout after this point is an uncertain submission.
      await button.click({ timeout: 10_000 });
      await this.page.waitForFunction(() => {
        const form = document.querySelector<HTMLInputElement>('input[name="resume"]')?.form;
        const text = document.body.innerText;
        return (!form || !form.getClientRects().length) && /thank you for applying|application (?:has been |was )?(?:submitted|received)|thanks for applying/i.test(text);
      }, { }, { timeout: timeoutMs });
      if (new URL(this.page.url()).origin !== new URL(this.url).origin) return { confirmation: null, dispatched: this.submissionDispatched };
      const confirmation = await this.page.locator("body").innerText().then((text) => text.match(/[^\n]*(?:thank you for applying|application (?:has been |was )?(?:submitted|received)|thanks for applying)[^\n]*/i)?.[0]?.trim().slice(0, 1000) ?? null);
      return { confirmation: this.submissionDispatched ? confirmation : null, dispatched: this.submissionDispatched };
    } catch { return { confirmation: null, dispatched: this.submissionDispatched }; }
    finally { this.submissionAllowed = false; await this.page.evaluate(() => { Object.assign(window, { __orchSubmitAllowed: false }); }).catch(() => {}); }
  }
}
