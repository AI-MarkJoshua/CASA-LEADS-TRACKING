-- Run this migration in Supabase SQL Editor before deploying the create-user function.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'sales',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'sales' where role = 'agent';
update public.profiles set role = 'supervisor' where role in ('admin', 'manager');
alter table public.profiles add constraint profiles_role_check check (role in ('supervisor', 'sales'));
alter table public.profiles enable row level security;

insert into public.profiles (id, full_name, role)
select id, coalesce(raw_user_meta_data ->> 'full_name', email, ''), 'sales'
from auth.users
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, ''),
    case when new.raw_user_meta_data ->> 'role' in ('supervisor', 'sales')
      then new.raw_user_meta_data ->> 'role' else 'sales' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Make the initial account a supervisor.
update public.profiles set role = 'supervisor'
where id = (select id from auth.users where email = 'mjabejo.joyno@gmail.com');
