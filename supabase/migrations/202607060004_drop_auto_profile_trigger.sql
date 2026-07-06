-- Trigger obsoleto (pre multi-tenant): creaba el perfil sin tenant_id al insertar en auth.users,
-- lo que hacía fallar TODA creación de usuarios (profiles.tenant_id es not null).
-- Los perfiles se crean explícitamente con su institución en las rutas de administración.
-- Aplicado directamente en producción el 6-jul-2026.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.create_profile_for_user();
