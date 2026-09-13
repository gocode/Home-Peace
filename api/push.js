import webpush from 'web-push';
import {timingSafeEqual} from 'node:crypto';
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const env=process.env;
 if(!['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'].every(k=>env[k]))return res.status(503).json({error:'Le service de notifications doit être configuré.'});
 async function db(path,method='GET',body){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok){const e=Error('Erreur de base de données');e.status=r.status;throw e}return r.status===204?null:r.json()}
 webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
 async function send(sub,payload){try{await webpush.sendNotification(sub.subscription,JSON.stringify(payload),{TTL:3600,timeout:10000});return true}catch(e){if(e.statusCode===410||e.statusCode===404){await db('push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint),'DELETE');return false}throw e}}
 const action=req.query.action;
 try{
 if(action==='daily'){
  if(req.method!=='GET')return res.status(405).end();
  if(!env.CRON_SECRET||!equal(req.headers.authorization,'Bearer '+env.CRON_SECRET))return res.status(401).json({error:'Non autorisé'});
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(new Date()),dow=new Date(today+'T12:00:00Z').getUTCDay()||7;
  const [members,tasks,done,subs]=await Promise.all(['members?select=*','tasks?select=*','completions?day=eq.'+today,'push_subscriptions?select=*'].map(p=>db(p)));
  let delivered=0,failed=0;
  for(const m of members){const pending=tasks.filter(t=>{if(t.home!==m.home||today<t.starts||(t.ends&&today>t.ends)||!t.days.includes(dow))return false;const weeks=Math.floor((Date.parse(today)-Date.parse(t.starts))/604800000);const who=t.people[t.rotating?weeks%t.people.length:0];return who===m.id&&!done.some(c=>c.task===t.id)});const devices=subs.filter(s=>s.user_id===m.id);if(!pending.length||!devices.length)continue;
   try{await db('deliveries','POST',{user_id:m.id,day:today})}catch(e){if(e.status===409)continue;throw e}
   let success=false;for(const s of devices){try{success=await send(s,{title:'À chacun son tour',body:`${m.name}, ${pending.length} tâche(s) à faire : ${pending.map(t=>t.title).join(', ').slice(0,160)}.`,tag:'daily-'+today})||success}catch{failed++}}
   if(success)delivered++;else await db('deliveries?user_id=eq.'+m.id+'&day=eq.'+today,'DELETE');
  }
  return res.status(failed?503:200).json({delivered,failed});
 }
 if(req.method!=='POST'||!['subscribe','test'].includes(action))return res.status(405).json({error:'Requête invalide'});
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:req.headers.authorization||''}});
 if(!auth.ok)return res.status(401).json({error:'Connexion requise'});const user=await auth.json();
 const member=await db('members?id=eq.'+encodeURIComponent(user.id));if(!member.length)return res.status(403).json({error:'Rejoins une famille avant de continuer.'});
 if(action==='subscribe'){
  const sub=req.body;if(!sub||JSON.stringify(sub).length>8192)return res.status(400).json({error:'Abonnement invalide'});
  let u;try{u=new URL(sub.endpoint)}catch{return res.status(400).json({error:'Adresse de notification invalide'})}
  const allowed=u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.notify.windows.com')||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com');
  if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed||!sub.keys?.p256dh||!sub.keys?.auth)return res.status(400).json({error:'Service de notification non pris en charge'});
  // Un appareil peut être réattribué à son nouveau compte lors de son activation explicite.
  const existing=await db('push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint));
  if(existing.length)await db('push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint),'PATCH',{user_id:user.id,subscription:sub});
  else await db('push_subscriptions','POST',{endpoint:sub.endpoint,user_id:user.id,subscription:sub});
  return res.json({ok:true});
 }
 const devices=await db('push_subscriptions?user_id=eq.'+user.id);if(!devices.length)return res.status(400).json({error:"Active d'abord les notifications."});
 // Un test par minute et par compte.
 try{await db('push_tests','POST',{user_id:user.id,minute:new Date().toISOString().slice(0,16)})}catch(e){if(e.status===409)return res.status(429).json({error:'Attends une minute avant un nouveau test.'});throw e}
 const result=await Promise.all(devices.map(s=>send(s,{title:'Les rappels sont prêts !',body:'Ce téléphone peut recevoir les rappels de la famille.',tag:'test'})));
 if(!result.some(Boolean))return res.status(400).json({error:'Réactive les notifications sur ce téléphone.'});res.json({ok:true});
 }catch(e){console.error('push failure',e.status||e.statusCode||'unknown');res.status(500).json({error:"L'envoi a échoué. Réessaie dans un instant."})}
}
