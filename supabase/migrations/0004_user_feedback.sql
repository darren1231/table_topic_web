-- User feedback. Apply after 0001-0003; this migration contains no credentials.
begin;

create function private.feedback_now() returns timestamptz
language sql stable security definer set search_path = ''
as $$ select now() $$;
revoke all on function private.feedback_now() from public, anon, authenticated;

create function private.feedback_context_valid(p_context jsonb) returns boolean
language plpgsql immutable security definer set search_path = ''
as $$
begin
  if p_context is null then return true; end if;
  if jsonb_typeof(p_context) <> 'object' or octet_length(convert_to(p_context::text, 'UTF8')) > 2048 then return false; end if;
  return not exists (
    select 1 from jsonb_each(p_context) as item
    where item.key not in ('view', 'userAgent', 'language', 'appVersion', 'submittedAt')
      or jsonb_typeof(item.value) <> 'string' or char_length(item.value #>> '{}') > 300
  );
end;
$$;
revoke all on function private.feedback_context_valid(jsonb) from public, anon, authenticated;

create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null check (type in ('bug', 'suggestion', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  context jsonb check (private.feedback_context_valid(context)),
  status text not null default 'new' check (status in ('new', 'triaged', 'issue_created', 'done', 'wont_fix')),
  priority text check (priority in ('urgent', 'normal', 'later')),
  admin_note text check (char_length(admin_note) <= 2000),
  issue_number integer check (issue_number > 0),
  issue_url text,
  issue_pending_at timestamptz,
  issue_pending_token uuid,
  check ((issue_number is null) = (issue_url is null)),
  check ((issue_pending_at is null) = (issue_pending_token is null)),
  check (issue_number is null or issue_pending_at is null)
);
create index feedback_user_created_idx on public.feedback (user_id, created_at desc);
create index feedback_created_idx on public.feedback (created_at desc, id desc);
alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;
revoke all on sequence public.feedback_id_seq from public, anon, authenticated;

create function public.submit_feedback(p_type text, p_message text, p_context jsonb)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := private.feedback_now();
  v_id bigint;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_type is null or p_type not in ('bug', 'suggestion', 'other') or p_message is null
    or char_length(p_message) not between 1 and 2000 or p_message !~ '[^[:space:]]' then
    raise exception 'invalid_feedback_input' using errcode = '22023';
  end if;
  if not private.feedback_context_valid(nullif(p_context, 'null'::jsonb)) then
    raise exception 'invalid_feedback_context' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || v_user_id::text, 0));
  if (select count(*) from public.feedback where user_id = v_user_id
    and created_at >= ((v_now at time zone 'Asia/Taipei')::date::timestamp at time zone 'Asia/Taipei')
    and created_at < (((v_now at time zone 'Asia/Taipei')::date + 1)::timestamp at time zone 'Asia/Taipei')) >= 10 then
    raise exception 'feedback_daily_limit' using errcode = 'P0001';
  end if;
  insert into public.feedback (user_id, created_at, updated_at, type, message, context)
    values (v_user_id, v_now, v_now, p_type, p_message, nullif(p_context, 'null'::jsonb)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_feedback(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_feedback(text, text, jsonb) to authenticated;

create function public.get_my_feedback()
returns table (id bigint, created_at timestamptz, type text, message text, public_status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query select item.id, item.created_at, item.type, item.message,
    case item.status when 'new' then 'received' when 'done' then 'done' when 'wont_fix' then 'declined' else 'in_progress' end
    from public.feedback as item where item.user_id = auth.uid() order by item.created_at desc, item.id desc;
end;
$$;
revoke all on function public.get_my_feedback() from public, anon, authenticated;
grant execute on function public.get_my_feedback() to authenticated;

create function private.require_feedback_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users as caller
    join public.app_admins as admin on lower(admin.email) = lower(caller.email)
    where caller.id = auth.uid() and caller.email_confirmed_at is not null) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_feedback_admin() from public, anon, authenticated;

create function public.admin_list_feedback()
returns table (id bigint, user_id uuid, created_at timestamptz, updated_at timestamptz, type text,
  message text, context jsonb, status text, priority text, admin_note text,
  issue_number integer, issue_url text, issue_pending_at timestamptz, issue_pending_token uuid, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_feedback_admin();
  return query select item.*, account.email::text from public.feedback as item
    join auth.users as account on account.id = item.user_id order by item.created_at desc, item.id desc;
end;
$$;
revoke all on function public.admin_list_feedback() from public, anon, authenticated;
grant execute on function public.admin_list_feedback() to authenticated;

create function public.admin_update_feedback(p_ids bigint[], p_priority text, p_status text, p_note text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_ids bigint[];
  v_count integer;
begin
  perform private.require_feedback_admin();
  if p_ids is null or cardinality(p_ids) = 0 or array_ndims(p_ids) <> 1
    or exists (select 1 from unnest(p_ids) as ids(id) where id is null or id <= 0)
    or (p_priority is not null and p_priority not in ('urgent', 'normal', 'later'))
    or (p_status is not null and p_status not in ('new', 'triaged', 'done', 'wont_fix'))
    or (p_note is not null and char_length(p_note) > 2000) then
    raise exception 'invalid_feedback_batch' using errcode = '22023';
  end if;
  select array_agg(distinct ids.id order by ids.id) into v_ids from unnest(p_ids) as ids(id);
  if p_note is not null and cardinality(v_ids) <> 1 then
    raise exception 'invalid_feedback_batch' using errcode = '22023';
  end if;
  perform 1 from public.feedback where id = any(v_ids) order by id for update;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then raise exception 'feedback_not_found' using errcode = '22023'; end if;
  update public.feedback as item set priority = coalesce(p_priority, item.priority),
    status = case when p_priority is not null and coalesce(p_status, item.status) = 'new' then 'triaged' else coalesce(p_status, item.status) end,
    admin_note = coalesce(p_note, item.admin_note), updated_at = private.feedback_now()
    where item.id = any(v_ids) and (p_priority is not null or p_status is not null or p_note is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.admin_update_feedback(bigint[], text, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_feedback(bigint[], text, text, text) to authenticated;

create function private.feedback_issue_url_valid(p_number integer, p_url text) returns boolean
language plpgsql immutable security definer set search_path = ''
as $$
begin
  if p_number is null and p_url is null then return true; end if;
  if p_number is null or p_number <= 0 or p_url is null then return false; end if;
  return p_url !~ '[[:space:]]'
    and p_url ~ ('^https://github[.]com/[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+/issues/' || p_number::text || '$')
    and split_part(p_url, '/', 5) not in ('.', '..');
end;
$$;
revoke all on function private.feedback_issue_url_valid(integer, text) from public, anon, authenticated;
alter table public.feedback add constraint feedback_issue_url_check check (private.feedback_issue_url_valid(issue_number, issue_url));

create function public.admin_begin_issue(p_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_feedback public.feedback%rowtype;
  v_now timestamptz := private.feedback_now();
  v_token uuid := gen_random_uuid();
begin
  perform private.require_feedback_admin();
  if p_id is null or p_id <= 0 then raise exception 'invalid_feedback_input' using errcode = '22023'; end if;
  select * into v_feedback from public.feedback where id = p_id for update;
  if not found then raise exception 'feedback_not_found' using errcode = '22023'; end if;
  if v_feedback.issue_number is not null then raise exception 'feedback_issue_exists' using errcode = '55000'; end if;
  if v_feedback.issue_pending_at > v_now - interval '10 minutes' then
    raise exception 'feedback_issue_pending' using errcode = '55000';
  end if;
  update public.feedback set issue_pending_at = v_now, issue_pending_token = v_token, updated_at = v_now where id = p_id;
  return jsonb_build_object('id', v_feedback.id, 'type', v_feedback.type, 'message', v_feedback.message,
    'context', v_feedback.context, 'priority', v_feedback.priority, 'email',
    (select account.email::text from auth.users as account where account.id = v_feedback.user_id),
    'issue_pending_token', v_token, 'issue_pending_at', v_now);
end;
$$;
revoke all on function public.admin_begin_issue(bigint) from public, anon, authenticated;
grant execute on function public.admin_begin_issue(bigint) to authenticated;

create function private.require_feedback_issue_token(p_id bigint, p_token uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
  v_pending_at timestamptz;
begin
  if p_id is null or p_id <= 0 then raise exception 'invalid_feedback_input' using errcode = '22023'; end if;
  select issue_pending_token, issue_pending_at into v_token, v_pending_at from public.feedback where id = p_id for update;
  if not found then raise exception 'feedback_not_found' using errcode = '22023'; end if;
  if p_token is null or v_token is distinct from p_token or v_pending_at is null then
    raise exception 'feedback_issue_token_mismatch' using errcode = '55000';
  end if;
end;
$$;
revoke all on function private.require_feedback_issue_token(bigint, uuid) from public, anon, authenticated;

create function public.admin_finish_issue(p_id bigint, p_token uuid, p_number integer, p_url text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_feedback_admin();
  perform private.require_feedback_issue_token(p_id, p_token);
  if p_number is null or p_url is null or not private.feedback_issue_url_valid(p_number, p_url) then
    raise exception 'invalid_feedback_issue_url' using errcode = '22023';
  end if;
  update public.feedback set issue_number = p_number, issue_url = p_url,
    issue_pending_at = null, issue_pending_token = null, status = 'issue_created', updated_at = private.feedback_now() where id = p_id;
end;
$$;
revoke all on function public.admin_finish_issue(bigint, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_finish_issue(bigint, uuid, integer, text) to authenticated;

create function public.admin_cancel_issue(p_id bigint, p_token uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_feedback_admin();
  perform private.require_feedback_issue_token(p_id, p_token);
  update public.feedback set issue_pending_at = null, issue_pending_token = null, updated_at = private.feedback_now() where id = p_id;
end;
$$;
revoke all on function public.admin_cancel_issue(bigint, uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_issue(bigint, uuid) to authenticated;

commit;
