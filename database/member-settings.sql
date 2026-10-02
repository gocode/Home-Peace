-- Exécuter dans le SQL Editor Supabase, après managed-profiles.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Réglages d'un membre : couleur de son avatar, et présence parmi les personnes à qui l'on attribue des tâches.

-- Un membre retiré des attributions garde ses tâches existantes ; il n'est simplement plus proposé.
alter table public.members add column if not exists assignable boolean not null default true;

-- Couleur : un parent la choisit pour tout membre de la famille, chacun peut aussi changer la sienne.
create or replace function public.set_member_color(target uuid, new_color text) returns void language plpgsql security definer set search_path=public as $$
begin
 if new_color is null or new_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide'; end if;
 if not public.is_parent() and target is distinct from public.my_member() then raise exception 'Accès parent requis'; end if;
 update members set color=lower(new_color) where id=target and home=public.my_home();
 if not found then raise exception 'Membre introuvable'; end if;
end $$;

create or replace function public.set_member_assignable(target uuid, enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 if enabled is null then raise exception 'Requête invalide'; end if;
 update members set assignable=enabled where id=target and home=public.my_home();
 if not found then raise exception 'Membre introuvable'; end if;
end $$;

revoke all on function public.set_member_color(uuid,text),public.set_member_assignable(uuid,boolean) from public, anon;
grant execute on function public.set_member_color(uuid,text),public.set_member_assignable(uuid,boolean) to authenticated;

-- Contrôle : les deux lignes ci-dessous doivent toutes afficher « en place ».
select 'colonne members.assignable' as objet, case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='assignable') then 'en place' else 'MANQUANT' end as etat
union all select 'fonctions de réglage hors de portée de anon', case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_member_color','set_member_assignable') and not has_function_privilege('anon',p.oid,'execute'))=2 then 'en place' else 'MANQUANT' end;
