-- Run once after supabase.sql using the database owner in the SQL editor.
begin;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  provider text not null check (char_length(provider) between 1 and 50 and btrim(provider) <> ''),
  model text not null check (char_length(model) between 1 and 200 and btrim(model) <> ''),
  kind text not null check (char_length(kind) <= 32 and kind in ('agent', 'analysis', 'questions', 'transcription', 'polish')),
  status text not null check (char_length(status) <= 20 and status in ('success', 'error')),
  error text not null default '' check (char_length(error) <= 500),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  input_rate numeric not null check (input_rate >= 0 and input_rate < 'Infinity'::numeric),
  output_rate numeric not null check (output_rate >= 0 and output_rate < 'Infinity'::numeric),
  estimated_cost numeric not null check (estimated_cost >= 0 and estimated_cost < 'Infinity'::numeric),
  duration_ms bigint not null check (duration_ms >= 0),
  audio_seconds numeric not null default 0 check (audio_seconds >= 0 and audio_seconds < 'Infinity'::numeric)
);

create index ai_usage_user_created_at_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_created_at_idx on public.ai_usage (created_at desc);

create table public.app_admins (
  email text primary key
);

alter table public.ai_usage enable row level security;
alter table public.app_admins enable row level security;

create policy "Users can read their own AI usage"
on public.ai_usage for select to authenticated
using ((select auth.uid()) = user_id);

-- Clear default grants as well as PUBLIC inheritance. app_admins has no policies.
revoke all on table public.ai_usage, public.app_admins from public, anon, authenticated;
grant select on table public.ai_usage to authenticated;

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
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_provider is null or char_length(p_provider) not between 1 and 50 or btrim(p_provider) = ''
    or p_model is null or char_length(p_model) not between 1 and 200 or btrim(p_model) = ''
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

  insert into public.ai_usage (
    user_id, provider, model, kind, status, error, input_tokens, output_tokens,
    input_rate, output_rate, estimated_cost, duration_ms, audio_seconds
  ) values (
    v_user_id, p_provider, p_model, p_kind, p_status, p_error, p_input_tokens, p_output_tokens,
    p_input_rate, p_output_rate, p_estimated_cost, p_duration_ms, p_audio_seconds
  ) returning id into v_id;

  return v_id;
end;
$$;

create function public.get_my_ai_balance()
returns table (spent numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
    select coalesce(sum(usage.estimated_cost), 0::numeric)
    from public.ai_usage as usage
    where usage.user_id = v_user_id;
end;
$$;

create function public.admin_list_ai_usage(p_since timestamptz default null)
returns table (
  id uuid,
  user_id uuid,
  created_at timestamptz,
  provider text,
  model text,
  kind text,
  status text,
  error text,
  input_tokens bigint,
  output_tokens bigint,
  input_rate numeric,
  output_rate numeric,
  estimated_cost numeric,
  duration_ms bigint,
  audio_seconds numeric,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from auth.users as caller
    join public.app_admins as admin on lower(admin.email) = lower(caller.email)
    where caller.id = auth.uid()
      and caller.email_confirmed_at is not null
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
    select usage.id, usage.user_id, usage.created_at, usage.provider, usage.model,
      usage.kind, usage.status, usage.error, usage.input_tokens, usage.output_tokens,
      usage.input_rate, usage.output_rate, usage.estimated_cost, usage.duration_ms, usage.audio_seconds,
      account.email
    from public.ai_usage as usage
    join auth.users as account on account.id = usage.user_id
    where p_since is null or usage.created_at >= p_since
    order by usage.created_at desc, usage.id;
end;
$$;

revoke all on function public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, numeric)
  from public, anon, authenticated;
revoke all on function public.get_my_ai_balance() from public, anon, authenticated;
revoke all on function public.admin_list_ai_usage(timestamptz) from public, anon, authenticated;

grant execute on function public.record_ai_usage(text, text, text, text, text, bigint, bigint, numeric, numeric, numeric, bigint, numeric)
  to authenticated;
grant execute on function public.get_my_ai_balance() to authenticated;
grant execute on function public.admin_list_ai_usage(timestamptz) to authenticated;

commit;
