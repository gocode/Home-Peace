// Applique les migrations de database/ à la base Supabase désignée par DATABASE_URL (voir .env.local).
// Chaque fichier passe dans sa propre transaction : une erreur annule ce fichier et arrête la suite.
import pg from 'pg';
import {readFileSync,readdirSync} from 'node:fs';

const order=['sms-recovery.sql','share-link.sql','managed-profiles.sql','family-code.sql','invitations.sql','notifications.sql'];
const dir=new URL('../database/',import.meta.url);
const unknown=readdirSync(dir).filter(f=>f.endsWith('.sql')&&f!=='setup.sql'&&!order.includes(f));
if(unknown.length)console.warn('Non appliqués, ordre inconnu : '+unknown.join(', ')+'. Les ajouter à la liste de scripts/migrate.js.');
if(!process.env.DATABASE_URL){console.error('DATABASE_URL manque dans .env.local (Supabase > Connect > Session pooler).');process.exit(1)}

const db=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
let failed=false;
try{
 // setup.sql n'est pas rejouable : il ne passe que sur une base vide.
 const fresh=!(await db.query(`select to_regclass('public.homes') t`)).rows[0].t;
 for(const f of fresh?['setup.sql',...order]:order){
  try{
   await db.query('begin');
   const results=[].concat(await db.query(readFileSync(new URL(f,dir),'utf8')));
   await db.query('commit');
   // Les lignes de contrôle « objet / etat » de chaque fichier.
   const checks=results.flatMap(r=>r.rows??[]).filter(r=>'etat' in r);
   const bad=checks.filter(r=>r.etat!=='en place');
   console.log((bad.length?'✗ ':'✓ ')+f+(checks.length?` (${checks.length-bad.length}/${checks.length} en place)`:''));
   for(const r of bad){console.log('   MANQUANT : '+r.objet);failed=true}
  }catch(e){await db.query('rollback').catch(()=>{});console.error('✗ '+f+' : '+e.message+'\n  Fichier annulé, migrations suivantes non appliquées.');failed=true;break}
 }
}finally{await db.end()}
process.exit(failed?1:0);
