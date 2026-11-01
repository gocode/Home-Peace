-- Exécuter dans le SQL Editor Supabase, après awards.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Mises à jour en direct : Supabase Realtime diffuse aux écrans ouverts les changements des tâches, des validations et des membres.
-- Chaque écran ne reçoit que ce que la sécurité par ligne lui laisse lire, comme pour une lecture ordinaire. Seules les suppressions
-- échappent à ce filtre : elles n'emportent que l'identifiant de la ligne (identité de réplication par défaut, à ne pas passer en « full »).

do $$
declare t text;
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
 foreach t in array array['tasks','completions','members'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;

-- Contrôle : les quatre lignes ci-dessous doivent toutes afficher « en place ».
select 'tasks diffusée en direct' as objet, case when exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tasks') then 'en place' else 'MANQUANT' end as etat
union all select 'completions diffusée en direct', case when exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='completions') then 'en place' else 'MANQUANT' end
union all select 'members diffusée en direct', case when exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='members') then 'en place' else 'MANQUANT' end
union all select 'suppressions réduites à l''identifiant', case when not exists(select 1 from pg_class where oid in ('public.tasks'::regclass,'public.completions'::regclass,'public.members'::regclass) and relreplident='f') then 'en place' else 'MANQUANT : identité de réplication « full » sur une table diffusée' end;
