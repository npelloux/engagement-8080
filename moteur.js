/*
 * Moteur de prévision d'engagement.
 *
 * Deux couches, sans dépendance ni accès au DOM :
 *   - données : normalisation des trimestres (F, E, P), sélection, import/export ;
 *   - statistique : confiance de fabrication, confiance de prédictibilité, engagement maximal.
 *
 * Notations : F = Features fabriquées, E = Features engagées, P = F / E (stockée entre 0 et 1).
 * Hypothèse du MVP : la fabrication future ne dépend pas de l'engagement futur (F ⟂ E).
 * La confiance d'un engagement E pour une prédictibilité cible p est donc C(E) = P(F ≥ E·p).
 */
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.Moteur=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

var EPS=1e-9;

/* ======================= Couche données ======================= */

// Accepte « 2024-Q1 », « 2024-T1 », « T1-24 », « Q1 2024 ».
function parseQuarter(txt){
  if(txt===null||txt===undefined) return null;
  var s=String(txt).trim().toUpperCase(), m;
  m=s.match(/^(\d{4})\s*[-_\/ ]?\s*[QT]([1-4])$/);
  if(m) return {year:+m[1],q:+m[2]};
  m=s.match(/^[QT]([1-4])\s*[-_\/ ]?\s*(\d{2}|\d{4})$/);
  if(m){var y=+m[2]; return {year:y<100?2000+y:y,q:+m[1]};}
  return null;
}
function quarterKey(o){return o.year+'-Q'+o.q;}
function quarterIndex(key){var o=parseQuarter(key); return o?o.year*4+o.q-1:NaN;}
function quarterFromIndex(i){return Math.floor(i/4)+'-Q'+(i%4+1);}
function quarterLabel(key){var o=parseQuarter(key); return o?'T'+o.q+'-'+String(o.year).slice(2):String(key);}
function nextQuarter(key){return quarterFromIndex(quarterIndex(key)+1);}

function num(v){
  if(v===null||v===undefined||v==='') return null;
  var n=Number(v);
  return isFinite(n)?n:null;
}

// Complète la troisième valeur quand deux sont fournies ; signale l'incohérence quand les trois le sont.
// E n'est jamais inventé quand P est absent.
function normalizeRow(row,tolerance){
  var tol=tolerance===undefined||tolerance===null?0.01:tolerance;
  var F=num(row.made), E=num(row.committed), P=num(row.predictability);
  var out={quarter:row.quarter,made:F,committed:E,predictability:P,derived:null,inconsistent:false,gap:null};
  if(F!==null && E!==null && P!==null){
    if(E>0){out.gap=Math.abs(P-F/E); out.inconsistent=out.gap>=tol;}
    else out.inconsistent=F>0;
  }else if(F!==null && E!==null){
    if(E>0){out.predictability=F/E; out.derived='predictability';}
  }else if(F!==null && P!==null){
    if(P>0){out.committed=F/P; out.derived='committed';}
  }else if(E!==null && P!==null){
    out.made=P*E; out.derived='made';
  }
  return out;
}

function sortRows(rows){
  return rows.slice().sort(function(a,b){return quarterIndex(a.quarter)-quarterIndex(b.quarter);});
}

// Observations exploitables (F connu) retenues pour le calcul.
// selection = {mode:'all'} | {mode:'last', last:N} | {mode:'manual', excluded:[trimestres]}
function selectObservations(rows,selection){
  var sel=selection||{mode:'all'};
  var obs=sortRows(rows).filter(function(r){return r.made!==null && r.made!==undefined;})
    .map(function(r){return {quarter:r.quarter,value:r.made};});
  if(sel.mode==='last'){
    var k=Math.max(1,Math.floor(sel.last||obs.length));
    return obs.slice(Math.max(0,obs.length-k));
  }
  if(sel.mode==='manual'){
    var ex=sel.excluded||[];
    return obs.filter(function(o){return ex.indexOf(o.quarter)<0;});
  }
  return obs;
}

function fmtCsv(v){return v===null||v===undefined?'':String(Math.round(v*1000)/1000).replace('.',',');}

// CSV à point-virgule ; la prédictibilité y est exprimée en pourcentage.
function toCSV(rows){
  var lines=['trimestre;fabriquees;engagees;predictibilite_pct'];
  sortRows(rows).forEach(function(r){
    lines.push([r.quarter,fmtCsv(num(r.made)),fmtCsv(num(r.committed)),
      num(r.predictability)===null?'':fmtCsv(num(r.predictability)*100)].join(';'));
  });
  return lines.join('\n');
}

function fromCSV(text){
  var lines=String(text).split(/\r?\n/).map(function(l){return l.trim();}).filter(function(l){return l!=='';});
  var rows=[], errors=[];
  if(!lines.length) return {rows:rows,errors:['Le texte est vide.']};
  var sep=lines[0].indexOf(';')>=0?';':lines[0].indexOf('\t')>=0?'\t':',';
  var cols={quarter:0,made:1,committed:2,predictability:3}, start=0;
  var head=lines[0].split(sep).map(function(c){return c.trim().toLowerCase();});
  if(!parseQuarter(head[0])){
    start=1; cols={quarter:-1,made:-1,committed:-1,predictability:-1};
    head.forEach(function(h,i){
      if(/^(tri|quart|quarter)/.test(h)) cols.quarter=i;
      else if(/^(fab|made|feat)/.test(h)) cols.made=i;
      else if(/^(eng|commit)/.test(h)) cols.committed=i;
      else if(/^(pr[eé]d|predict)/.test(h)) cols.predictability=i;
    });
    if(cols.quarter<0||cols.made<0) return {rows:rows,errors:['En-tête attendu : trimestre;fabriquees;engagees;predictibilite_pct']};
  }
  function cell(parts,i){
    if(i<0||i>=parts.length) return null;
    var s=parts[i].trim().replace('%','').replace(/\s/g,'');
    if(s===''||/^(na|n\/a|null|-)$/i.test(s)) return null;
    if(sep!==',') s=s.replace(',','.');
    var n=Number(s);
    return isFinite(n)?n:NaN;
  }
  for(var i=start;i<lines.length;i++){
    var parts=lines[i].split(sep), q=parseQuarter(parts[cols.quarter]);
    if(!q){errors.push('Ligne '+(i+1)+' : trimestre illisible « '+parts[cols.quarter]+' ».'); continue;}
    var F=cell(parts,cols.made), E=cell(parts,cols.committed), P=cell(parts,cols.predictability);
    if([F,E,P].some(function(v){return v!==null && (isNaN(v)||v<0);})){
      errors.push('Ligne '+(i+1)+' : valeur numérique illisible ou négative.'); continue;
    }
    rows.push({quarter:quarterKey(q),made:F,committed:E,predictability:P===null?null:P/100});
  }
  return {rows:rows,errors:errors};
}

// JSON : la prédictibilité y est stockée entre 0 et 1, comme en interne.
function toJSON(rows,params){
  return JSON.stringify({version:1,parametres:params||null,trimestres:sortRows(rows).map(function(r){
    return {trimestre:r.quarter,fabriquees:num(r.made),engagees:num(r.committed),predictibilite:num(r.predictability)};
  })},null,2);
}
function fromJSON(text){
  var data, rows=[], errors=[];
  try{data=JSON.parse(text);}catch(e){return {rows:rows,errors:['JSON illisible : '+e.message],params:null};}
  var list=Array.isArray(data)?data:(data&&data.trimestres);
  if(!Array.isArray(list)) return {rows:rows,errors:['Le JSON doit contenir une liste « trimestres ».'],params:null};
  list.forEach(function(t,i){
    var q=parseQuarter(t.trimestre||t.quarter);
    if(!q){errors.push('Entrée '+(i+1)+' : trimestre illisible.'); return;}
    rows.push({quarter:quarterKey(q),made:num(t.fabriquees!==undefined?t.fabriquees:t.made),
      committed:num(t.engagees!==undefined?t.engagees:t.committed),
      predictability:num(t.predictibilite!==undefined?t.predictibilite:t.predictability)});
  });
  return {rows:rows,errors:errors,params:(data&&data.parametres)||null};
}

/* ======================= Moteur statistique ======================= */

function values(dataset){
  return dataset.map(function(d){return typeof d==='number'?d:d.value;});
}
function stats(dataset){
  var xs=values(dataset), n=xs.length;
  if(!n) return {n:0,mean:NaN,sd:NaN,variance:NaN,min:NaN,max:NaN};
  var mean=xs.reduce(function(a,b){return a+b;},0)/n;
  var ss=xs.reduce(function(a,b){return a+(b-mean)*(b-mean);},0);
  var variance=n>1?ss/(n-1):NaN;
  return {n:n,mean:mean,variance:variance,sd:Math.sqrt(variance),min:Math.min.apply(null,xs),max:Math.max.apply(null,xs)};
}
// Rapport variance / moyenne : au-delà de 1, un modèle de Poisson simple sous-estime la dispersion
// (préférer une binomiale négative si un moteur de comptage est ajouté).
function dispersion(dataset){
  var s=stats(dataset);
  return s.n>1 && s.mean>0 ? s.variance/s.mean : NaN;
}

// Générateur pseudo-aléatoire à graine (mulberry32) : mêmes données + même graine = même résultat.
function mulberry32(seed){
  var a=seed>>>0;
  return function(){
    a=(a+0x6D2B79F5)>>>0;
    var t=a;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

function lgamma(x){
  var c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  var y=x, tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp);
  var ser=1.000000000190015;
  for(var j=0;j<6;j++) ser+=c[j]/++y;
  return -tmp+Math.log(2.5066282746310005*ser/x);
}
function betacf(a,b,x){
  var FPMIN=1e-300, qab=a+b, qap=a+1, qam=a-1, c=1, d=1-qab*x/qap;
  if(Math.abs(d)<FPMIN) d=FPMIN;
  d=1/d; var h=d;
  for(var m=1;m<=300;m++){
    var m2=2*m, aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d; if(Math.abs(d)<FPMIN) d=FPMIN;
    c=1+aa/c; if(Math.abs(c)<FPMIN) c=FPMIN;
    d=1/d; h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d; if(Math.abs(d)<FPMIN) d=FPMIN;
    c=1+aa/c; if(Math.abs(c)<FPMIN) c=FPMIN;
    d=1/d; var del=d*c; h*=del;
    if(Math.abs(del-1)<3e-12) break;
  }
  return h;
}
function ibeta(a,b,x){
  if(x<=0) return 0;
  if(x>=1) return 1;
  var bt=Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));
  return x<(a+1)/(a+b+2) ? bt*betacf(a,b,x)/a : 1-bt*betacf(b,a,1-x)/b;
}
function studentCdf(t,df){
  var p=0.5*ibeta(df/2,0.5,df/(df+t*t));
  return t>0 ? 1-p : p;
}

// Part des valeurs d'un tableau trié croissant qui atteignent x.
function shareAtLeast(sorted,x){
  var lo=0, hi=sorted.length, t=x-EPS;
  while(lo<hi){var mid=(lo+hi)>>1; if(sorted[mid]>=t) hi=mid; else lo=mid+1;}
  return (sorted.length-lo)/sorted.length;
}
function ascending(xs){return Array.prototype.slice.call(xs).sort(function(a,b){return a-b;});}

/*
 * Registre des moteurs. Chaque moteur construit, à partir des fabrications historiques, une
 * distribution prédictive du prochain trimestre exposée par survival(x) = P(F_futur ≥ x).
 * Ajouter un moteur (comptage Poisson / binomiale négative, modèle conditionnel F|E) revient à
 * ajouter une entrée ici : le reste de l'API et la visualisation n'en dépendent pas.
 */
var METHODS={
  // Mode A — fréquences observées, sans hypothèse de loi. Fonction en escalier, pas de 1/n.
  empirical:{
    label:'Empirique', minObservations:1, continuous:false,
    build:function(xs){
      var sorted=ascending(xs);
      return {survival:function(x){return shareAtLeast(sorted,x);}};
    }
  },
  // Mode B — Monte-Carlo par rééchantillonnage empirique : chaque simulation tire avec remise un
  // trimestre observé comme réalisation du prochain trimestre. Ce tirage direct converge vers le
  // mode empirique (au bruit de simulation près) : il n'estime pas l'incertitude liée à la taille
  // de l'échantillon. Cette incertitude-là est estimée à part, par bootstrapUncertainty().
  montecarlo:{
    label:'Monte-Carlo / bootstrap', minObservations:1, continuous:false,
    build:function(xs,opt){
      var N=Math.max(1000,Math.floor(opt.simulations||10000));
      var rng=mulberry32(opt.seed===undefined||opt.seed===null?42:opt.seed);
      var sims=new Float64Array(N);
      for(var i=0;i<N;i++) sims[i]=xs[Math.floor(rng()*xs.length)];
      var sorted=ascending(sims);
      return {simulations:N,survival:function(x){return shareAtLeast(sorted,x);}};
    }
  },
  // Mode C — prédictive bayésienne à prior non informatif :
  // F_futur | données ~ t(n−1) centrée sur la moyenne, d'échelle s·√(1+1/n).
  student:{
    label:'Bayésien Student', minObservations:3, continuous:true,
    build:function(xs){
      var s=stats(xs), scale=s.sd*Math.sqrt(1+1/s.n), df=s.n-1;
      return {mean:s.mean,scale:scale,survival:function(x){
        if(scale===0) return x<=s.mean+EPS?1:0;
        return 1-studentCdf((x-s.mean)/scale,df);
      }};
    }
  }
};

function resolveMethod(method){
  var m=typeof method==='string'?{type:method}:(method||{type:'montecarlo'});
  if(!METHODS[m.type]) throw new Error('Méthode inconnue : '+m.type);
  return {type:m.type,simulations:m.simulations||10000,seed:m.seed===undefined||m.seed===null?42:m.seed};
}
function methodAvailable(type,n){return !!METHODS[type] && n>=METHODS[type].minObservations;}

var cache={key:null,value:null};
function predictive(dataset,method){
  var xs=values(dataset), m=resolveMethod(method);
  var key=m.type+'|'+m.simulations+'|'+m.seed+'|'+xs.join(',');
  if(cache.key===key) return cache.value;
  var def=METHODS[m.type];
  if(xs.length<def.minObservations){
    throw new Error('La méthode « '+def.label+' » demande au moins '+def.minObservations+' observation(s).');
  }
  var p=def.build(xs,m);
  p.type=m.type; p.n=xs.length;
  cache={key:key,value:p};
  return p;
}

// Capacité de fabrication : P(F_futur ≥ target).
function predictDeliveryConfidence(target,dataset,method){
  return predictive(dataset,method).survival(target);
}
// Fiabilité d'un engagement : P(F_futur / E ≥ p) = P(F_futur ≥ E·p).
function predictPredictabilityConfidence(commitment,predictabilityTarget,dataset,method){
  return predictive(dataset,method).survival(commitment*predictabilityTarget);
}
// Engagement entier maximal E* tel que C(E*) ≥ confidenceTarget. Jamais arrondi vers le haut.
function findMaxCommitment(confidenceTarget,predictabilityTarget,dataset,method){
  var pr=predictive(dataset,method);
  var C=function(E){return pr.survival(E*predictabilityTarget);};
  var ok=function(E){return C(E)>=confidenceTarget-1e-12;};
  if(!ok(1)) return {commitment:0,confidence:null,feasible:false};
  var lo=1, hi=2;
  while(ok(hi) && hi<1e7){lo=hi; hi*=2;}
  while(hi-lo>1){var mid=Math.floor((lo+hi)/2); if(ok(mid)) lo=mid; else hi=mid;}
  // En Monte-Carlo, un seuil situé dans le bruit de simulation (2 erreurs types) rend E* sensible à la graine.
  var marginal=false;
  if(pr.simulations){
    var se=2*Math.sqrt(confidenceTarget*(1-confidenceTarget)/pr.simulations);
    marginal=Math.abs(C(lo)-confidenceTarget)<se || Math.abs(C(lo+1)-confidenceTarget)<se;
  }
  return {commitment:lo,confidence:C(lo),feasible:true,marginal:marginal};
}
// Plage d'abscisses utile pour tracer la courbe (en Features engagées si p < 1, fabriquées si p = 1).
function suggestRange(dataset,method,predictabilityTarget){
  var p=predictabilityTarget||1, s=stats(dataset), pr=predictive(dataset,method);
  var span=Math.max(s.max-s.min,s.mean*0.2,2);
  var lo=s.min-0.35*span, hi=s.max+0.35*span;
  if(METHODS[pr.type].continuous && pr.scale>0){
    lo=Math.min(lo,pr.mean-3.2*pr.scale); hi=Math.max(hi,pr.mean+3.6*pr.scale);
  }
  var from=Math.max(0,Math.floor(lo/p)), to=Math.ceil(hi/p);
  if(to-from<6) to=from+6;
  return {from:from,to:to};
}
// Série [{x, confidence}] de la courbe de confiance. p = 1 donne la courbe de fabrication.
function generateConfidenceCurve(dataset,method,predictabilityTarget,options){
  var p=predictabilityTarget||1, opt=options||{};
  var range=(opt.from!==undefined && opt.to!==undefined)?opt:suggestRange(dataset,method,p);
  var n=Math.max(2,opt.points||240), pr=predictive(dataset,method), out=[];
  for(var i=0;i<=n;i++){
    var x=range.from+(range.to-range.from)*i/n;
    out.push({x:x,confidence:pr.survival(x*p)});
  }
  return out;
}

/*
 * Incertitude d'échantillonnage sur E* (« bootstrap uncertainty »).
 * On rééchantillonne le jeu de données entier (n tirages avec remise, répétés `resamples` fois),
 * on recalcule E* empirique sur chaque jeu, et on rend l'intervalle central à 90 % des E* obtenus.
 * À distinguer du rééchantillonnage empirique du mode Monte-Carlo, qui simule un seul trimestre.
 */
function empiricalMaxCommitment(sortedDesc,confidenceTarget,predictabilityTarget){
  var k=Math.max(1,Math.ceil(confidenceTarget*sortedDesc.length-1e-9));
  return Math.floor(sortedDesc[k-1]/predictabilityTarget+EPS);
}
function bootstrapUncertainty(dataset,confidenceTarget,predictabilityTarget,options){
  var xs=values(dataset), n=xs.length, opt=options||{};
  if(n<2) return null;
  var B=opt.resamples||2000, rng=mulberry32(opt.seed===undefined||opt.seed===null?42:opt.seed), res=[];
  for(var b=0;b<B;b++){
    var sample=[];
    for(var i=0;i<n;i++) sample.push(xs[Math.floor(rng()*n)]);
    sample.sort(function(a,c){return c-a;});
    res.push(empiricalMaxCommitment(sample,confidenceTarget,predictabilityTarget));
  }
  res.sort(function(a,c){return a-c;});
  return {low:res[Math.floor(0.05*(B-1))],median:res[Math.floor(0.5*(B-1))],high:res[Math.floor(0.95*(B-1))],resamples:B};
}

/* ======================= Contrôles de qualité ======================= */

function quantileSorted(sorted,p){
  var pos=(sorted.length-1)*p, i=Math.floor(pos), f=pos-i;
  return i+1<sorted.length ? sorted[i]+f*(sorted[i+1]-sorted[i]) : sorted[i];
}
function fmt(v){return String(Math.round(v*10)/10).replace('.',',');}

// Avertissements sur la quantité et la stabilité des données. Rien n'est jamais exclu automatiquement.
// rows : lignes normalisées ; observations : sortie de selectObservations().
function diagnose(rows,observations){
  var out=[], xs=values(observations), n=xs.length;
  if(n===0){
    out.push({level:'fort',code:'vide',message:'Aucun trimestre exploitable : saisissez au moins les Features fabriquées.'});
    return out;
  }
  if(n<3) out.push({level:'fort',code:'tres-petit',message:'Moins de 3 observations ('+n+') : la méthode Student, qui estime une variance, est désactivée et le résultat n\'a qu\'une valeur indicative.'});
  else if(n<5) out.push({level:'fort',code:'petit',message:'Seulement '+n+' observations exploitables : l\'estimation est très fragile.'});

  if(n>=5){
    var sorted=ascending(xs), q1=quantileSorted(sorted,0.25), q3=quantileSorted(sorted,0.75), iqr=q3-q1;
    var atyp=observations.filter(function(o){return o.value<q1-1.5*iqr || o.value>q3+1.5*iqr;});
    if(atyp.length) out.push({level:'attention',code:'aberrant',message:'Valeur atypique : '+
      atyp.map(function(o){return quarterLabel(o.quarter)+' ('+fmt(o.value)+')';}).join(', ')+
      '. Elle reste prise en compte ; retirez-la manuellement si elle n\'est pas représentative.'});
  }
  if(n>=4){
    var prev=stats(xs.slice(0,n-1)), last=observations[n-1];
    if(prev.sd>0 && Math.abs(last.value-prev.mean)>2*prev.sd){
      out.push({level:'attention',code:'variation',message:'Forte variation récente : '+quarterLabel(last.quarter)+' ('+fmt(last.value)+
        ') s\'écarte nettement des trimestres précédents (moyenne '+fmt(prev.mean)+').'});
    }
  }
  if(n>=6){
    var h=Math.floor(n/2), a=stats(xs.slice(0,h)), b=stats(xs.slice(h));
    var se=Math.sqrt(a.variance/a.n+b.variance/b.n);
    if(se>0 && Math.abs(a.mean-b.mean)/se>2.5){
      out.push({level:'attention',code:'rupture',message:'Rupture apparente de niveau : '+fmt(a.mean)+' Features en moyenne sur les '+h+
        ' premiers trimestres, '+fmt(b.mean)+' sur les suivants. Envisagez de ne retenir que les derniers trimestres.'});
    }
  }
  var known=sortRows(rows).filter(function(r){return r.made!==null && r.made!==undefined;});
  if(known.length>=2){
    var first=quarterIndex(known[0].quarter), lastQ=quarterIndex(known[known.length-1].quarter), have={}, missing=[];
    known.forEach(function(r){have[quarterIndex(r.quarter)]=true;});
    for(var i=first;i<=lastQ;i++) if(!have[i]) missing.push(quarterLabel(quarterFromIndex(i)));
    if(missing.length) out.push({level:'attention',code:'manquant',message:'Données manquantes dans l\'historique : '+missing.join(', ')+'.'});
  }
  var incoh=rows.filter(function(r){return r.inconsistent;});
  if(incoh.length) out.push({level:'attention',code:'incoherent',message:'Incohérence entre fabriquées, engagées et prédictibilité : '+
    incoh.map(function(r){return quarterLabel(r.quarter);}).join(', ')+'.'});
  return out;
}

return {
  // données
  parseQuarter:parseQuarter, quarterKey:quarterKey, quarterIndex:quarterIndex, quarterFromIndex:quarterFromIndex,
  quarterLabel:quarterLabel, nextQuarter:nextQuarter, normalizeRow:normalizeRow, sortRows:sortRows,
  selectObservations:selectObservations, toCSV:toCSV, fromCSV:fromCSV, toJSON:toJSON, fromJSON:fromJSON,
  // statistique
  METHODS:METHODS, methodAvailable:methodAvailable, stats:stats, dispersion:dispersion,
  predictDeliveryConfidence:predictDeliveryConfidence,
  predictPredictabilityConfidence:predictPredictabilityConfidence,
  findMaxCommitment:findMaxCommitment,
  generateConfidenceCurve:generateConfidenceCurve,
  suggestRange:suggestRange,
  bootstrapUncertainty:bootstrapUncertainty,
  // qualité
  diagnose:diagnose
};
});
