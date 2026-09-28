export const posting = 'https://de.indeed.com/viewjob?jk=6a19fac52b8fdc97';
export const formOrigin = 'https://smartapply.indeed.com';
export const firstStep = `${formOrigin}/beta/indeedapply/form/contact-info`;
// Current posting pages keep the view-job model under `_initialData.viewJobClientSideModel` and render the apply control
// client-side: a SmartApply anchor for Indeed Apply, or a "continue to application" button for company-site postings.
// `legacy` reproduces the older layout (top-level model keys and the #indeedApplyButton element).
// `started` reproduces a posting with a saved (unfinished) application: Indeed relabels the apply control "Continue application".
export const postingHtml = (loggedIn, withButton = true, { legacy = false, renderDelayMs = 0, started = false } = {}) => {
  const model = `{loggedIn:${loggedIn},indeedApplyButtonContainer:${withButton ? '{}' : 'null'}}`;
  const control = legacy
    ? (withButton ? `<button id="indeedApplyButton" onclick="location.href='${firstStep}'">Apply now</button>` : '<button>Apply on company site</button>')
    : (withButton ? `<a data-testid="viewjob-indeed-apply" href="${firstStep}" rel="nofollow">${started ? 'Continue application' : 'Jetzt bewerben'}</a>` : '<button data-testid="viewjob-apply" type="button">Weiter zur Bewerbung</button>');
  return `<!doctype html><html><head><title>Backend Engineer - Example - Indeed.com</title></head><body>
<script>window._initialData=${legacy ? model : `{viewJobClientSideModel:${model}}`}</script>
<h1>Backend Engineer</h1><a href="https://secure.indeed.com/auth">Sign in</a>
<div data-testid="job-header-actions"><div data-testid="primary-apply-action"></div>${started ? '<p>You started this application today</p>' : ''}</div>
<script>setTimeout(() => { document.querySelector('[data-testid="primary-apply-action"]').innerHTML = ${JSON.stringify(control)}; }, ${renderDelayMs});</script></body></html>`;
};
// One synthetic multi-step Indeed Apply form: contact → resume → employer questions → review → confirmation.
export const formHtml = `<!doctype html><html><head><title>Indeed Apply — Example</title></head><body><main id="app"></main>
<script>
const steps = {
  '/beta/indeedapply/form/contact-info': '<h1>Add your contact information</h1><form id="f"><label>First name *<input name="firstName" required></label><label>Last name *<input name="lastName" required></label><label>Email<input name="email" value="alex@example.test" readonly></label><label>Phone number<input name="phone" type="tel"></label><label>City<input name="city"></label><label>Do you need visa sponsorship?<input name="trap"></label><button type="submit">Continue</button></form>',
  '/beta/indeedapply/form/resume': '<h1>Add a resume</h1><form id="f"><fieldset><legend>Resume *</legend><label><input type="radio" name="resumeChoice" value="indeed" checked>Indeed Resume</label><label><input type="radio" name="resumeChoice" value="upload">Upload a resume</label></fieldset><div id="uploadBox" hidden><label>Resume file<input type="file" name="resume" required></label><p id="fileName"></p></div><button type="submit">Continue</button></form>',
  '/beta/indeedapply/form/questions': '<h1>Answer employer questions</h1><form id="f"><label>Do you need visa sponsorship? *<select name="sponsor" required><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>Describe your relevant experience *<textarea name="experience" required></textarea></label><div role="alert" id="err"></div><button type="submit">Continue</button></form>',
  '/beta/indeedapply/form/review': '<h1>Review your application</h1><form id="f"><p>Resume: <span id="reviewResume"></span></p><button type="submit">Submit your application</button></form>',
};
const order = Object.keys(steps);
const state = { file: '' };
function render() {
  const path = location.pathname;
  document.getElementById('app').innerHTML = steps[path] ?? '<h1>Unknown step</h1>';
  const form = document.getElementById('f'); if (!form) return;
  if (path.endsWith('/resume')) {
    const box = document.getElementById('uploadBox'); const file = form.querySelector('input[type=file]');
    for (const radio of form.querySelectorAll('input[name=resumeChoice]')) radio.addEventListener('change', () => { box.hidden = form.resumeChoice.value !== 'upload'; });
    file.addEventListener('change', () => { state.file = file.files[0]?.name ?? ''; document.getElementById('fileName').textContent = state.file; });
  }
  if (path.endsWith('/review')) document.getElementById('reviewResume').textContent = state.file || 'Indeed Resume';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (path.endsWith('/review')) {
      const response = await fetch('/api/submit', { method: 'POST', body: '{}' });
      document.getElementById('app').innerHTML = response.ok ? '<h1>Your application has been submitted</h1><p>The employer will contact you.</p>' : '<h1>Something went wrong</h1>';
      return;
    }
    if (path.endsWith('/resume') && form.resumeChoice.value === 'upload' && !state.file) return;
    if (!form.checkValidity()) { const err = document.getElementById('err'); if (err) err.textContent = 'Answer the required questions.'; return; }
    history.pushState(null, '', order[order.indexOf(path) + 1]); render();
  });
}
window.addEventListener('popstate', render); render();
</script></body></html>`;
export const profile = { name: 'Alex Example', email: 'alex@example.test', phone: '+49 30 0000', location: 'Berlin', currentCompany: '', linkedin: '', github: '', portfolio: '' };
export function completeAnswers(snapshot) {
  return Object.fromEntries(snapshot.fields.filter((f) => ['sponsor', 'experience'].includes(f.name)).map((f) => [f.id, ({ sponsor: 'yes', experience: 'I built Python services.' })[f.name]]));
}

// Draft-only controls are opt-in: some Indeed application steps do not offer them.
export function withDraftSaving(html = formHtml, { confirm = true } = {}) {
  return html.replace('</body>', `<button type="button" id="saveClose">Save and close</button>
<dialog id="saveDialog"><h2>Save your application?</h2><button type="button" id="saveDraft">Save</button><button type="button" onclick="document.getElementById('saveDialog').close()">Cancel</button></dialog>
<script>
const draftAnswers = {};
document.addEventListener('input', e => { if(e.target.name && e.target.type !== 'file') draftAnswers[e.target.name] = e.target.value; });
document.getElementById('saveClose').onclick = () => document.getElementById('saveDialog').showModal();
document.getElementById('saveDraft').onclick = async () => {
 const response = await fetch('/api/draft', {method:'POST', body:JSON.stringify({resume:state.file,answers:draftAnswers})});
 if(response.ok && ${confirm}) document.body.innerHTML = '<h1>Your application has been saved</h1><a href="https://myjobs.indeed.com/">My jobs</a>';
 else document.getElementById('saveDialog').close();
};
</script></body>`);
}
