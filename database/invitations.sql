-- Exécuter dans le SQL Editor Supabase, après managed-profiles.sql et family-code.sql.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Invitation d'un parent par e-mail : le lien reçu crée son compte et le rattache au foyer avec le rôle parent.

do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='account') then
  raise exception 'Exécuter d''abord database/managed-profiles.sql';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='homes' and column_name='code') then
  raise exception 'Exécuter d''abord database/family-code.sql';
 end if;
end $$;

create table if not exists public.invitations(
 id uuid primary key default gen_random_uuid(),
 home uuid not null references public.homes on delete cascade,
 email text not null check(length(email)<=254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 name text not null check(length(name) between 1 and 40),
 role text not null default 'parent' check(role in ('parent','enfant')),
 invited_by uuid references public.members on delete set null,
 sent_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days'
);
create unique index if not exists invitations_home_email on public.invitations(home,email);
alter table public.invitations enable row level security;
-- Seuls les parents du foyer voient les invitations en attente ; toute écriture passe par les fonctions ci-dessous.
drop policy if exists invitations_read on public.invitations;
create policy invitations_read on public.invitations for select to authenticated using(home=public.my_home() and public.is_parent());

-- Chaque envoi d'e-mail laisse une trace : dix par foyer et par jour au plus.
create table if not exists public.invitation_sends(home uuid not null references public.homes on delete cascade, at timestamptz not null default now());
create index if not exists invitation_sends_home_at on public.invitation_sends(home,at);
alter table public.invitation_sends enable row level security;

-- Création ou renvoi d'une invitation. L'envoi de l'e-mail lui-même revient au serveur (/api/invite).
create or replace function public.invite_member(display_name text, mail text) returns uuid language plpgsql security definer set search_path=public as $$
declare h uuid; e text; v uuid;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 h:=public.my_home();
 if display_name is null or length(btrim(display_name)) not between 1 and 40 then raise exception 'Prénom attendu, 40 caractères au plus'; end if;
 e:=lower(btrim(coalesce(mail,'')));
 if length(e)>254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Adresse e-mail invalide'; end if;
 perform pg_advisory_xact_lock(hashtext('invite:'||h::text));
 if exists(select 1 from members m join auth.users u on u.id=m.account where m.home=h and lower(u.email)=e) then
  raise exception 'Cette personne fait déjà partie de la famille';
 end if;
 if exists(select 1 from invitations where home=h and email=e and sent_at>now()-interval '1 minute') then
  raise exception 'Invitation déjà envoyée à l''instant : patiente une minute avant de la renvoyer';
 end if;
 if (select count(*) from invitation_sends where home=h and at>now()-interval '1 day')>=10 then
  raise exception 'Dix invitations envoyées aujourd''hui : réessaie demain';
 end if;
 insert into invitations(home,email,name,role,invited_by) values(h,e,btrim(display_name),'parent',public.my_member())
  on conflict(home,email) do update set name=excluded.name,invited_by=excluded.invited_by,sent_at=now(),expires_at=now()+interval '7 days'
  returning id into v;
 insert into invitation_sends(home) values(h);
 return v;
end $$;

create or replace function public.cancel_invitation(target uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 delete from invitations where id=target and home=public.my_home();
 if not found then raise exception 'Invitation introuvable'; end if;
end $$;

-- Appelée à la connexion d'un compte sans profil : une invitation valable pour son adresse confirmée le fait entrer dans le foyer.
create or replace function public.accept_invitation() returns boolean language plpgsql security definer set search_path=public as $$
declare e text; i public.invitations;
begin
 if auth.uid() is null then return false; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if exists(select 1 from members where account=auth.uid()) then return false; end if;
 -- Une adresse non confirmée ne prouve rien : sans cette condition, s'inscrire avec l'adresse invitée suffirait.
 select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if e is null then return false; end if;
 select * into i from invitations where email=e and expires_at>now() order by sent_at desc limit 1;
 if i.id is null then return false; end if;
 insert into members(home,name,role,color,account) values(i.home,i.name,i.role,
  (array['#4169e1','#ae368a','#087f73','#b35a09','#744ac7'])[1+floor(random()*5)::int],auth.uid());
 delete from invitations where email=e;
 return true;
end $$;

revoke all on function public.invite_member(text,text),public.cancel_invitation(uuid),public.accept_invitation() from public, anon;
grant execute on function public.invite_member(text,text),public.cancel_invitation(uuid),public.accept_invitation() to authenticated;

-- Contrôle : les quatre lignes ci-dessous doivent toutes afficher « en place ».
select 'table invitations' as objet, case when exists(select 1 from information_schema.tables where table_schema='public' and table_name='invitations') then 'en place' else 'MANQUANT' end as etat
union all select 'invitations protégées', case when (select relrowsecurity from pg_class where oid='public.invitations'::regclass) and (select relrowsecurity from pg_class where oid='public.invitation_sends'::regclass) then 'en place' else 'MANQUANT' end
union all select 'fonctions d''invitation', case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('invite_member','cancel_invitation','accept_invitation'))=3 then 'en place' else 'MANQUANT' end
union all select 'invitations hors de portée de anon', case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('invite_member','cancel_invitation','accept_invitation') and has_function_privilege('anon',p.oid,'execute')) then 'en place' else 'MANQUANT' end;
