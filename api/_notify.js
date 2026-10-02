// Envoi des notifications, partagé par /api/push et /api/planning. Le préfixe _ tient ce fichier hors des routes Vercel.
import webpush from 'web-push';
export const pushReady=env=>['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'].every(k=>env[k]);
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jour=/^\d{4}-\d{2}-\d{2}$/;
export function database(env){return async function db(path,method='GET',body){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok){const e=Error('Erreur de base de données');e.status=r.status;throw e}return r.status===204?null:r.json()}}
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(new Date());
const at=s=>new Date(s+'T12:00:00Z');
export const addDays=(s,n)=>{const d=at(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
export const occurs=(t,d)=>d>=t.starts&&(!t.ends||d<=t.ends)&&t.days.includes(at(d).getUTCDay()||7);
export const person=(t,d)=>{const w=Math.floor((Date.parse(d)-Date.parse(t.starts))/604800000),n=t.people.length;return t.people[t.rotating?((w%n)+n)%n:0]};
const quand=d=>{const j=today();return d===j?"aujourd'hui":d===addDays(j,1)?'demain':d===addDays(j,-1)?'hier':'le '+at(d).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'})};
// Page ouverte au clic : l'application pour un compte, le lien personnel pour un profil géré.
export const pageOf=m=>!m.account&&m.share?'/planning.html?token='+m.share:'/';

export function notifier(env){
 const db=database(env);
 webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
 async function send(sub,payload){try{await webpush.sendNotification(sub.subscription,JSON.stringify(payload),{TTL:3600,timeout:10000});return true}catch(e){if(e.statusCode===410||e.statusCode===404){await db('push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint),'DELETE');return false}throw e}}
 // Un événement n'est annoncé qu'une fois par destinataire : la clé est posée avant l'envoi, retirée si aucun appareil ne l'a reçu.
 async function deliver(recipients,make,key){
  if(!recipients.length)return 0;
  const subs=await db('push_subscriptions?select=*&user_id=in.('+recipients.map(m=>m.id).join(',')+')');
  let sent=0;
  for(const m of recipients){const devices=subs.filter(s=>s.user_id===m.id);if(!devices.length)continue;
   const k=key+':'+m.id;
   try{await db('push_events','POST',{key:k})}catch(e){if(e.status===409)continue;throw e}
   const payload={...make(m),url:pageOf(m)};
   if((await Promise.all(devices.map(s=>send(s,payload).catch(()=>false)))).some(Boolean))sent++;
   else await db('push_events?key=eq.'+encodeURIComponent(k),'DELETE');
  }
  return sent}
 return {db,send,deliver};
}

// Événements du planning. L'acteur est déjà authentifié par l'appelant ; tâche, validation et destinataires sont relus en base.
export async function announce(env,kind,{actor,task,day}){
 if(!uuid.test(String(task??'')))return 0;
 const {db,deliver}=notifier(env);
 const [t]=await db('tasks?select=*&id=eq.'+task+'&home=eq.'+actor.home);
 if(!t)return 0;
 const family=await db('members?select=id,name,role,account,share&home=eq.'+actor.home),titre=`« ${t.title} »`;
 if(kind==='task'){
  if(actor.role!=='parent')return 0;
  // La personne prévenue est celle de la prochaine occurrence, cherchée sur deux mois.
  let d=t.starts>today()?t.starts:today();
  for(let i=0;i<62&&!occurs(t,d);i++)d=addDays(d,1);
  const m=occurs(t,d)&&family.find(x=>x.id===person(t,d));
  if(!m||m.id===actor.id)return 0;
  return deliver([m],()=>({title:'Nouvelle tâche pour toi',body:`${titre}, à faire ${quand(d)}${t.rotating?', puis à tour de rôle':''}.`,tag:'task-'+t.id}),'task:'+t.id);
 }
 if(!jour.test(String(day??'')))return 0;
 const [c]=await db('completions?select=*&task=eq.'+t.id+'&day=eq.'+day);
 if(!c)return 0;
 if(kind==='done'){
  if(c.approved||c.actor!==actor.id)return 0;
  return deliver(family.filter(m=>m.role==='parent'&&m.id!==actor.id),()=>({title:'Une tâche attend ta confirmation',body:`${actor.name} a terminé ${titre} ${quand(day)}.`,tag:'done-'+t.id+'-'+day}),'done:'+t.id+':'+day);
 }
 if(kind==='approve'){
  if(actor.role!=='parent'||!c.approved||c.actor===actor.id)return 0;
  const m=family.find(x=>x.id===c.actor);
  return m?deliver([m],()=>({title:'Tâche validée ✓',body:`${actor.name} a confirmé ${titre} ${quand(day)}. Bravo !`,tag:'approve-'+t.id+'-'+day}),'approve:'+t.id+':'+day):0;
 }
 return 0;
}
