const { InputError } = require('./errors.js');

const KINDS = new Set(['agent', 'analysis', 'questions', 'transcription', 'polish']);
const MAX_TEXT_CHARACTERS = 60_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !KINDS.has(body.kind)) {
    throw new InputError();
  }
}

function validateRespondInput(body) {
  validateBody(body);
  const { instructions, input, kind } = body;
  if (typeof instructions !== 'string' || typeof input !== 'string') throw new InputError();
  // Count Unicode code points, including emoji, without allocating a combined copy.
  let characters = 0;
  for (const text of [instructions, input]) {
    for (const character of text) {
      characters += 1;
      if (characters > MAX_TEXT_CHARACTERS) throw new InputError();
    }
  }
  // Deliberately omit model and any other untrusted fields.
  return { instructions, input, kind };
}

// The multipart adapter supplies a File-like value; this function performs no I/O.
function validateTranscriptionInput(body) {
  validateBody(body);
  const { file, prompt, kind } = body;
  if (!file || typeof file !== 'object' || Array.isArray(file)
    || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_AUDIO_BYTES
    || typeof prompt !== 'string') {
    throw new InputError();
  }
  return { file, prompt, kind };
}

module.exports = { validateRespondInput, validateTranscriptionInput };
