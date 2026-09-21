-- Exécuter une fois dans le SQL Editor Supabase, après database/setup.sql.
-- Récupération de mot de passe par SMS : mobile par membre, codes à usage unique, garde-fous de dépense.
alter table public.members add column phone text;
alter table public.members add constraint members_phone_format check(phone is null or phone ~ '^33[67][0-9]{8}$');
create unique index members_phone_unique on public.members(phone) where phone is not null;
-- Chacun renseigne son mobile ; un parent renseigne aussi celui des enfants de son foyer.
create function public.set_phone(target uuid, mobile text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 if mobile is not null and mobile !~ '^33[67][0-9]{8}$' then raise exception 'Numéro de mobile français attendu'; end if;
 if target<>auth.uid() and not public.is_parent() then raise exception 'Accès parent requis'; end if;
 update members set phone=mobile where id=target and home=public.my_home();
 if not found then raise exception 'Membre introuvable'; end if;
exception when unique_violation then raise exception 'Ce numéro est déjà enregistré pour un autre membre';
end $$;
revoke all on function public.set_phone(uuid,text) from public;
grant execute on function public.set_phone(uuid,text) to authenticated;
-- Un seul code vivant par personne. Le code n'est jamais stocké en clair.
create table public.recovery_codes(user_id uuid primary key references public.members on delete cascade, code_hash text not null, expires_at timestamptz not null, attempts integer not null default 0, sent_at timestamptz not null default now(), sent_day date not null, sent_count integer not null default 1);
create table public.sms_budget(day date primary key, count integer not null default 0);
alter table public.recovery_codes enable row level security;
alter table public.sms_budget enable row level security;
-- Aucune politique : ces deux tables ne sont atteignables que par les fonctions serveur (clé service_role).
revoke all on public.recovery_codes from anon, authenticated;
revoke all on public.sms_budget from anon, authenticated;
-- Demande de code : au plus un SMS par minute et par personne, per_user_cap par jour, daily_cap pour toute la base.
create function public.start_recovery(target uuid, hash text, daily_cap integer default 20, per_user_cap integer default 5) returns text language plpgsql security definer set search_path=public as $$
declare r public.recovery_codes; today date:=(now() at time zone 'Europe/Paris')::date;
begin
 perform pg_advisory_xact_lock(hashtext('recovery:'||target::text));
 select * into r from recovery_codes where user_id=target;
 if r.user_id is not null and r.sent_at>now()-interval '60 seconds' then return 'attente'; end if;
 if r.user_id is not null and r.sent_day=today and r.sent_count>=per_user_cap then return 'quota'; end if;
 if coalesce((select count from sms_budget where day=today),0)>=daily_cap then return 'budget'; end if;
 insert into sms_budget(day,count) values(today,1) on conflict(day) do update set count=sms_budget.count+1;
 insert into recovery_codes(user_id,code_hash,expires_at,sent_day) values(target,hash,now()+interval '10 minutes',today)
  on conflict(user_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,sent_at=now(),sent_day=today,
   sent_count=case when recovery_codes.sent_day=today then recovery_codes.sent_count+1 else 1 end;
 return 'ok';
end $$;
-- Vérification : le code est consommé au premier succès, et abandonné après 5 essais.
create function public.check_recovery(target uuid, hash text) returns text language plpgsql security definer set search_path=public as $$
declare r public.recovery_codes;
begin
 select * into r from recovery_codes where user_id=target for update;
 if r.user_id is null then return 'absent'; end if;
 if r.expires_at<now() then delete from recovery_codes where user_id=target; return 'expire'; end if;
 if r.attempts>=5 then delete from recovery_codes where user_id=target; return 'bloque'; end if;
 if r.code_hash<>hash then update recovery_codes set attempts=attempts+1 where user_id=target; return 'faux'; end if;
 delete from recovery_codes where user_id=target; return 'ok';
end $$;
revoke all on function public.start_recovery(uuid,text,integer,integer),public.check_recovery(uuid,text) from public;
grant execute on function public.start_recovery(uuid,text,integer,integer),public.check_recovery(uuid,text) to service_role;
