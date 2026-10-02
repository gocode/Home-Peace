// Invitation d'un parent par e-mail.
// La base décide qui peut inviter (fonction invite_member, appelée avec le jeton du parent) ; le serveur se charge seulement de l'e-mail.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const env=process.env;
 if(!['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'].every(k=>env[k]))return res.status(503).json({error:'Les invitations doivent être configurées.'});
 if(req.method!=='POST')return res.status(405).json({error:'Requête invalide'});
 const bearer=String(req.headers.authorization??'');
 if(!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(bearer))return res.status(401).json({error:'Reconnecte-toi pour continuer.'});
 const name=String(req.body?.name??'').trim(),email=String(req.body?.email??'').trim().toLowerCase();
 const json={'Content-Type':'application/json'};
 // Le lien ramène sur ce site si son adresse figure dans les Redirect URLs Supabase, sinon sur la Site URL.
 const back=encodeURIComponent('https://'+req.headers.host+'/');
 try{
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/invite_member',{method:'POST',headers:{...json,apikey:env.SUPABASE_ANON_KEY,Authorization:bearer},body:JSON.stringify({display_name:name,mail:email})});
  if(!r.ok){const d=await r.json().catch(()=>null);return res.status(r.status===401?401:400).json({error:d?.code==='PGRST202'?'La base n’est pas à jour : exécute database/invitations.sql dans Supabase.':d?.message||'Invitation refusée.'})}
  const admin={...json,apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
  const sent=await fetch(env.SUPABASE_URL+'/auth/v1/invite?redirect_to='+back,{method:'POST',headers:admin,body:JSON.stringify({email})});
  if(sent.ok)return res.json({ok:true,existing:false});
  const d=await sent.json().catch(()=>null);
  if(sent.status===429)return res.status(429).json({error:'Invitation enregistrée, mais trop d’e-mails partis récemment : renvoie-la plus tard.'});
  // Adresse déjà inscrite : un lien de connexion suffit, l'invitation s'appliquera à son arrivée.
  if(sent.status===422&&/already|exists|registered/i.test(d?.error_code||d?.msg||d?.message||'')){
   const otp=await fetch(env.SUPABASE_URL+'/auth/v1/otp?redirect_to='+back,{method:'POST',headers:{...json,apikey:env.SUPABASE_ANON_KEY},body:JSON.stringify({email,create_user:false})});
   if(otp.ok)return res.json({ok:true,existing:true});
   console.error('invite otp',otp.status);
   return res.status(502).json({error:'Invitation enregistrée. Cette adresse a déjà un compte : il suffit de s’y connecter pour rejoindre la famille.'});
  }
  console.error('invite admin',sent.status,d?.error_code||'');
  res.status(502).json({error:'Invitation enregistrée, mais l’e-mail n’a pas pu partir. Vérifie le SMTP Supabase, puis renvoie-la.'});
 }catch(e){console.error('invite failure',e.message);res.status(500).json({error:'Service indisponible. Réessaie dans un instant.'})}
}
