-- Traspasa el catálogo plano (catalog_items + room_schedules) al modelo FHIR, por tenant.
-- Best-effort: crea 1 Organization por institución y mapea los listados existentes a las nuevas
-- entidades y a recursos agendables. Las citas legadas conservan sus columnas de texto (no se
-- backfillea schedulable_resource_id: el modelo nuevo aplica a la parametría y a reservas nuevas).
do $$
declare
  v_tenant record;
  v_org uuid;
  v_loc_default uuid;
  c record;
  v_res uuid;
  v_role uuid;
  v_pract uuid;
  rs record;
  d text;
begin
  for v_tenant in select id, name from public.tenants loop
    -- Una organización por institución.
    insert into public.organizations (tenant_id, name) values (v_tenant.id, v_tenant.name)
    returning id into v_org;

    -- Sedes desde 'sucursal' (al menos una por defecto).
    for c in select label from public.catalog_items where tenant_id = v_tenant.id and category = 'sucursal' and active loop
      insert into public.locations (tenant_id, organization_id, name) values (v_tenant.id, v_org, c.label);
    end loop;
    select id into v_loc_default from public.locations where organization_id = v_org order by created_at limit 1;
    if v_loc_default is null then
      insert into public.locations (tenant_id, organization_id, name) values (v_tenant.id, v_org, 'Sede principal')
      returning id into v_loc_default;
    end if;

    -- Servicios clínicos desde 'servicio' (+ especialidad si existe una).
    for c in select label from public.catalog_items where tenant_id = v_tenant.id and category = 'servicio' and active loop
      insert into public.healthcare_services (tenant_id, organization_id, name,
        specialty)
      values (v_tenant.id, v_org, c.label,
        coalesce((select label from public.catalog_items where tenant_id = v_tenant.id and category = 'especialidad' and active order by sort limit 1), ''));
    end loop;

    -- Prestaciones → tipos de atención (con duración).
    for c in select code, label, coalesce(duration_min, 30) as dm from public.catalog_items
             where tenant_id = v_tenant.id and category = 'prestacion' and active loop
      insert into public.service_types (tenant_id, code, name, duration_min)
      values (v_tenant.id, c.code, c.label, c.dm)
      on conflict (tenant_id, name) do nothing;
    end loop;

    -- Profesionales → Practitioner + PractitionerRole + recurso agendable (professional).
    for c in select label from public.catalog_items where tenant_id = v_tenant.id and category = 'profesional' and active loop
      insert into public.practitioners (tenant_id, full_name) values (v_tenant.id, c.label)
      on conflict (tenant_id, full_name) do nothing;
      select id into v_pract from public.practitioners where tenant_id = v_tenant.id and full_name = c.label;
      insert into public.practitioner_roles (tenant_id, practitioner_id, organization_id, location_id)
      values (v_tenant.id, v_pract, v_org, v_loc_default) returning id into v_role;
      insert into public.schedulable_resources (tenant_id, organization_id, location_id, kind, name, practitioner_role_id)
      values (v_tenant.id, v_org, v_loc_default, 'professional', c.label, v_role)
      on conflict (tenant_id, name) do nothing;
    end loop;

    -- Salas/equipos → Location + recurso agendable (location). Conserva el nombre para casar room_schedules.
    for c in select label from public.catalog_items where tenant_id = v_tenant.id and category = 'sala' and active loop
      insert into public.locations (tenant_id, organization_id, name) values (v_tenant.id, v_org, c.label)
      on conflict (tenant_id, organization_id, name) do nothing;
      insert into public.schedulable_resources (tenant_id, organization_id, location_id, kind, name)
      select v_tenant.id, v_org, l.id, 'location', c.label
      from public.locations l where l.organization_id = v_org and l.name = c.label
      on conflict (tenant_id, name) do nothing;
    end loop;

    -- room_schedules → schedules del recurso homónimo (expande la CSV de días a una fila por día).
    for rs in select room_label, days, open_time, close_time from public.room_schedules where tenant_id = v_tenant.id loop
      select id into v_res from public.schedulable_resources where tenant_id = v_tenant.id and name = rs.room_label;
      if v_res is not null then
        foreach d in array string_to_array(rs.days, ',') loop
          insert into public.schedules (tenant_id, resource_id, weekday, start_time, end_time)
          values (v_tenant.id, v_res, d::smallint, rs.open_time, rs.close_time);
        end loop;
      end if;
    end loop;
  end loop;
end $$;
