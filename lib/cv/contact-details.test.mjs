import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySavedContactDetails } from './contact-details.ts';

const base = { name: 'Daniel Varga', contactLine: [{ text: 'linkedin.com/in/danielvarga', url: 'https://linkedin.com/in/danielvarga' }], skills: [], experience: [], projects: [], education: [] };

test('the saved email leads the contact line and replaces any address the model copied from the source CV', () => {
  const withEmail = applySavedContactDetails(base, { email: 'edgeai_test@proton.me' });
  assert.deepEqual(withEmail.contactLine.map((item) => item.text), ['edgeai_test@proton.me', 'linkedin.com/in/danielvarga']);
  assert.equal(withEmail.contactLine[0].url, 'mailto:edgeai_test@proton.me');
  const placeholder = { ...base, contactLine: [{ text: 'daniel.varga@example.com', url: 'mailto:daniel.varga@example.com' }, ...base.contactLine] };
  assert.deepEqual(applySavedContactDetails(placeholder, { email: 'edgeai_test@proton.me' }).contactLine.map((item) => item.text), ['edgeai_test@proton.me', 'linkedin.com/in/danielvarga']);
});

test('without a valid saved email the content is left untouched', () => {
  assert.deepEqual(applySavedContactDetails(base, {}), base);
  assert.deepEqual(applySavedContactDetails(base, { email: 'not-an-email' }), base);
});

test('duplicate contacts are kept once and a phone number is never a link target', () => {
  const messy = { ...base, contactLine: [
    { text: 'linkedin.com/in/danielvarga', url: 'https://linkedin.com/in/danielvarga' }, { text: '+44 7700 900741' }, { text: 'Vienna, Austria' },
    { text: '+44 7700 900741', url: '+44 7700 900741' }, { text: 'www.linkedin.com/in/danielvarga/', url: 'https://linkedin.com/in/danielvarga' }, { text: ' ' },
  ] };
  const tidy = applySavedContactDetails(messy, { email: 'edgeai_test@proton.me' }).contactLine;
  assert.deepEqual(tidy, [{ text: 'edgeai_test@proton.me', url: 'mailto:edgeai_test@proton.me' }, { text: 'linkedin.com/in/danielvarga', url: 'https://linkedin.com/in/danielvarga' }, { text: '+44 7700 900741' }, { text: 'Vienna, Austria' }]);
  assert.deepEqual(applySavedContactDetails(messy, {}).contactLine.length, 3, 'tidying applies even without a saved email');
});
