(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SystemAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function selectProvider({ signedIn, enableByok, project }) {
    if (!signedIn) return 'builtin';
    return enableByok && ['builtin', 'system', 'openai', 'anthropic', 'compatible'].includes(project?.provider)
      ? project.provider : 'system';
  }

  function interpretResponse(status) {
    if (status >= 200 && status < 300) return { ok: true, code: null, messageKey: null, fallbackToBuiltin: false };
    const messages = {
      401: ['unauthorized', 'signInAgain'], 402: ['credit_exhausted', 'creditExhausted'],
      400: ['invalid_input', 'invalidInput'], 502: ['upstream_error', 'serviceError'],
      503: ['configuration_error', 'unavailable'], 0: ['network_error', 'networkError'],
    };
    const [code, key] = messages[status] || messages[502];
    return { ok: false, code, messageKey: `systemAi.${key}`, fallbackToBuiltin: status === 402 };
  }

  function isAudioTooLarge(size) {
    return !Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 * 1024;
  }

  function failure(result) {
    return Object.assign(new Error(result.messageKey), result);
  }

  function createClient({ fetch, getAccessToken }) {
    async function send(path, body, json, readOnly = false) {
      let token;
      try { token = await getAccessToken(); } catch { throw failure(interpretResponse(401)); }
      if (!token) throw failure(interpretResponse(401));
      let response;
      try {
        response = await fetch(path, {
          method: readOnly ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
          body: json ? JSON.stringify(body) : body,
        });
      } catch { throw failure(interpretResponse(0)); }
      const result = interpretResponse(response.status);
      if (!result.ok) throw failure(result);
      const data = await response.json().catch(() => null);
      if (readOnly) {
        if (!data || !['spent', 'credit', 'balance'].every(key => typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0)
          || typeof data.exhausted !== 'boolean') throw failure(interpretResponse(502));
        return data;
      }
      if (!data || typeof data.text !== 'string' || !data.usage || typeof data.usage !== 'object'
        || typeof data.cost !== 'number' || !Number.isFinite(data.cost) || data.cost < 0) {
        throw failure(interpretResponse(502));
      }
      return data;
    }
    return {
      balance() { return send('/api/ai/balance', undefined, false, true); },
      respond({ instructions, input, kind = 'agent' }) {
        return send('/api/ai/respond', { instructions, input, kind }, true);
      },
      async transcribe({ file, prompt }) {
        if (isAudioTooLarge(file?.size)) throw failure({
          ok: false, code: 'audio_too_large', messageKey: 'systemAi.audioTooLarge', fallbackToBuiltin: false,
        });
        const form = new FormData();
        const extension = file.type?.includes('mp4') ? 'm4a' : file.type?.includes('ogg') ? 'ogg' : 'webm';
        form.append('file', file, file.name || `recording.${extension}`);
        form.append('prompt', prompt);
        form.append('kind', 'transcription');
        return send('/api/ai/transcribe', form, false);
      },
    };
  }

  return { selectProvider, interpretResponse, isAudioTooLarge, createClient };
});
