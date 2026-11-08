const assert = require('node:assert/strict');
const { test } = require('node:test');
const validateRespondInput = (...args) => require('../api/_lib/validation.js').validateRespondInput(...args);
const validateTranscriptionInput = (...args) => require('../api/_lib/validation.js').validateTranscriptionInput(...args);
const invalid = { status: 400, code: 'invalid_input' };

test('respond accepts all allowed kinds and strips client-selected models without mutating input', () => {
  for (const kind of ['agent', 'analysis', 'questions', 'transcription', 'polish']) {
    const body = Object.freeze({ instructions: 'Follow instructions', input: 'Answer', kind, model: 'untrusted-model' });
    assert.deepEqual(validateRespondInput(body), { instructions: body.instructions, input: body.input, kind });
  }
});

test('respond counts combined Unicode characters and accepts exactly 60000', () => {
  const body = { instructions: '中'.repeat(30_000), input: '😀'.repeat(30_000), kind: 'agent' };
  assert.deepEqual(validateRespondInput(body), body);
  assert.throws(() => validateRespondInput({ ...body, input: body.input + 'x' }), invalid);
  assert.throws(() => validateRespondInput({ instructions: 'x'.repeat(60_001), input: '', kind: 'agent' }), invalid);
});

test('respond rejects malformed bodies, non-string text and every unsupported kind', () => {
  for (const body of [null, undefined, [], 'text', 1]) assert.throws(() => validateRespondInput(body), invalid);
  const valid = { instructions: '', input: 'text', kind: 'agent' };
  for (const field of ['instructions', 'input']) {
    for (const value of [undefined, null, {}, [], 123]) {
      assert.throws(() => validateRespondInput({ ...valid, [field]: value }), invalid);
    }
  }
  for (const kind of [undefined, null, '', 'Agent', 'unknown', '__proto__', {}, ['agent']]) {
    assert.throws(() => validateRespondInput({ ...valid, kind }), invalid);
  }
});

test('transcription accepts exactly 4 MiB and returns only validated fields', () => {
  const file = Object.freeze({ size: 4 * 1024 * 1024 });
  const body = Object.freeze({ file, prompt: 'Preserve spoken languages', kind: 'transcription', model: 'untrusted-model' });
  assert.deepEqual(validateTranscriptionInput(body), { file, prompt: body.prompt, kind: 'transcription' });
  assert.throws(() => validateTranscriptionInput({ ...body, file: { size: file.size + 1 } }), invalid);
});

test('transcription rejects missing, empty or invalid file sizes, prompts and kinds', () => {
  const valid = { file: { size: 1 }, prompt: '', kind: 'transcription' };
  for (const body of [null, undefined, [], 'file']) assert.throws(() => validateTranscriptionInput(body), invalid);
  for (const file of [undefined, null, {}, [], { size: 0 }, { size: -1 }, { size: NaN }, { size: Infinity }, { size: '1' }, { size: 1.5 }]) {
    assert.throws(() => validateTranscriptionInput({ ...valid, file }), invalid);
  }
  for (const prompt of [undefined, null, {}, 1]) {
    assert.throws(() => validateTranscriptionInput({ ...valid, prompt }), invalid);
  }
  for (const kind of ['unknown', '', '__proto__', undefined]) {
    assert.throws(() => validateTranscriptionInput({ ...valid, kind }), invalid);
  }
});
