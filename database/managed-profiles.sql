-- Exécuter dans le SQL Editor Supabase, après setup.sql, sms-recovery.sql et share-link.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Profils gérés : un membre n'a plus besoin d'un compte. Les profils existants gardent leur identifiant.

-- 1. Le compte devient une propriété facultative du profil, au lieu d'en être l'identité.
alter table public.members add column if not exists account uuid references auth.users on delete set null;
create unique index if not exists members_account_unique on public.members(account) where account is not null;
update public.members set account=id where account is null and exists(select 1 from auth.users u where u.id=members.id);
do $$ declare c text;
begin
 select conname into c from pg_constraint
  where conrelid='public.members'::regclass and contype='f' and pg_get_constraintdef(oid) like '%auth.users%'
    and conkey=array[(select attnum from pg_attribute where attrelid='public.members'::regclass and attname='id')];
 if c is not null then execute format('alter table public.members drop constraint %I',c); end if;
end $$;
alter table public.members alter column id set default gen_random_uuid();
-- Lien dédié d'un profil géré.
alter table public.members add column if not exists share uuid;
create unique index if not exists members_share_unique on public.members(share) where share is not null;

-- 2. L'appartenance se lit désormais par le compte rattaché au profil.
create or replace function public.my_member() returns uuid language sql stable security definer set search_path=public as $$ select id from members where account=auth.uid() $$;
create or replace function public.my_home() returns uuid language sql stable security definer set search_path=public as $$ select home from members where account=auth.uid() $$;
create or replace function public.is_parent() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role='parent' from members where account=auth.uid()),false) $$;
grant execute on function public.my_member() to authenticated;

-- 3. Création du profil du titulaire du compte.
create or replace function public.enter_home(display_name text, invitation uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare h uuid;
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if exists(select 1 from members where account=auth.uid()) then raise exception 'Profil déjà créé'; end if;
 if invitation is null then insert into homes(name) values('Notre famille') returning id into h;
 else select id into h from homes where invite=invitation; if h is null then raise exception 'Code famille invalide'; end if; end if;
 insert into members(home,name,role,color,account) values(h,display_name,case when invitation is null then 'parent' else 'enfant' end,
  (array['#4169e1','#ae368a','#087f73','#b35a09','#744ac7'])[1+floor(random()*5)::int],auth.uid());
end $$;

-- 4. Profils gérés par un parent : création, renommage, suppression.
create or replace function public.create_member(display_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 if display_name is null or length(btrim(display_name)) not between 1 and 40 then raise exception 'Prénom attendu, 40 caractères au plus'; end if;
 insert into members(home,name,role,color) values(public.my_home(),btrim(display_name),'enfant',
  (array['#4169e1','#ae368a','#087f73','#b35a09','#744ac7'])[1+floor(random()*5)::int]) returning id into v;
 return v;
end $$;
create or replace function public.rename_member(target uuid, display_name text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 if display_name is null or length(btrim(display_name)) not between 1 and 40 then raise exception 'Prénom attendu, 40 caractères au plus'; end if;
 update members set name=btrim(display_name) where id=target and home=public.my_home();
 if not found then raise exception 'Membre introuvable'; end if;
end $$;
-- Un profil rattaché à un compte ne se supprime pas depuis l'application : son titulaire garde la main dessus.
create or replace function public.remove_member(target uuid) returns void language plpgsql security definer set search_path=public as $$
declare m public.members;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 select * into m from members where id=target and home=public.my_home();
 if m.id is null then raise exception 'Membre introuvable'; end if;
 if m.account is not null then raise exception 'Ce profil appartient à un compte : il ne se supprime pas ici'; end if;
 if exists(select 1 from tasks where home=m.home and m.id=any(people)) then raise exception 'Retire ce membre des tâches qui lui sont attribuées avant de le supprimer'; end if;
 delete from members where id=target;
end $$;
-- Lien dédié, réservé aux profils sans compte : pour un compte, ce serait contourner son mot de passe.
create or replace function public.set_member_share(target uuid, enabled boolean) returns uuid language plpgsql security definer set search_path=public as $$
declare m public.members; v uuid;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 select * into m from members where id=target and home=public.my_home();
 if m.id is null then raise exception 'Membre introuvable'; end if;
 if m.account is not null and enabled then raise exception 'Ce profil possède un compte : il se connecte avec son mot de passe'; end if;
 update members set share=case when enabled then gen_random_uuid() else null end where id=target returning share into v;
 return v;
end $$;
revoke all on function public.create_member(text),public.rename_member(uuid,text),public.remove_member(uuid),public.set_member_share(uuid,boolean) from public, anon;
grant execute on function public.create_member(text),public.rename_member(uuid,text),public.remove_member(uuid),public.set_member_share(uuid,boolean) to authenticated;

-- 5. Validation des tâches, rapportée au profil et non plus au compte.
create or replace function public.mark_task(task_id uuid, task_day date, action text) returns void language plpgsql security definer set search_path=public as $$
declare t public.tasks; parent boolean; me uuid;
begin
 me:=public.my_member();
 if me is null then raise exception 'Connexion requise'; end if;
 select * into t from tasks where id=task_id and home=public.my_home();
 if t.id is null then raise exception 'Tâche inaccessible'; end if;
 parent:=public.is_parent();
 if task_day<t.starts or (t.ends is not null and task_day>t.ends) or not(extract(isodow from task_day)::int=any(t.days)) then raise exception 'Date invalide'; end if;
 if task_day>(now() at time zone 'Europe/Paris')::date then raise exception 'Cette tâche est prévue plus tard'; end if;
 if not parent and public.task_person(t,task_day)<>me then raise exception 'Cette tâche est attribuée à une autre personne'; end if;
 if action='done' then insert into completions(task,day,actor,approved) values(t.id,task_day,me,parent or not t.approval) on conflict(task,day) do nothing;
 elsif action='undo' then delete from completions where task=t.id and day=task_day;
 elsif action='approve' and parent then update completions set approved=true where task=t.id and day=task_day;
 else raise exception 'Action interdite'; end if;
end $$;
-- Validation depuis un lien dédié : le serveur seul appelle cette fonction, et la confirmation parentale lui reste interdite.
create or replace function public.mark_task_as(actor_member uuid, task_id uuid, task_day date, action text) returns text language plpgsql security definer set search_path=public as $$
declare t public.tasks; m public.members;
begin
 select * into m from members where id=actor_member;
 if m.id is null then return 'membre'; end if;
 select * into t from tasks where id=task_id and home=m.home;
 if t.id is null then return 'tache'; end if;
 if task_day<t.starts or (t.ends is not null and task_day>t.ends) or not(extract(isodow from task_day)::int=any(t.days)) then return 'date'; end if;
 if task_day>(now() at time zone 'Europe/Paris')::date then return 'futur'; end if;
 if public.task_person(t,task_day)<>actor_member then return 'autre'; end if;
 if action='done' then insert into completions(task,day,actor,approved) values(t.id,task_day,actor_member,not t.approval) on conflict(task,day) do nothing;
 elsif action='undo' then delete from completions where task=t.id and day=task_day and actor=actor_member;
 else return 'action'; end if;
 return 'ok';
end $$;
revoke all on function public.mark_task_as(uuid,uuid,date,text) from public, anon, authenticated;
grant execute on function public.mark_task_as(uuid,uuid,date,text) to service_role;

-- 6. Le numéro de mobile suit le profil du titulaire du compte.
create or replace function public.set_phone(target uuid, mobile text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 if mobile is not null and mobile !~ '^33[67][0-9]{8}$' then raise exception 'Numéro de mobile français attendu'; end if;
 if target<>public.my_member() and not public.is_parent() then raise exception 'Accès parent requis'; end if;
 update members set phone=mobile where id=target and home=public.my_home();
 if not found then raise exception 'Membre introuvable'; end if;
exception when unique_violation then raise exception 'Ce numéro est déjà enregistré pour un autre membre';
end $$;

-- Contrôle : les huit lignes ci-dessous doivent toutes afficher « en place ».
select 'colonne members.account' as objet, case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='account') then 'en place' else 'MANQUANT' end as etat
union all select 'colonne members.share', case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='share') then 'en place' else 'MANQUANT' end
union all select 'members.id affranchi de auth.users', case when not exists(select 1 from pg_constraint where conrelid='public.members'::regclass and contype='f' and pg_get_constraintdef(oid) like '%auth.users%' and conkey=array[(select attnum from pg_attribute where attrelid='public.members'::regclass and attname='id')]) then 'en place' else 'MANQUANT' end
union all select 'identifiant de profil autonome', case when (select column_default from information_schema.columns where table_schema='public' and table_name='members' and column_name='id') like '%gen_random_uuid%' then 'en place' else 'MANQUANT' end
union all select 'profils existants rattachés', case when not exists(select 1 from members m join auth.users u on u.id=m.id where m.account is null) then 'en place' else 'MANQUANT' end
union all select 'fonctions de gestion des profils', case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_member','rename_member','remove_member','set_member_share','my_member'))=5 then 'en place' else 'MANQUANT' end
union all select 'validation par lien réservée au serveur', case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='mark_task_as' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then 'en place' else 'MANQUANT' end
union all select 'gestion des profils hors de portée de anon', case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_member','rename_member','remove_member','set_member_share') and has_function_privilege('anon',p.oid,'execute')) then 'en place' else 'MANQUANT' end;
