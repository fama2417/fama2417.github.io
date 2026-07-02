grant usage on schema public to authenticated;

grant select on public.profiles, public.patients, public.appointments, public.imaging_studies, public.audit_log to authenticated;
grant insert, update, delete on public.profiles, public.patients, public.appointments, public.imaging_studies to authenticated;

create function private.create_profile_for_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Usuario'));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.create_profile_for_user();

revoke all on function private.create_profile_for_user() from public, anon, authenticated;
