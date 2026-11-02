-- Exécuter dans le SQL Editor Supabase, après realtime.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Garde-fous des tâches, pour qu'aucune ne disparaisse sans laisser de trace.
-- Corbeille : toute tâche supprimée y part avec ses validations, le membre qui l'a supprimée et l'heure. Un parent la voit
-- dans « Famille & rappels » et peut la restaurer pendant 90 jours.
-- Dates : une tâche dont aucun des jours cochés ne tombe entre son début et sa fin ne s'afficherait jamais ; elle est refusée.

create table if not exists public.deleted_tasks(id uuid primary key, home uuid not null references public.homes on delete cascade, task jsonb not null, done jsonb not null default '[]', deleted_by uuid references public.members on delete set null, deleted_as text not null, deleted_at timestamptz not null default now());
alter table public.deleted_tasks enable row level security;
drop policy if exists deleted_tasks_read on public.deleted_tasks;
create policy deleted_tasks_read on public.deleted_tasks for select to authenticated using(home=public.my_home() and public.is_parent());
-- Les écritures passent uniquement par le trigger ci-dessous et par restore_task.
revoke insert,update,delete on public.deleted_tasks from anon, authenticated;

-- Avant la suppression, pendant que les validations existent encore (la cascade passe après).
-- deleted_as dit par où la suppression est passée : authenticated (l'application), service_role (le serveur), sinon le rôle SQL.
create or replace function public.archive_task() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into deleted_tasks(id,home,task,done,deleted_by,deleted_as)
 values(old.id,old.home,to_jsonb(old),coalesce((select jsonb_agg(to_jsonb(c)) from completions c where c.task=old.id),'[]'),public.my_member(),
  coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',session_user))
 on conflict(id) do update set task=excluded.task,done=excluded.done,deleted_by=excluded.deleted_by,deleted_as=excluded.deleted_as,deleted_at=now();
 delete from deleted_tasks where deleted_at<now()-interval '90 days';
 return old;
end $$;
drop trigger if exists archive_task on public.tasks;
create trigger archive_task before delete on public.tasks for each row execute function public.archive_task();

-- Restaure la tâche et ses validations. Celles d'un membre supprimé depuis sont laissées de côté.
create or replace function public.restore_task(target uuid) returns void language plpgsql security definer set search_path=public as $$
declare r deleted_tasks;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 select * into r from deleted_tasks where id=target and home=public.my_home() for update;
 if r.id is null then raise exception 'Cette tâche n’est plus dans la corbeille'; end if;
 if exists(select 1 from tasks where id=target) then raise exception 'Cette tâche est déjà restaurée'; end if;
 insert into tasks select * from jsonb_populate_record(null::public.tasks,r.task);
 insert into completions select c.* from jsonb_populate_recordset(null::public.completions,r.done) c where exists(select 1 from members m where m.id=c.actor) on conflict do nothing;
 delete from deleted_tasks where id=target;
end $$;

-- Rattrapage : une tâche déjà enregistrée sans aucune date possible reçoit les jours de sa période, et réapparaît.
update public.tasks t set days=(select array_agg(x order by x) from (select distinct extract(isodow from d)::int x from generate_series(t.starts,least(t.ends,t.starts+6),interval '1 day') d) s)
where t.ends is not null and t.ends>=t.starts and not exists(select 1 from generate_series(t.starts,least(t.ends,t.starts+6),interval '1 day') d where extract(isodow from d)::int=any(t.days));

-- Passe après valid_task (ordre alphabétique), qui refuse déjà une fin avant le début.
create or replace function public.check_task_dates() returns trigger language plpgsql set search_path=public as $$
begin
 if new.ends is not null and not exists(select 1 from generate_series(new.starts,least(new.ends,new.starts+6),interval '1 day') d where extract(isodow from d)::int=any(new.days)) then
  raise exception 'Aucun des jours cochés ne tombe entre le début et la fin';
 end if;
 return new;
end $$;
drop trigger if exists valid_task_dates on public.tasks;
create trigger valid_task_dates before insert or update of starts,ends,days on public.tasks for each row execute function public.check_task_dates();

revoke all on function public.archive_task(),public.restore_task(uuid),public.check_task_dates() from public, anon;
grant execute on function public.restore_task(uuid) to authenticated;

-- Contrôle : les quatre lignes ci-dessous doivent toutes afficher « en place ».
select 'corbeille des tâches supprimées' as objet, case when to_regclass('public.deleted_tasks') is not null and exists(select 1 from pg_trigger where tgname='archive_task' and tgrelid='public.tasks'::regclass) then 'en place' else 'MANQUANT' end as etat
union all select 'restauration hors de portée de anon', case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='restore_task' and not has_function_privilege('anon',p.oid,'execute')) then 'en place' else 'MANQUANT' end
union all select 'tâche sans date possible refusée', case when exists(select 1 from pg_trigger where tgname='valid_task_dates' and tgrelid='public.tasks'::regclass) then 'en place' else 'MANQUANT' end
union all select 'aucune tâche sans date possible', case when not exists(select 1 from public.tasks t where t.ends is not null and not exists(select 1 from generate_series(t.starts,least(t.ends,t.starts+6),interval '1 day') d where extract(isodow from d)::int=any(t.days))) then 'en place' else 'MANQUANT' end;
