-- Exécuter dans le SQL Editor Supabase, après managed-profiles.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Notifications d'événements : tâche attribuée, tâche à confirmer, tâche confirmée.

-- Un événement n'est annoncé qu'une fois à chaque destinataire. La clé désigne l'événement et la personne prévenue.
create table if not exists public.push_events(key text primary key check(length(key)<=200), created_at timestamptz not null default now());
create index if not exists push_events_created on public.push_events(created_at);
-- Sans aucune politique : seules les fonctions serveur, avec la clé de service, y accèdent.
alter table public.push_events enable row level security;

-- Contrôle : les trois lignes ci-dessous doivent toutes afficher « en place ».
select 'table push_events' as objet, case when to_regclass('public.push_events') is not null then 'en place' else 'MANQUANT' end as etat
union all select 'push_events protégée par RLS', case when (select relrowsecurity from pg_class where oid='public.push_events'::regclass) and not exists(select 1 from pg_policies where schemaname='public' and tablename='push_events') then 'en place' else 'MANQUANT' end
union all select 'abonnements rattachés aux profils', case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='account') then 'en place' else 'MANQUANT : exécuter managed-profiles.sql' end;
