-- Exécuter dans le SQL Editor Supabase, après managed-profiles.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Séries 🔥 : nombre de jours d'affilée où un membre a déclaré faites toutes ses tâches.

-- Une journée sans tâche pour le membre ne compte pas et ne casse rien. Aujourd'hui, tant qu'il reste une tâche,
-- la série continue sur hier : elle ne se rompt qu'à la première journée passée incomplète. Fenêtre d'un an.
-- Une tâche déclarée faite compte, même en attente de confirmation : l'enfant voit sa série avancer aussitôt.
create or replace function public.home_streaks(h uuid) returns table(member uuid, streak integer) language sql stable security definer set search_path=public as $$
 with bounds as (select (now() at time zone 'Europe/Paris')::date as today),
 due as (
  select public.task_person(t,d.day) as member, d.day, exists(select 1 from completions c where c.task=t.id and c.day=d.day) as done
  from tasks t cross join bounds b
  cross join lateral (select greatest(t.starts,b.today-365)+i as day from generate_series(0,least(coalesce(t.ends,b.today),b.today)-greatest(t.starts,b.today-365)) i) d
  where t.home=h and extract(isodow from d.day)::int=any(t.days)),
 daily as (select due.member, due.day, bool_and(due.done) as ok from due group by due.member, due.day),
 broken as (select daily.member, max(daily.day) as last from daily, bounds b where not daily.ok and daily.day<b.today group by daily.member)
 select m.id, count(d.day)::int
 from members m
 left join broken k on k.member=m.id
 left join daily d on d.member=m.id and d.ok and d.day>coalesce(k.last,'-infinity'::date)
 where m.home=h
 group by m.id
$$;

-- Les séries de sa propre famille, pour l'application.
create or replace function public.streaks() returns table(member uuid, streak integer) language sql stable security definer set search_path=public as $$
 select * from public.home_streaks(public.my_home())
$$;

-- home_streaks prend un foyer quelconque : réservée au serveur (lien personnel, notifications).
revoke all on function public.home_streaks(uuid) from public, anon, authenticated;
grant execute on function public.home_streaks(uuid) to service_role;
revoke all on function public.streaks() from public, anon;
grant execute on function public.streaks() to authenticated;

-- Contrôle : les deux lignes ci-dessous doivent toutes afficher « en place ».
select 'fonction streaks pour les comptes' as objet, case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='streaks' and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) then 'en place' else 'MANQUANT' end as etat
union all select 'home_streaks réservée au serveur', case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='home_streaks' and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')) then 'en place' else 'MANQUANT' end;
