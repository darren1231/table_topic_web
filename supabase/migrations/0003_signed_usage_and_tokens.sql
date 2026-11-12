-- Signed usage, append-only token ledger, and automatic check-in (S1-S2).
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

create table public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  day date not null,
  kind text not null check (kind in ('check_in', 'miss_penalty', 'makeup', 'penalty_refund', 'check_in_adjust', 'exchange')),
  amount integer not null,
  streak integer,
  detail jsonb
);
create index token_ledger_user_day_idx on public.token_ledger (user_id, day);
create unique index token_ledger_once_per_day_idx on public.token_ledger (user_id, day, kind)
  where kind in ('check_in', 'makeup', 'miss_penalty', 'penalty_refund');
alter table public.token_ledger enable row level security;
create policy "Users can read their own token ledger"
  on public.token_ledger for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.token_ledger from public, anon, authenticated;
grant select on table public.token_ledger to authenticated;

-- Fixed production clock: no session setting or caller-supplied date override.
create function private.token_today() returns date
language sql stable security definer set search_path = ''
as $$ select (now() at time zone 'Asia/Taipei')::date $$;
revoke all on function private.token_today() from public, anon, authenticated;

create function private.token_reward(p_streak integer) returns integer
language sql immutable security definer set search_path = ''
as $$ select (array[10, 20, 30, 50, 80, 100])[least(p_streak, 6)] $$;
revoke all on function private.token_reward(integer) from public, anon, authenticated;

create function private.token_status(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := private.token_today();
  v_last_day date;
  v_balance bigint;
  v_pending integer := 0;
  v_streak integer := 0;
  v_checked_in boolean;
begin
  select coalesce(sum(amount), 0) into v_balance from public.token_ledger where user_id = p_user_id;
  select max(day) into v_last_day from public.token_ledger
    where user_id = p_user_id and kind in ('check_in', 'makeup') and day <= v_today;
  if v_last_day is not null then
    select greatest(v_today - v_last_day - 1, 0) - count(*)::integer into v_pending
      from public.token_ledger where user_id = p_user_id and kind = 'miss_penalty'
        and day > v_last_day and day < v_today;
    if v_last_day >= v_today - 1 then
      select count(*)::integer into v_streak from (
        select day, row_number() over (order by day desc) as position from (
          select distinct day from public.token_ledger
          where user_id = p_user_id and kind in ('check_in', 'makeup') and day <= v_today
        ) as days
      ) as consecutive where day = v_last_day - (position - 1)::integer;
    end if;
  end if;
  v_balance := greatest(0, v_balance - v_pending::bigint * 50);
  v_checked_in := coalesce(v_last_day = v_today, false);
  return jsonb_build_object('balance', v_balance, 'streak', v_streak, 'checkedIn', v_checked_in,
    'canMakeup', v_balance >= 200 and not exists (
      select 1 from public.token_ledger where user_id = p_user_id and day = v_today - 1 and kind in ('check_in', 'makeup')
    ), 'makeupCost', 200, 'reward', case when v_checked_in then 0 else private.token_reward(v_streak + 1) end);
end;
$$;
revoke all on function private.token_status(uuid) from public, anon, authenticated;

create function public.get_my_token_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return private.token_status(auth.uid());
end;
$$;
revoke all on function public.get_my_token_status() from public, anon, authenticated;
grant execute on function public.get_my_token_status() to authenticated;

create function private.settle_missed_days(p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := private.token_today();
  v_last_day date;
  v_day date;
  v_penalty integer;
  v_balance bigint;
begin
  if auth.uid() is null or p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Serialize this user's ledger without requiring UPDATE on managed auth tables.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select coalesce(sum(amount), 0) into v_balance from public.token_ledger where user_id = p_user_id;
  select max(day) into v_last_day from public.token_ledger
    where user_id = p_user_id and kind in ('check_in', 'makeup') and day <= v_today;
  v_day := v_last_day + 1;
  while v_day < v_today loop
    if not exists (select 1 from public.token_ledger where user_id = p_user_id and day = v_day and kind = 'miss_penalty') then
      v_penalty := -least(50, greatest(v_balance, 0))::integer;
      insert into public.token_ledger (user_id, day, kind, amount) values (p_user_id, v_day, 'miss_penalty', v_penalty);
      v_balance := v_balance + v_penalty;
    end if;
    v_day := v_day + 1;
  end loop;
end;
$$;
revoke all on function private.settle_missed_days(uuid) from public, anon, authenticated;

create function private.check_in(p_user_id uuid, p_usage_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := private.token_today();
  v_status jsonb;
  v_streak integer;
  v_reward integer;
  v_balance bigint;
begin
  perform private.settle_missed_days(p_user_id);
  v_status := private.token_status(p_user_id);
  v_streak := (v_status ->> 'streak')::integer;
  v_balance := (v_status ->> 'balance')::bigint;
  if (v_status ->> 'checkedIn')::boolean then
    return jsonb_build_object('checkedIn', false, 'reward', 0, 'streak', v_streak, 'balance', v_balance);
  end if;
  v_streak := v_streak + 1;
  v_reward := private.token_reward(v_streak);
  insert into public.token_ledger (user_id, day, kind, amount, streak, detail)
    values (p_user_id, v_today, 'check_in', v_reward, v_streak, jsonb_build_object('ai_usage_id', p_usage_id));
  return jsonb_build_object('checkedIn', true, 'reward', v_reward, 'streak', v_streak, 'balance', v_balance + v_reward);
end;
$$;
revoke all on function private.check_in(uuid, uuid) from public, anon, authenticated;

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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_secret text;
  v_expected text;
  v_check_in jsonb;
  v_token_status jsonb;
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

  if p_kind = 'analysis' and p_status = 'success' then
    v_check_in := private.check_in(v_user_id, v_id);
  else
    v_token_status := private.token_status(v_user_id);
    v_check_in := jsonb_build_object('checkedIn', false, 'reward', 0,
      'streak', v_token_status -> 'streak', 'balance', v_token_status -> 'balance');
  end if;
  return jsonb_build_object('id', v_id, 'checkIn', v_check_in);
end;
$$;

revoke all on function public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, timestamptz, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, timestamptz, uuid, text, numeric)
  to authenticated;

commit;
