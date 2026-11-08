const { InputError } = require('./errors.js');

const RESPOND_KINDS = new Set(['agent', 'analysis', 'questions', 'polish']);
const MAX_TEXT_CHARACTERS = 60_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError();
  }
}

function validateCharacterLimit(texts, limit) {
  let characters = 0;
  for (const text of texts) {
    for (const character of text) {
      characters += 1;
      if (characters > limit) throw new InputError();
    }
  }
}

function validateRespondInput(body) {
  validateBody(body);
  const { instructions, input, kind } = body;
  if (!RESPOND_KINDS.has(kind) || typeof instructions !== 'string' || typeof input !== 'string') throw new InputError();
  // Count Unicode code points, including emoji, without allocating a combined copy.
  validateCharacterLimit([instructions, input], MAX_TEXT_CHARACTERS);
  // Deliberately omit model and any other untrusted fields.
  return { instructions, input, kind };
}

// The multipart adapter supplies a File-like value; this function performs no I/O.
function validateTranscriptionInput(body) {
  validateBody(body);
  const { file, prompt, kind } = body;
  if (!file || typeof file !== 'object' || Array.isArray(file)
    || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_AUDIO_BYTES
    || typeof prompt !== 'string' || kind !== 'transcription') {
    throw new InputError();
  }
  validateCharacterLimit([prompt], 2000);
  return { file, prompt, kind };
}

module.exports = { validateRespondInput, validateTranscriptionInput };
