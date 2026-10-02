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

-- Décocher un membre le sort aussi des rotations existantes, sauf s'il en est le dernier participant.
-- Rend le nombre de rotations modifiées. Le recocher ne l'y remet pas : il faut modifier la tâche.
drop function if exists public.set_member_assignable(uuid,boolean);
create function public.set_member_assignable(target uuid, enabled boolean) returns integer language plpgsql security definer set search_path=public as $$
declare n integer:=0;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 if enabled is null then raise exception 'Requête invalide'; end if;
 update members set assignable=enabled where id=target and home=public.my_home();
 if not found then raise exception 'Membre introuvable'; end if;
 if not enabled then
  update tasks set people=array_remove(people,target) where home=public.my_home() and rotating and target=any(people) and cardinality(array_remove(people,target))>0;
  get diagnostics n=row_count;
 end if;
 return n;
end $$;

-- Rattrapage : les membres déjà décochés quittent les rotations créées avant cette règle.
update public.tasks t set people=(select array_agg(p order by o) from unnest(t.people) with ordinality u(p,o) where p not in (select id from public.members where not assignable))
where t.rotating and exists(select 1 from public.members m where m.id=any(t.people) and not m.assignable)
 and exists(select 1 from unnest(t.people) p where p not in (select id from public.members where not assignable));

revoke all on function public.set_member_color(uuid,text),public.set_member_assignable(uuid,boolean) from public, anon;
grant execute on function public.set_member_color(uuid,text),public.set_member_assignable(uuid,boolean) to authenticated;

-- Contrôle : les trois lignes ci-dessous doivent toutes afficher « en place ».
select 'colonne members.assignable' as objet, case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='assignable') then 'en place' else 'MANQUANT' end as etat
union all select 'fonctions de réglage hors de portée de anon', case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_member_color','set_member_assignable') and not has_function_privilege('anon',p.oid,'execute'))=2 then 'en place' else 'MANQUANT' end
union all select 'aucune rotation partagée avec un membre décoché', case when not exists(select 1 from public.tasks t where t.rotating and exists(select 1 from public.members m where m.id=any(t.people) and not m.assignable) and exists(select 1 from unnest(t.people) p where p not in (select id from public.members where not assignable))) then 'en place' else 'MANQUANT' end;
