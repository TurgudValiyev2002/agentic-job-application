export const target = 'https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111/apply';
export const html = `<!doctype html><html><head><title>Example — Software Developer</title></head><body><h1>Software Developer at Example</h1>
<form id="application-form" method="post" enctype="multipart/form-data">
<div class="application-question"><label class="application-label" for="name">Full name *</label><input id="name" name="name" required></div>
<div class="application-question"><label class="application-label" for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div class="application-question"><label for="phone">Phone</label><input id="phone" name="phone" type="tel"></div>
<div class="application-question"><label for="resume">Resume *</label><input id="resume" name="resume" type="file" required></div>
<div class="application-question"><label class="application-label" for="sponsor">Do you need visa sponsorship? *</label><select id="sponsor" name="cards[sponsor]" required><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></div>
<div class="application-question"><label class="application-label" for="experience">Describe your relevant experience *</label><textarea id="experience" name="cards[experience]" required></textarea></div>
<fieldset><legend>Availability *</legend><label><input type="radio" name="available" value="now" required>Now</label><label><input type="radio" name="available" value="later">Later</label></fieldset>
<label><input type="checkbox" name="consent" required>I consent to submitting my data</label>
<button type="submit" style="display:none">Hidden control</button><button id="btn-submit" type="button" onclick="this.form.requestSubmit()">Submit application</button></form></body></html>`;
export const profile = { name: 'Alex Example', email: 'alex@example.test', phone: '+1 555 0100', location: '', currentCompany: '', linkedin: '', github: '', portfolio: '' };
export function completeAnswers(snapshot) {
  return Object.fromEntries(snapshot.fields.filter(f => ['cards[sponsor]', 'cards[experience]', 'available', 'consent'].includes(f.name)).map(f => [f.id, ({ 'cards[sponsor]': 'yes', 'cards[experience]': 'I built Python services.', available: 'later', consent: 'true' })[f.name]]));
}
