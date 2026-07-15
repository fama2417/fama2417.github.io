-- Identidad propia del PHR: existe aunque la cuenta no esté vinculada a ningún tenant.
create table public.phr_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  birth_date date not null check (birth_date >= date '1900-01-01'),
  identifier text not null default '' check (length(trim(identifier)) <= 32),
  terms_accepted_at timestamptz not null,
  privacy_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.phr_profiles enable row level security;
grant select on public.phr_profiles to authenticated;
grant all on public.phr_profiles to service_role;

create policy "owners read own PHR profile" on public.phr_profiles for select to authenticated
using (user_id = (select auth.uid()));

create trigger set_updated_at_phr_profiles before update on public.phr_profiles
for each row execute function private.set_updated_at();

-- Una cuenta PHR puede desaparecer sin borrar la ficha clínica que una institución conserva.
alter table public.patients drop constraint if exists patients_user_id_fkey;
alter table public.patients add constraint patients_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

notify pgrst, 'reload schema';
