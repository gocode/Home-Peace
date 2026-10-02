-- Exécuter dans le SQL Editor Supabase, après managed-profiles.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Mémoire des tâches déjà attribuées, proposées à la saisie d'une nouvelle tâche. Elle survit à la suppression des tâches.

create table if not exists public.task_memory(home uuid not null references public.homes on delete cascade, title text not null check(length(title) between 1 and 100), person uuid references public.members on delete set null, uses integer not null default 1, used_at timestamptz not null default now(), primary key(home,title));
alter table public.task_memory enable row level security;
drop policy if exists memory_read on public.task_memory;
create policy memory_read on public.task_memory for select to authenticated using(home=public.my_home());
-- Les écritures passent uniquement par remember_tasks.

-- Enregistre des couples (titre, personne) : un titre déjà connu gagne une utilisation et retient la dernière personne.
create or replace function public.remember_tasks(titles text[], people uuid[]) returns void language plpgsql security definer set search_path=public as $$
declare h uuid:=public.my_home(); i integer;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 if cardinality(titles) is distinct from cardinality(people) or cardinality(titles)>50 then raise exception 'Requête invalide'; end if;
 for i in 1..coalesce(cardinality(titles),0) loop
  continue when length(trim(titles[i])) not between 1 and 100;
  insert into task_memory(home,title,person) values(h,trim(titles[i]),(select id from members where id=people[i] and home=h))
  on conflict(home,title) do update set uses=task_memory.uses+1,used_at=now(),person=coalesce(excluded.person,task_memory.person);
 end loop;
end $$;

-- Oublie un titre proposé.
create or replace function public.forget_task(target text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 delete from task_memory where home=public.my_home() and title=target;
end $$;

revoke all on function public.remember_tasks(text[],uuid[]),public.forget_task(text) from public, anon;
grant execute on function public.remember_tasks(text[],uuid[]),public.forget_task(text) to authenticated;

-- Les tâches déjà créées alimentent la mémoire dès la mise en place.
insert into public.task_memory(home,title,person,uses,used_at)
select t.home,t.title,m.id,t.uses,t.used_at from (select home,title,(array_agg(people[1] order by created_at desc nulls last))[1] person,count(*) uses,coalesce(max(created_at),now()) used_at from public.tasks group by home,title) t
left join public.members m on m.id=t.person and m.home=t.home
on conflict(home,title) do nothing;

-- Contrôle : les trois lignes ci-dessous doivent toutes afficher « en place ».
select 'table task_memory' as objet, case when to_regclass('public.task_memory') is not null then 'en place' else 'MANQUANT' end as etat
union all select 'task_memory protégée par RLS', case when (select relrowsecurity from pg_class where oid='public.task_memory'::regclass) then 'en place' else 'MANQUANT' end
union all select 'fonctions de mémoire hors de portée de anon', case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('remember_tasks','forget_task') and not has_function_privilege('anon',p.oid,'execute'))=2 then 'en place' else 'MANQUANT' end;
