// Planning ouvert par un lien de partage : sans compte, sans réglages.
// Un lien de foyer donne la semaine entière en lecture seule ; un lien de membre ne montre que ses tâches et le laisse les cocher.
import {pushReady,announce} from './_notify.js';
const iso=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(d);
const at=s=>new Date(s+'T12:00:00Z');
const add=(s,n)=>{const d=at(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const weekday=s=>at(s).getUTCDay()||7;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jour=/^\d{4}-\d{2}-\d{2}$/;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
 const env=process.env;
 if(!['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].every(k=>env[k]))return res.status(503).json({error:'Le partage doit être configuré.'});
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Requête invalide'});
 const token=String(req.query.token??'');
 if(!uuid.test(token))return res.status(404).json({error:'Lien inconnu ou désactivé.'});
 const key={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
 async function db(path,method='GET',body){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:key,body:body?JSON.stringify(body):undefined});if(!r.ok){const e=Error('Erreur de base de données');e.status=r.status;throw e}return r.json()}
 try{
  // Le jeton désigne soit un foyer entier, soit un seul membre.
  const [[home],[owner]]=await Promise.all([db('homes?select=id,name&share=eq.'+token),db('members?select=id,name,color,home&share=eq.'+token)]);
  const foyer=home?home.id:owner?.home;
  if(!foyer)return res.status(404).json({error:'Lien inconnu ou désactivé.'});
  const today=iso(new Date());

  if(req.method==='POST'){
   if(!owner)return res.status(403).json({error:'Ce lien ne permet pas de cocher une tâche.'});
   const {task,day,action}=req.body??{};
   if(!uuid.test(String(task??''))||!jour.test(String(day??''))||!['done','undo'].includes(action))return res.status(400).json({error:'Requête invalide'});
   const state=await db('rpc/mark_task_as','POST',{actor_member:owner.id,task_id:task,task_day:day,action});
   if(state!=='ok')return res.status(400).json({error:{tache:'Cette tâche n’existe plus.',date:'Cette tâche n’est pas prévue ce jour-là.',futur:'Cette tâche est prévue plus tard.',autre:'Cette tâche est attribuée à quelqu’un d’autre.'}[state]||'Action impossible.'});
   // Une tâche soumise à confirmation prévient les parents ; un échec d'envoi ne remet pas la validation en cause.
   if(action==='done'&&pushReady(env))await announce(env,'done',{actor:owner,task,day}).catch(e=>console.error('notify failure',e.status||e.statusCode||'unknown'));
   return res.json({ok:true});
  }

  let asked=String(req.query.week??today);
  if(!jour.test(asked)||Number.isNaN(Date.parse(asked))||Math.abs(Date.parse(asked)-Date.parse(today))>400*86400000)asked=today;
  const start=add(asked,1-weekday(asked)),days=Array.from({length:7},(_,i)=>add(start,i));
  const [members,tasks,done,[maison]]=await Promise.all([
   db('members?select=id,name,color&home=eq.'+foyer),
   db('tasks?select=*&home=eq.'+foyer),
   db('completions?select=task,day,approved&day=gte.'+start+'&day=lte.'+days[6]),
   home?[home]:db('homes?select=name&id=eq.'+foyer)]);
  const ours=new Set(tasks.map(t=>t.id));
  const person=(t,d)=>{const w=Math.floor((Date.parse(d)-Date.parse(t.starts))/604800000),i=t.rotating?((w%t.people.length)+t.people.length)%t.people.length:0;return members.find(m=>m.id===t.people[i])};
  const occurs=(t,d)=>d>=t.starts&&(!t.ends||d<=t.ends)&&t.days.includes(weekday(d));
  const marks=done.filter(c=>ours.has(c.task));
  res.json({home:maison?.name??'',today,start,
   who:owner?owner.name:null,color:owner?owner.color:null,
   people:owner?[{name:owner.name,color:owner.color}]:members.map(m=>({name:m.name,color:m.color})),
   days:days.map(d=>({day:d,tasks:tasks.filter(t=>occurs(t,d)&&(!owner||person(t,d)?.id===owner.id)).map(t=>{const m=person(t,d),c=marks.find(c=>c.task===t.id&&c.day===d);
    // L'identifiant de tâche n'est livré qu'au titulaire du lien, qui a justement le droit d'agir dessus.
    return {...(owner?{id:t.id}:{}),title:t.title,who:m?.name??null,color:m?.color??null,rotating:!!t.rotating,
     state:c?.approved?'fait':c?'attente':d<today?'retard':'prevu',
     mine:!!owner&&d<=today}})}))});
 }catch(e){console.error('planning failure',e.status||'unknown');res.status(500).json({error:'Planning momentanément indisponible.'})}
}
