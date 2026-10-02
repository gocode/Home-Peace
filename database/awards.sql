-- Exécuter dans le SQL Editor Supabase, après managed-profiles.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Récompenses de groupe : la vitrine de la famille.
-- 🏅 Médaille : une journée où toutes les tâches de la famille ont été déclarées faites.
-- 🏆 Coupe : une semaine, du lundi au dimanche, où toutes les tâches de la famille ont été déclarées faites.
-- Une journée sans aucune tâche ne rapporte rien et n'empêche rien. Les journées à venir de la semaine en cours
-- comptent déjà : la coupe n'est gagnée qu'une fois la dernière tâche de la semaine cochée.

create or replace function public.home_awards(h uuid) returns table(medals integer, trophies integer) language sql stable security definer set search_path=public as $$
 with bounds as (select (now() at time zone 'Europe/Paris')::date as today),
 due as (
  select d.day, exists(select 1 from completions c where c.task=t.id and c.day=d.day) as done
  from tasks t cross join bounds b
  cross join lateral (select t.starts+i as day from generate_series(0,least(coalesce(t.ends,b.today+6),b.today+7-extract(isodow from b.today)::int)-t.starts) i) d
  where t.home=h and extract(isodow from d.day)::int=any(t.days)),
 daily as (select due.day, bool_and(due.done) as ok from due group by due.day),
 weekly as (select daily.day-(extract(isodow from daily.day)::int-1) as monday, bool_and(daily.ok) as ok from daily group by 1)
 select (select count(*) from daily where ok)::int, (select count(*) from weekly where ok)::int
$$;

-- La vitrine de sa propre famille, pour l'application.
create or replace function public.awards() returns table(medals integer, trophies integer) language sql stable security definer set search_path=public as $$
 select * from public.home_awards(public.my_home())
$$;

-- home_awards prend un foyer quelconque : réservée au serveur (lien personnel, notifications).
revoke all on function public.home_awards(uuid) from public, anon, authenticated;
grant execute on function public.home_awards(uuid) to service_role;
revoke all on function public.awards() from public, anon;
grant execute on function public.awards() to authenticated;

-- Contrôle : les deux lignes ci-dessous doivent toutes afficher « en place ».
select 'fonction awards pour les comptes' as objet, case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='awards' and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) then 'en place' else 'MANQUANT' end as etat
union all select 'home_awards réservée au serveur', case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='home_awards' and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')) then 'en place' else 'MANQUANT' end;
