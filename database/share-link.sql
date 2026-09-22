-- Exécuter dans le SQL Editor Supabase, après database/setup.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Lien de partage du planning : un jeton par foyer, créé, renouvelé et désactivé par un parent.
alter table public.homes add column if not exists share uuid;
create unique index if not exists homes_share_unique on public.homes(share) where share is not null;
-- Renouveler revient à créer un nouveau jeton : l'ancien lien cesse aussitôt de fonctionner.
create or replace function public.set_share(enabled boolean) returns uuid language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 update homes set share=case when enabled then gen_random_uuid() else null end where id=public.my_home() returning share into v;
 return v;
end $$;
revoke all on function public.set_share(boolean) from public, anon;
grant execute on function public.set_share(boolean) to authenticated;
-- Contrôle : les trois lignes ci-dessous doivent toutes afficher « en place ».
select 'colonne homes.share' as objet, case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='homes' and column_name='share') then 'en place' else 'MANQUANT' end as etat
union all select 'index homes_share_unique', case when exists(select 1 from pg_indexes where schemaname='public' and indexname='homes_share_unique') then 'en place' else 'MANQUANT' end
union all select 'fonction set_share', case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='set_share') then 'en place' else 'MANQUANT' end;
