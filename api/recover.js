import {createHash,randomInt} from 'node:crypto';
const digits=v=>String(v??'').replace(/[^\d+]/g,'').replace(/^\+/,'');
// Mobiles français uniquement, stockés au format international sans signe plus.
const normalize=v=>{const d=digits(v);if(/^0[67]\d{8}$/.test(d))return '33'+d.slice(1);if(/^33[67]\d{8}$/.test(d))return d;return null};
const fingerprint=(id,code)=>createHash('sha256').update(id+':'+code).digest('hex');
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const env=process.env;
 if(!['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ALLMYSMS_LOGIN','ALLMYSMS_API_KEY','ALLMYSMS_FROM'].every(k=>env[k]))return res.status(503).json({error:'La récupération par SMS doit être configurée.'});
 const action=req.query.action;
 if(req.method!=='POST'||!['send','verify'].includes(action))return res.status(405).json({error:'Requête invalide'});
 const key={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
 async function db(path,method='GET',body){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{...key,Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok){const e=Error('Erreur de base de données');e.status=r.status;throw e}return r.status===204?null:r.json()}
 async function sms(to,text){
  const r=await fetch('https://api.allmysms.com/sms/send',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.ALLMYSMS_LOGIN+':'+env.ALLMYSMS_API_KEY).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({from:env.ALLMYSMS_FROM,to,text})});
  const d=await r.json().catch(()=>null);
  if(!r.ok||d?.code!==100)throw Object.assign(Error('SMS refusé'),{detail:r.status+'/'+(d?.code??'?')});
 }
 const phone=normalize(req.body?.phone);
 if(!phone)return res.status(400).json({error:'Numéro de mobile français attendu, par exemple 06 12 34 56 78.'});
 try{
  // Un numéro inconnu suit exactement le même chemin qu'un numéro connu : la réponse ne dit jamais qui possède un compte.
  const [member]=await db('members?select=id,name&phone=eq.'+phone);
  if(action==='send'){
   if(member){
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    const state=await db('rpc/start_recovery','POST',{target:member.id,hash:fingerprint(member.id,code)});
    if(state==='ok'){try{await sms(phone,`${code} est votre code pour choisir un nouveau mot de passe sur A chacun son tour. Valable 10 minutes.`)}catch(e){console.error('allmysms',e.detail||'echec')}}
    else console.warn('code non envoyé',state);
   }
   return res.json({ok:true});
  }
  const code=digits(req.body?.code),password=String(req.body?.password??'');
  if(!/^\d{6}$/.test(code))return res.status(400).json({error:'Le code compte six chiffres.'});
  if(password.length<10)return res.status(400).json({error:"Choisis un mot de passe d'au moins 10 caractères."});
  const state=member?await db('rpc/check_recovery','POST',{target:member.id,hash:fingerprint(member.id,code)}):'absent';
  if(state!=='ok')return res.status(400).json({error:{expire:'Ce code a expiré. Demande-en un nouveau.',bloque:'Trop de tentatives. Demande un nouveau code.',absent:'Demande d’abord un code par SMS.'}[state]||'Code incorrect.'});
  const r=await fetch(env.SUPABASE_URL+'/auth/v1/admin/users/'+member.id,{method:'PUT',headers:key,body:JSON.stringify({password})});
  if(!r.ok){console.error('admin password',r.status);return res.status(400).json({error:'Mot de passe refusé. Choisis-en un autre.'})}
  res.json({ok:true});
 }catch(e){console.error('recover failure',e.status||'unknown');res.status(500).json({error:'Service indisponible. Réessaie dans un instant.'})}
}
