// Planning en lecture seule pour le lien de partage : aucun compte, aucune écriture, aucun identifiant technique en sortie.
const iso=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(d);
const at=s=>new Date(s+'T12:00:00Z');
const add=(s,n)=>{const d=at(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const weekday=s=>at(s).getUTCDay()||7;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
 const env=process.env;
 if(!['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].every(k=>env[k]))return res.status(503).json({error:'Le partage doit être configuré.'});
 if(req.method!=='GET')return res.status(405).json({error:'Requête invalide'});
 const token=String(req.query.token??'');
 if(!uuid.test(token))return res.status(404).json({error:'Lien inconnu ou désactivé.'});
 const key={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
 async function db(path){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{headers:key});if(!r.ok){const e=Error('Erreur de base de données');e.status=r.status;throw e}return r.json()}
 try{
  const [home]=await db('homes?select=id,name&share=eq.'+token);
  if(!home)return res.status(404).json({error:'Lien inconnu ou désactivé.'});
  const today=iso(new Date());
  let asked=String(req.query.week??today);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asked)||Number.isNaN(Date.parse(asked))||Math.abs(Date.parse(asked)-Date.parse(today))>400*86400000)asked=today;
  const start=add(asked,1-weekday(asked)),days=Array.from({length:7},(_,i)=>add(start,i));
  const [members,tasks,done]=await Promise.all([
   db('members?select=id,name,color&home=eq.'+home.id),
   db('tasks?select=*&home=eq.'+home.id),
   db('completions?select=task,day,approved&day=gte.'+start+'&day=lte.'+days[6])]);
  const ours=new Set(tasks.map(t=>t.id));
  const person=(t,d)=>{const w=Math.floor((Date.parse(d)-Date.parse(t.starts))/604800000),i=t.rotating?((w%t.people.length)+t.people.length)%t.people.length:0;return members.find(m=>m.id===t.people[i])};
  const occurs=(t,d)=>d>=t.starts&&(!t.ends||d<=t.ends)&&t.days.includes(weekday(d));
  const marks=done.filter(c=>ours.has(c.task));
  res.json({home:home.name,start,today,
   people:members.map(m=>({name:m.name,color:m.color})),
   days:days.map(d=>({day:d,tasks:tasks.filter(t=>occurs(t,d)).map(t=>{const m=person(t,d),c=marks.find(c=>c.task===t.id&&c.day===d);
    return {title:t.title,who:m?.name??null,color:m?.color??null,rotating:!!t.rotating,state:c?.approved?'fait':c?'attente':d<today?'retard':'prevu'}})}))});
 }catch(e){console.error('planning failure',e.status||'unknown');res.status(500).json({error:'Planning momentanément indisponible.'})}
}
