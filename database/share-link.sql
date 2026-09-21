-- Exécuter une fois dans le SQL Editor Supabase, après database/setup.sql.
-- Lien de partage du planning : un jeton par foyer, créé, renouvelé et désactivé par un parent.
alter table public.homes add column share uuid;
create unique index homes_share_unique on public.homes(share) where share is not null;
-- Renouveler revient à créer un nouveau jeton : l'ancien lien cesse aussitôt de fonctionner.
create function public.set_share(enabled boolean) returns uuid language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 update homes set share=case when enabled then gen_random_uuid() else null end where id=public.my_home() returning share into v;
 return v;
end $$;
revoke all on function public.set_share(boolean) from public;
grant execute on function public.set_share(boolean) to authenticated;
