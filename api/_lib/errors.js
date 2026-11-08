class ConfigurationError extends Error {
  constructor() {
    super('AI configuration is unavailable');
    this.name = 'ConfigurationError';
    this.status = 503;
    this.code = 'configuration_error';
  }
}

class InputError extends Error {
  constructor() {
    super('Invalid AI request input');
    this.name = 'InputError';
    this.status = 400;
    this.code = 'invalid_input';
  }
}

// For bounded, redacted diagnostic messages stored with usage records.
// HTTP handlers must still use fixed public errors, never forward upstream bodies.
function sanitizeErrorMessage(error, secrets = []) {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (typeof message !== 'string' || !message) message = 'AI request failed';

  // Literal replacement also protects credentials without recognizable prefixes.
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret) message = message.split(secret).join('[REDACTED]');
  }
  message = message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/(?:sk[-_]|sb_secret_|sb_publishable_|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, '$1[REDACTED]');
  // Redact first, so truncation cannot reveal the start of a credential.
  return message.slice(0, 500);
}

module.exports = { ConfigurationError, InputError, sanitizeErrorMessage };
