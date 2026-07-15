-- LOINC sigue siendo opcional, pero todo código informado debe existir en el catálogo local.
create or replace function private.validate_lab_observation_loinc()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.loinc_code := trim(new.loinc_code);
  if new.loinc_code <> '' and not exists (
    select 1 from public.terminology_codes
    where system = 'LOINC' and code = new.loinc_code
  ) then
    raise exception 'Código LOINC inexistente en el catálogo local' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger validate_lab_observation_loinc
  before insert or update of loinc_code on public.lab_observations
  for each row execute function private.validate_lab_observation_loinc();

notify pgrst, 'reload schema';
