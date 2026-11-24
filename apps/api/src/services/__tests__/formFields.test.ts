import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureFieldKeys,
  fieldIdError,
  findFieldById,
  findFieldByKey,
  formatPhoneUS,
  normalizePhone,
  updateFieldByKey,
  validateDate,
  validateEmail,
  validateNumber,
  validatePhone,
  validateUrl,
  instantiatePreset,
  FIELD_PRESETS,
  type FormField,
} from '@allebrum/shared';

function field(partial: Partial<FormField> & Pick<FormField, 'id' | 'label' | 'type'>): FormField {
  return {
    required: false,
    placeholder: '',
    helpText: '',
    autocomplete: '',
    options: [],
    validation: {},
    showWhen: [],
    requiredWhen: [],
    ...partial,
  };
}

test('selecting by field.id loses the field as soon as the id changes (the focus bug)', () => {
  const fields = ensureFieldKeys([
    field({ id: 'full_name', key: 'k1', label: 'Full name', type: 'text' }),
    field({ id: 'pho', key: 'k2', label: 'Phone Number', type: 'phone' }),
  ]);
  const selectedId = 'pho';
  const after = updateFieldByKey(fields, 'k2', (f) => ({ ...f, id: 'phon' }));
  // Old lookup (what the builder used): the selected id is gone, so the UI
  // falls back to the first field — focus is lost and the panel "resets".
  assert.equal(findFieldById(after, selectedId), undefined);
  assert.equal(findFieldById(after, selectedId) ?? after[0]?.id, 'full_name');
  // New lookup (stable key): the same field stays selected while its id is edited.
  assert.equal(findFieldByKey(after, 'k2')?.id, 'phon');
  assert.equal(findFieldByKey(after, 'k2')?.label, 'Phone Number');
});

test('changing a field id remaps show-if / required-if conditions', () => {
  const fields = ensureFieldKeys([
    field({ id: 'email', key: 'k1', label: 'Email', type: 'email' }),
    field({
      id: 'company',
      key: 'k2',
      label: 'Company',
      type: 'text',
      showWhen: [{ fieldId: 'email', operator: 'is_truthy' }],
    }),
  ]);
  const after = updateFieldByKey(fields, 'k1', (f) => ({ ...f, id: 'work_email' }));
  assert.equal(after[1]?.showWhen[0]?.fieldId, 'work_email');
});

test('ensureFieldKeys fills missing keys and does not overwrite existing ones', () => {
  const [a, b] = ensureFieldKeys([
    field({ id: 'a', key: 'keep_me', label: 'A', type: 'text' }),
    field({ id: 'b', label: 'B', type: 'text' }),
  ]);
  assert.equal(a?.key, 'keep_me');
  assert.ok(b?.key && b.key !== 'keep_me');
  const again = ensureFieldKeys([a!, b!]);
  assert.equal(again[0]?.key, 'keep_me');
  assert.equal(again[1]?.key, b?.key);
});

test('fieldIdError allows typing (reports problems, does not rewrite the value)', () => {
  assert.equal(fieldIdError('pho', []), null);
  assert.equal(fieldIdError('Phone', []), null);
  assert.ok(fieldIdError('pho', ['pho'])?.toLowerCase().includes('already'));
  assert.ok(fieldIdError('1pho', [])?.toLowerCase().includes('letter'));
  assert.ok(fieldIdError('pho ne', [])?.toLowerCase().includes('space'));
  assert.ok(fieldIdError('', []));
  assert.equal(fieldIdError('phone_1-2', []), null);
});

test('US phone format and validation', () => {
  assert.equal(formatPhoneUS('5551234567'), '(555) 123-4567');
  assert.equal(formatPhoneUS('15551234567'), '(555) 123-4567');
  assert.equal(formatPhoneUS('55512'), '(555) 12');
  assert.equal(validatePhone('(555) 123-4567', 'us'), null);
  assert.ok(validatePhone('555-123', 'us'));
  assert.equal(normalizePhone('1 (555) 123-4567', 'us'), '(555) 123-4567');
});

test('E.164 and international phone validation', () => {
  assert.equal(validatePhone('+14155552671', 'e164'), null);
  assert.equal(normalizePhone('4155552671', 'e164'), '+14155552671');
  assert.ok(validatePhone('4155552671', 'e164') == null || validatePhone(normalizePhone('4155552671', 'e164'), 'e164') == null);
  assert.ok(validatePhone('+12', 'e164'));
  assert.equal(validatePhone('+44 20 7946 0958', 'international'), null);
  assert.ok(validatePhone('123', 'international'));
});

test('email, url, and date validation', () => {
  assert.equal(validateEmail('you@company.com'), null);
  assert.ok(validateEmail('not-an-email'));
  assert.ok(validateEmail('you@company'));
  assert.ok(validateEmail('you@@company.com'));
  assert.equal(validateUrl('https://example.com/x'), null);
  assert.ok(validateUrl('ftp://example.com'));
  assert.ok(validateUrl('example.com'));
  assert.equal(validateDate('2026-02-01'), null);
  assert.ok(validateDate('2026-02-31'));
  assert.ok(validateDate('2026-02-01', '2026-03-01')?.includes('after'));
  assert.ok(validateDate('2026-04-01', undefined, '2026-03-01')?.includes('before'));
});

test('number min/max/step', () => {
  const v = { min: 1, max: 10, step: 0.5 };
  assert.equal(validateNumber(3.5, v, false), null);
  assert.ok(validateNumber(0, v, false)?.includes('at least'));
  assert.ok(validateNumber(11, v, false)?.includes('at most'));
  assert.ok(validateNumber(3.3, v, false)?.includes('multiple'));
  assert.ok(validateNumber('', v, true)?.includes('required'));
  assert.equal(validateNumber('', v, false), null);
});

test('presets mint unique field ids and stable keys', () => {
  const existing = [field({ id: 'phone', key: 'k0', label: 'Phone', type: 'phone' })];
  const phone = FIELD_PRESETS.find((p) => p.id === 'phone');
  const address = FIELD_PRESETS.find((p) => p.id === 'address');
  if (!phone || !address) throw new Error('missing presets');
  const addedPhone = instantiatePreset(phone, existing);
  assert.equal(addedPhone[0]?.id, 'phone_2');
  assert.ok(addedPhone[0]?.key && addedPhone[0].key !== 'k0');
  const addedAddr = instantiatePreset(address, [...existing, ...addedPhone]);
  assert.equal(addedAddr.length, 5);
  const ids = [...existing, ...addedPhone, ...addedAddr].map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});
