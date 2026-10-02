-- Exécuter dans le SQL Editor Supabase, après les migrations précédentes.
-- Rejouable : relancer ce fichier en entier ne produit aucune erreur.
-- Le code famille devient notable à la main : huit caractères, sans I, L, O ni U, donc sans confusion possible.

create or replace function public.new_invite() returns text language sql volatile set search_path=public as $$
 select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',1+floor(random()*32)::int,1),'') from generate_series(1,8)
$$;

alter table public.homes add column if not exists code text;
update public.homes set code=public.new_invite() where code is null;
create unique index if not exists homes_code_unique on public.homes(code);
do $$ begin
 if exists(select 1 from public.homes where code is null) then raise exception 'Un foyer sans code subsiste'; end if;
end $$;
alter table public.homes alter column code set not null;
-- L'ancien code illisible n'a plus d'usage : chaque foyer retrouve le sien dans « Famille & rappels ».
alter table public.homes drop column if exists invite;

-- Les deux fonctions changent de signature, donc l'ancienne version doit disparaître.
drop function if exists public.enter_home(text,uuid);
drop function if exists public.rotate_invite();

create or replace function public.enter_home(display_name text, invitation text default null) returns void language plpgsql security definer set search_path=public as $$
declare h uuid; c text;
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if exists(select 1 from members where account=auth.uid()) then raise exception 'Profil déjà créé'; end if;
 c:=nullif(btrim(coalesce(invitation,'')),'');
 if c is null then insert into homes(name,code) values('Notre famille',public.new_invite()) returning id into h;
 else
  -- Mêmes indulgences qu'à la saisie : espaces, tirets, minuscules et sosies de caractères.
  c:=translate(upper(regexp_replace(c,'[^0-9A-Za-z]','','g')),'OIL','011');
  select id into h from homes where code=c;
  if h is null then raise exception 'Code famille invalide'; end if;
 end if;
 insert into members(home,name,role,color,account) values(h,display_name,case when invitation is null or btrim(invitation)='' then 'parent' else 'enfant' end,
  (array['#4169e1','#ae368a','#087f73','#b35a09','#744ac7'])[1+floor(random()*5)::int],auth.uid());
end $$;

create or replace function public.rotate_invite() returns text language plpgsql security definer set search_path=public as $$
declare v text;
begin
 if not public.is_parent() then raise exception 'Accès parent requis'; end if;
 update homes set code=public.new_invite() where id=public.my_home() returning code into v;
 return v;
end $$;

revoke all on function public.enter_home(text,text),public.rotate_invite(),public.new_invite() from public, anon;
grant execute on function public.enter_home(text,text),public.rotate_invite() to authenticated;

-- Contrôle : les quatre lignes ci-dessous doivent toutes afficher « en place ».
select 'colonne homes.code' as objet, case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='homes' and column_name='code' and is_nullable='NO') then 'en place' else 'MANQUANT' end as etat
union all select 'ancien code retiré', case when not exists(select 1 from information_schema.columns where table_schema='public' and table_name='homes' and column_name='invite') then 'en place' else 'MANQUANT' end
union all select 'une seule version de enter_home', case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enter_home')=1 then 'en place' else 'MANQUANT' end
union all select 'codes attribués', case when not exists(select 1 from public.homes where code is null or length(code)<>8) then 'en place' else 'MANQUANT' end;

-- Le code de chaque foyer, à relever puis à transmettre à la famille.
select name as foyer, code as "code famille" from public.homes order by name;
