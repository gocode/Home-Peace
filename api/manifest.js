// Manifeste du lien personnel : l'icône posée sur l'écran d'accueil rouvre ce lien et non l'écran de connexion.
// Sur iPhone, c'est la condition pour recevoir des notifications sans compte.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
 const token=String(req.query.token??'');
 if(!uuid.test(token))return res.status(404).json({error:'Lien inconnu ou désactivé.'});
 const start='/planning.html?token='+token;
 res.setHeader('Content-Type','application/manifest+json; charset=utf-8');
 res.end(JSON.stringify({id:start,name:'À chacun son tour',short_name:'Son tour',lang:'fr',start_url:start,scope:'/',display:'standalone',background_color:'#f3f6fc',theme_color:'#183c91',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}]}));
}
