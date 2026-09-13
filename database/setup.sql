-- Exécuter une fois dans le SQL Editor Supabase.
create table public.homes(id uuid primary key default gen_random_uuid(), name text not null, invite uuid not null unique default gen_random_uuid());
create table public.members(id uuid primary key references auth.users on delete cascade, home uuid not null references public.homes, name text not null check(length(name) between 1 and 40), role text not null check(role in ('parent','enfant')), color text not null default '#4169e1');
create function public.my_home() returns uuid language sql stable security definer set search_path=public as $$ select home from members where id=auth.uid() $$;
create function public.is_parent() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role='parent' from members where id=auth.uid()),false) $$;
create table public.tasks(id uuid primary key default gen_random_uuid(), home uuid not null references public.homes, title text not null check(length(title) between 1 and 100), people uuid[] not null check(cardinality(people)>0), days integer[] not null, starts date not null default current_date, ends date, rotating boolean not null default false, approval boolean not null default false, created_at timestamptz default now());
create table public.completions(task uuid references public.tasks on delete cascade, day date not null, actor uuid not null references public.members, approved boolean not null default false, primary key(task,day));
create table public.push_subscriptions(endpoint text primary key, user_id uuid not null references public.members on delete cascade, subscription jsonb not null);
create table public.deliveries(user_id uuid references public.members on delete cascade, day date, primary key(user_id,day));
alter table public.homes enable row level security;
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.completions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.deliveries enable row level security;
create policy home_read on public.homes for select to authenticated using(id=public.my_home());
create policy member_read on public.members for select to authenticated using(home=public.my_home());
create policy tasks_read on public.tasks for select to authenticated using(home=public.my_home());
create policy tasks_insert on public.tasks for insert to authenticated with check(home=public.my_home() and public.is_parent());
create policy tasks_update on public.tasks for update to authenticated using(home=public.my_home() and public.is_parent()) with check(home=public.my_home() and public.is_parent());
create policy tasks_delete on public.tasks for delete to authenticated using(home=public.my_home() and public.is_parent());
create policy done_read on public.completions for select to authenticated using(exists(select 1 from tasks where tasks.id=task and home=public.my_home()));
-- Les écritures de validation passent uniquement par la fonction contrôlée ci-dessous.
create function public.enter_home(display_name text, invitation uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare h uuid;
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if exists(select 1 from members where id=auth.uid()) then raise exception 'Profil déjà créé'; end if;
 if invitation is null then insert into homes(name) values('Notre famille') returning id into h;
 else select id into h from homes where invite=invitation; if h is null then raise exception 'Code famille invalide'; end if; end if;
 insert into members(id,home,name,role,color) values(auth.uid(),h,display_name,case when invitation is null then 'parent' else 'enfant' end, (array['#4169e1','#ae368a','#087f73','#b35a09','#744ac7'])[1+floor(random()*5)::int]);
end $$;
create function public.task_person(t public.tasks, d date) returns uuid language sql immutable as $$ select t.people[case when t.rotating then 1+(((d-t.starts)/7)%cardinality(t.people)) else 1 end] $$;
create function public.mark_task(task_id uuid, task_day date, action text) returns void language plpgsql security definer set search_path=public as $$
declare t public.tasks; parent boolean;
begin
 select * into t from tasks where id=task_id and home=public.my_home();
 if t.id is null then raise exception 'Tâche inaccessible'; end if;
 parent:=public.is_parent();
 if task_day<t.starts or (t.ends is not null and task_day>t.ends) or not(extract(isodow from task_day)::int=any(t.days)) then raise exception 'Date invalide'; end if;
 if task_day>(now() at time zone 'Europe/Paris')::date then raise exception 'Cette tâche est prévue plus tard'; end if;
 if not parent and public.task_person(t,task_day)<>auth.uid() then raise exception 'Cette tâche est attribuée à une autre personne'; end if;
 if action='done' then insert into completions(task,day,actor,approved) values(t.id,task_day,auth.uid(),parent or not t.approval) on conflict(task,day) do nothing;
 elsif action='undo' then delete from completions where task=t.id and day=task_day;
 elsif action='approve' and parent then update completions set approved=true where task=t.id and day=task_day;
 else raise exception 'Action interdite'; end if;
end $$;
create function public.rotate_invite() returns uuid language plpgsql security definer set search_path=public as $$ declare v uuid; begin if not public.is_parent() then raise exception 'Accès parent requis'; end if; update homes set invite=gen_random_uuid() where id=public.my_home() returning invite into v; return v; end $$;
revoke all on function public.enter_home(text,uuid),public.mark_task(uuid,date,text),public.rotate_invite() from public;
grant execute on function public.enter_home(text,uuid),public.mark_task(uuid,date,text),public.rotate_invite() to authenticated;
-- Pour ajouter un deuxième parent, modifier son rôle dans Table Editor > members.
create table public.push_tests(user_id uuid references public.members on delete cascade, minute text, primary key(user_id,minute));
alter table public.push_tests enable row level security;
-- Interdire l'ajout de personnes appartenant à une autre famille dans une tâche.
create function public.check_task_people() returns trigger language plpgsql set search_path=public as $$ begin
 if exists(select 1 from unnest(new.people) as p where not exists(select 1 from public.members m where m.id=p and m.home=new.home)) then raise exception 'Membre hors famille'; end if;
 if exists(select 1 from unnest(new.days) d where d<1 or d>7) or cardinality(new.days)=0 then raise exception 'Jours invalides'; end if;
 if new.ends<new.starts then raise exception 'Dates invalides'; end if;
 return new; end $$;
create trigger valid_task before insert or update on public.tasks for each row execute function public.check_task_people();
