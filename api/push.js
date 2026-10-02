import {timingSafeEqual} from 'node:crypto';
import {pushReady,uuid,notifier,announce,today as now,addDays,occurs,person,pageOf,streaksOf,complete,won} from './_notify.js';
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const env=process.env;
 if(!pushReady(env))return res.status(503).json({error:'Le service de notifications doit être configuré.'});
 const {db,send,deliver}=notifier(env);
 const action=req.query.action;
 try{
 if(action==='daily'){
  if(req.method!=='GET')return res.status(405).end();
  if(!env.CRON_SECRET||!equal(req.headers.authorization,'Bearer '+env.CRON_SECRET))return res.status(401).json({error:'Non autorisé'});
  const today=now(),[members,tasks,done,waiting,subs]=await Promise.all(['members?select=*','tasks?select=*','completions?day=eq.'+today,'completions?select=task&approved=eq.false&day=gte.'+addDays(today,-14),'push_subscriptions?select=*'].map(p=>db(p)));
  let delivered=0,failed=0;
  // Séries 🔥, lues une fois par famille.
  const series=new Map(),streak=async m=>{if(!series.has(m.home))series.set(m.home,await streaksOf(db,m.home));return series.get(m.home)[m.id]||0};
  for(const m of members){const pending=tasks.filter(t=>t.home===m.home&&occurs(t,today)&&person(t,today)===m.id&&!done.some(c=>c.task===t.id));
   // Les parents apprennent aussi ce qui attend leur confirmation depuis deux semaines.
   const confirm=m.role==='parent'?waiting.filter(c=>tasks.some(t=>t.id===c.task&&t.home===m.home)).length:0;
   const devices=subs.filter(s=>s.user_id===m.id);if((!pending.length&&!confirm)||!devices.length)continue;
   try{await db('deliveries','POST',{user_id:m.id,day:today})}catch(e){if(e.status===409)continue;throw e}
   const n=pending.length?await streak(m):0;
   const body=[pending.length?`${m.name}, ${pending.length} tâche(s) à faire : ${pending.map(t=>t.title).join(', ').slice(0,160)}.`:'',n>=2?`Ta série de ${n} jours 🔥 est en jeu !`:'',confirm?`${confirm} tâche(s) attendent ta confirmation.`:''].filter(Boolean).join(' ');
   let success=false;for(const s of devices){try{success=await send(s,{title:'À chacun son tour',body,tag:'daily-'+today,url:pageOf(m)})||success}catch{failed++}}
   if(success)delivered++;else await db('deliveries?user_id=eq.'+m.id+'&day=eq.'+today,'DELETE');
  }
  // Le dimanche, chacun reçoit en plus le bilan de sa semaine ; les parents, aussi celui de la famille.
  let recap=0;
  if(new Date(today+'T12:00:00Z').getUTCDay()===0){
   try{
    const week=Array.from({length:7},(_,i)=>addDays(today,i-6)),marks=await db('completions?select=task,day&day=gte.'+week[0]+'&day=lte.'+today);
    const tally=(home,who)=>{let due=0,ok=0;for(const d of week)for(const t of tasks)if(t.home===home&&occurs(t,d)&&(!who||person(t,d)===who)){due++;if(marks.some(c=>c.task===t.id&&c.day===d))ok++}return [ok,due]};
    const lines=new Map();
    for(const m of members){if(!subs.some(s=>s.user_id===m.id))continue;
     const [ok,due]=tally(m.home,m.id),[fok,fdue]=m.role==='parent'?tally(m.home):[0,0],n=due?await streak(m):0;
     if(!due&&!fdue)continue;
     const ours=tasks.filter(t=>t.home===m.home),medals=week.filter(d=>complete(ours,marks,d)).length;
     const team=won(ours,marks,week)?'🏆 Coupe de la semaine gagnée par toute la famille !':medals?`🏅 ${medals} médaille${medals>1?'s':''} de famille cette semaine.`:'';
     lines.set(m.id,[due?(ok===due?`Semaine parfaite, ${m.name} : ${due} tâche(s) sur ${due} ! ✨`:`${m.name}, ${ok} tâche(s) faite(s) sur ${due} cette semaine.${ok*2>=due?' Bravo !':' Nouvelle semaine, nouveau départ demain.'}`):'',n>=2?`🔥 Série en cours : ${n} jours.`:'',fdue?`La famille : ${fok} sur ${fdue}.`:'',team].filter(Boolean).join(' '));
    }
    recap=await deliver(members.filter(m=>lines.has(m.id)),m=>({title:'Le bilan de la semaine 🎉',body:lines.get(m.id),tag:'recap-'+today}),'recap:'+today);
   }catch(e){console.error('recap failure',e.status||'unknown');failed++}
  }
  // Les clés d'événements ne servent qu'à éviter les doublons : deux mois suffisent.
  await db('push_events?created_at=lt.'+addDays(today,-60),'DELETE').catch(()=>{});
  return res.status(failed?503:200).json({delivered,recap,failed});
 }
 if(req.method!=='POST'||!['subscribe','test','status','event'].includes(action))return res.status(405).json({error:'Requête invalide'});
 // Deux façons d'être reconnu : la session d'un compte, ou le lien personnel d'un profil géré.
 let me;
 if(req.query.token!==undefined){
  const token=String(req.query.token);
  [me]=uuid.test(token)?await db('members?select=id,home,name,role,account,share&share=eq.'+token):[];
  if(!me)return res.status(404).json({error:'Lien inconnu ou désactivé.'});
  if(action==='event')return res.status(403).json({error:'Requête invalide'});
 }else{
  const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:req.headers.authorization||''}});
  if(!auth.ok)return res.status(401).json({error:'Connexion requise'});const user=await auth.json();
  [me]=await db('members?select=id,home,name,role,account,share&account=eq.'+encodeURIComponent(user.id));
  if(!me)return res.status(403).json({error:'Rejoins une famille avant de continuer.'});
 }
 if(action==='event'){
  const {kind,task,day}=req.body??{};
  if(!['task','done','approve','medal'].includes(kind))return res.status(400).json({error:'Requête invalide'});
  return res.json({sent:await announce(env,kind,{actor:me,task,day})});
 }
 if(action==='status'){
  // L'appareil est-il inscrit, et pour ce profil-ci ? Le navigateur seul ne le sait pas.
  const endpoint=req.body?.endpoint;if(typeof endpoint!=='string'||endpoint.length>2048)return res.status(400).json({error:'Requête invalide'});
  const [s]=await db('push_subscriptions?select=user_id&endpoint=eq.'+encodeURIComponent(endpoint));
  return res.json({state:!s?'absent':s.user_id===me.id?'ok':'autre'});
 }
 if(action==='subscribe'){
  const sub=req.body;if(!sub||JSON.stringify(sub).length>8192)return res.status(400).json({error:'Abonnement invalide'});
  let u;try{u=new URL(sub.endpoint)}catch{return res.status(400).json({error:'Adresse de notification invalide'})}
  const allowed=u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.notify.windows.com')||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com');
  if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed||!sub.keys?.p256dh||!sub.keys?.auth)return res.status(400).json({error:'Service de notification non pris en charge'});
  // Un appareil peut être réattribué à son nouveau compte lors de son activation explicite.
  const existing=await db('push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint));
  if(existing.length)await db('push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint),'PATCH',{user_id:me.id,subscription:sub});
  else await db('push_subscriptions','POST',{endpoint:sub.endpoint,user_id:me.id,subscription:sub});
  return res.json({ok:true});
 }
 const devices=await db('push_subscriptions?user_id=eq.'+me.id);if(!devices.length)return res.status(400).json({error:"Active d'abord les notifications."});
 // Un test par minute et par profil.
 try{await db('push_tests','POST',{user_id:me.id,minute:new Date().toISOString().slice(0,16)})}catch(e){if(e.status===409)return res.status(429).json({error:'Attends une minute avant un nouveau test.'});throw e}
 const result=await Promise.all(devices.map(s=>send(s,{title:'Les rappels sont prêts !',body:'Cet appareil recevra les rappels de la famille.',tag:'test',url:pageOf(me)})));
 if(!result.some(Boolean))return res.status(400).json({error:'Réactive les notifications sur cet appareil.'});res.json({ok:true});
 }catch(e){console.error('push failure',e.status||e.statusCode||'unknown');res.status(500).json({error:"L'envoi a échoué. Réessaie dans un instant."})}
}
