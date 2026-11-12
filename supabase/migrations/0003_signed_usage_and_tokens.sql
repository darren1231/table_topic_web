-- S1: signed usage only. Token ledger and check-in behavior follow in S2.
-- The signing secret is provisioned separately by the database owner, never here.
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.signing_keys (name text primary key, secret text not null);
alter table private.signing_keys enable row level security;
revoke all on table private.signing_keys from public, anon, authenticated;

alter table public.ai_usage add column nonce uuid unique, add column issued_at timestamptz;

-- Old records remain readable; every new record must use the signed entry point.
drop function if exists public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, numeric);
drop function if exists public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint);

-- Canonical UTF-8 payload. UTC, exactly three millisecond digits; decimal values
-- have no exponent or trailing fractional zeroes. UUID casts are lowercase.
create function private.usage_signing_payload(
  p_user_id uuid, p_kind text, p_status text, p_model text,
  p_input_tokens bigint, p_output_tokens bigint, p_estimated_cost numeric,
  p_audio_seconds numeric, p_issued_at timestamptz, p_nonce uuid
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select p_user_id::text || '|' || p_kind || '|' || p_status || '|' || p_model || '|'
    || p_input_tokens::text || '|' || p_output_tokens::text || '|'
    || trim_scale(p_estimated_cost)::text || '|' || trim_scale(p_audio_seconds)::text || '|'
    || to_char(p_issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || p_nonce::text
$$;
revoke all on function private.usage_signing_payload(uuid, text, text, text, bigint, bigint, numeric, numeric, timestamptz, uuid)
  from public, anon, authenticated;

create function public.record_ai_usage(
  p_provider text,
  p_model text,
  p_kind text,
  p_status text,
  p_error text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_input_rate numeric,
  p_output_rate numeric,
  p_estimated_cost numeric,
  p_duration_ms bigint,
  p_issued_at timestamptz,
  p_nonce uuid,
  p_signature text,
  p_audio_seconds numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_secret text;
  v_expected text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_provider is null or char_length(p_provider) not between 1 and 50 or btrim(p_provider) = ''
    or p_model is null or char_length(p_model) not between 1 and 200 or btrim(p_model) = '' or position('|' in p_model) > 0
    or p_kind is null or char_length(p_kind) > 32
    or p_kind not in ('agent', 'analysis', 'questions', 'transcription', 'polish')
    or p_status is null or char_length(p_status) > 20 or p_status not in ('success', 'error')
    or p_error is null or char_length(p_error) > 500 then
    raise exception 'Invalid AI usage text fields' using errcode = '22023';
  end if;

  if p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0
    or p_input_rate is null or p_input_rate < 0 or p_input_rate >= 'Infinity'::numeric
    or p_output_rate is null or p_output_rate < 0 or p_output_rate >= 'Infinity'::numeric
    or p_estimated_cost is null or p_estimated_cost < 0 or p_estimated_cost >= 'Infinity'::numeric
    or p_duration_ms is null or p_duration_ms < 0
    or p_audio_seconds is null or p_audio_seconds < 0 or p_audio_seconds >= 'Infinity'::numeric then
    raise exception 'Invalid AI usage numeric fields' using errcode = '22023';
  end if;

  if p_issued_at is null or not isfinite(p_issued_at) or p_nonce is null then
    raise exception 'Invalid usage signing metadata' using errcode = '22023';
  end if;
  if p_issued_at < now() - interval '5 minutes' or p_issued_at > now() + interval '5 minutes' then
    raise exception 'Usage signature outside allowed time window' using errcode = '22023';
  end if;

  select secret into v_secret from private.signing_keys where name = 'usage';
  if v_secret is null or char_length(v_secret) < 32 or btrim(v_secret) = '' then
    raise exception 'Usage signing unavailable' using errcode = '42501';
  end if;
  v_expected := encode(extensions.hmac(private.usage_signing_payload(
    v_user_id, p_kind, p_status, p_model, p_input_tokens, p_output_tokens,
    p_estimated_cost, p_audio_seconds, p_issued_at, p_nonce), v_secret, 'sha256'), 'hex');
  if p_signature is null or p_signature !~ '^[0-9a-f]{64}$' or p_signature <> v_expected then
    raise exception 'Invalid usage signature' using errcode = '42501';
  end if;

  insert into public.ai_usage (
    user_id, provider, model, kind, status, error, input_tokens, output_tokens,
    input_rate, output_rate, estimated_cost, duration_ms, audio_seconds, issued_at, nonce
  ) values (
    v_user_id, p_provider, p_model, p_kind, p_status, p_error, p_input_tokens, p_output_tokens,
    p_input_rate, p_output_rate, p_estimated_cost, p_duration_ms, p_audio_seconds, p_issued_at, p_nonce
  ) on conflict (nonce) do nothing returning id into v_id;
  if v_id is null then
    raise exception 'Usage nonce already used' using errcode = '22023';
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, timestamptz, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, timestamptz, uuid, text, numeric)
  to authenticated;

commit;
