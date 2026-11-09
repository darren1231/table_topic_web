-- Repair existing installations where auth.users.email is varchar(255).
begin;

create or replace function public.admin_list_ai_usage(p_since timestamptz default null)
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
      account.email::text
    from public.ai_usage as usage
    join auth.users as account on account.id = usage.user_id
    where p_since is null or usage.created_at >= p_since
    order by usage.created_at desc, usage.id;
end;
$$;

revoke all on function public.admin_list_ai_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_list_ai_usage(timestamptz) to authenticated;

commit;
