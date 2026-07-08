-- Fix: el wizard llamaba supabase.rpc("generate_slots") y daba 404. PostgREST solo expone
-- funciones del esquema public; la función vive en private. Se agrega un wrapper público
-- (delgado) que delega en private.generate_slots (que conserva el chequeo de admin y es SECURITY DEFINER).
create or replace function public.generate_slots(p_resource uuid, p_from date, p_to date)
returns integer language sql set search_path = '' as $$
  select private.generate_slots(p_resource, p_from, p_to);
$$;
grant execute on function public.generate_slots(uuid, date, date) to authenticated;
revoke all on function public.generate_slots(uuid, date, date) from public, anon;
