// Tests du moteur : node --test
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('./moteur.js');

const EXEMPLE=[105,129,84,142,73,103,89,126,115,95];
const METHODES=['empirical',{type:'montecarlo',simulations:10000,seed:42},'student'];
const proche=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≉ ${b}`);

test('identité métier : F = 80, E = 100 donne P = 80 %',()=>{
  const r=M.normalizeRow({quarter:'2024-Q1',made:80,committed:100,predictability:null});
  proche(r.predictability,0.8,1e-12);
  assert.equal(r.derived,'predictability');
});

test('transformation : F = 40, P = 50 % donne E = 80',()=>{
  const r=M.normalizeRow({quarter:'2024-Q1',made:40,committed:null,predictability:0.5});
  proche(r.committed,80,1e-12);
  assert.equal(r.derived,'committed');
});

test('E et P fournis donnent F = P × E',()=>{
  const r=M.normalizeRow({quarter:'2024-Q1',made:null,committed:100,predictability:0.8});
  proche(r.made,80,1e-12);
});

test('E n\'est jamais inventé quand P est absent',()=>{
  const r=M.normalizeRow({quarter:'2026-Q1',made:115,committed:null,predictability:null});
  assert.equal(r.committed,null);
  assert.equal(r.predictability,null);
});

test('incohérence signalée au-delà de 1 point, tolérée en deçà',()=>{
  assert.equal(M.normalizeRow({quarter:'2024-Q1',made:80,committed:100,predictability:0.85}).inconsistent,true);
  assert.equal(M.normalizeRow({quarter:'2024-Q1',made:80,committed:100,predictability:0.805}).inconsistent,false);
});

test('condition de réussite : E = 100, cible 80 % réussi si et seulement si F ≥ 80',()=>{
  assert.equal(M.predictPredictabilityConfidence(100,0.8,[80],'empirical'),1);
  assert.equal(M.predictPredictabilityConfidence(100,0.8,[79],'empirical'),0);
  // 115 × 0,8 vaut 92,00000000000001 en virgule flottante : F = 92 doit rester un succès.
  assert.equal(M.predictPredictabilityConfidence(115,0.8,[92],'empirical'),1);
});

test('mode empirique : part des trimestres qui atteignent le seuil',()=>{
  proche(M.predictDeliveryConfidence(100,EXEMPLE,'empirical'),0.6,1e-12);
  proche(M.predictDeliveryConfidence(73,EXEMPLE,'empirical'),1,1e-12);
  proche(M.predictDeliveryConfidence(143,EXEMPLE,'empirical'),0,1e-12);
});

test('mode Student : valeurs de référence',()=>{
  const xs=[12,10,11,18,10,13,8,22];
  proche(M.predictDeliveryConfidence(13,xs,'student'),0.5,1e-9);
  proche(M.predictDeliveryConfidence(10,xs,'student'),0.717,0.005);
  proche(M.predictDeliveryConfidence(5,xs,'student'),0.924,0.005);
  proche(M.predictDeliveryConfidence(20,xs,'student'),0.101,0.005);
});

test('mode Monte-Carlo : reproductible à graine identique, proche de l\'empirique',()=>{
  const a=M.generateConfidenceCurve(EXEMPLE,{type:'montecarlo',simulations:10000,seed:7},0.8);
  const b=M.generateConfidenceCurve(EXEMPLE.slice(),{type:'montecarlo',simulations:10000,seed:7},0.8);
  assert.deepEqual(a,b);
  const c=M.predictDeliveryConfidence(100,EXEMPLE,{type:'montecarlo',simulations:10000,seed:8});
  proche(c,0.6,0.03);
});

test('monotonie : C(E1) ≥ C(E2) dès que E1 < E2, pour chaque méthode',()=>{
  for(const m of METHODES){
    let prec=1;
    for(let E=0;E<=300;E++){
      const c=M.predictPredictabilityConfidence(E,0.8,EXEMPLE,m);
      assert.ok(c<=prec+1e-12,`non monotone en E = ${E}`);
      assert.ok(c>=0 && c<=1);
      prec=c;
    }
  }
});

test('seuil 80/80 : C(E*) ≥ 0,8 et C(E* + 1) < 0,8, pour chaque méthode',()=>{
  for(const m of METHODES){
    const r=M.findMaxCommitment(0.8,0.8,EXEMPLE,m);
    assert.ok(r.feasible);
    assert.ok(Number.isInteger(r.commitment));
    assert.ok(M.predictPredictabilityConfidence(r.commitment,0.8,EXEMPLE,m)>=0.8-1e-12);
    assert.ok(M.predictPredictabilityConfidence(r.commitment+1,0.8,EXEMPLE,m)<0.8);
  }
});

test('seuil 80/80 empirique sur les données d\'exemple : 111 Features (8 trimestres sur 10 à 89 ou plus)',()=>{
  assert.equal(M.findMaxCommitment(0.8,0.8,EXEMPLE,'empirical').commitment,111);
});

test('Student indisponible sous 3 observations',()=>{
  assert.equal(M.methodAvailable('student',2),false);
  assert.throws(()=>M.predictDeliveryConfidence(10,[10,12],'student'));
  assert.equal(M.methodAvailable('empirical',2),true);
});

test('sélection de l\'historique : tous, N derniers, manuelle',()=>{
  const rows=[
    {quarter:'2024-Q2',made:20},{quarter:'2024-Q1',made:10},
    {quarter:'2024-Q3',made:30},{quarter:'2024-Q4',made:null}
  ];
  assert.deepEqual(M.selectObservations(rows,{mode:'all'}).map(o=>o.value),[10,20,30]);
  assert.deepEqual(M.selectObservations(rows,{mode:'last',last:2}).map(o=>o.value),[20,30]);
  assert.deepEqual(M.selectObservations(rows,{mode:'manual',excluded:['2024-Q2']}).map(o=>o.value),[10,30]);
});

test('trimestres : lecture, affichage, suivant',()=>{
  assert.equal(M.quarterKey(M.parseQuarter('T1-24')),'2024-Q1');
  assert.equal(M.quarterKey(M.parseQuarter('2025-q4')),'2025-Q4');
  assert.equal(M.parseQuarter('T5-24'),null);
  assert.equal(M.quarterLabel('2024-Q3'),'T3-24');
  assert.equal(M.nextQuarter('2024-Q4'),'2025-Q1');
});

test('CSV et JSON : aller-retour sans perte',()=>{
  const rows=[
    {quarter:'2024-Q1',made:105,committed:null,predictability:0.44},
    {quarter:'2024-Q2',made:129,committed:270,predictability:null},
    {quarter:'2026-Q3',made:null,committed:null,predictability:null}
  ];
  const csv=M.fromCSV(M.toCSV(rows));
  assert.deepEqual(csv.errors,[]);
  assert.equal(csv.rows.length,3);
  proche(csv.rows[0].predictability,0.44,1e-9);
  assert.equal(csv.rows[1].committed,270);
  assert.equal(csv.rows[2].made,null);
  const json=M.fromJSON(M.toJSON(rows,{predTarget:80}));
  assert.deepEqual(json.rows,rows);
  assert.equal(json.params.predTarget,80);
});

test('CSV : « NA », pourcentages et libellés T1-24 acceptés',()=>{
  const r=M.fromCSV('Trimestre;Fabriquées;Prédictibilité\nT1-24;105;44 %\nT1-26;115;NA');
  assert.deepEqual(r.errors,[]);
  assert.equal(r.rows[0].quarter,'2024-Q1');
  proche(r.rows[0].predictability,0.44,1e-9);
  assert.equal(r.rows[1].predictability,null);
});

test('contrôles : petit échantillon, valeur atypique, données manquantes',()=>{
  const obs=v=>v.map((x,i)=>({quarter:M.quarterFromIndex(8096+i),value:x}));
  const codes=(o,rows)=>M.diagnose(rows||o.map(x=>({quarter:x.quarter,made:x.value})),o).map(d=>d.code);
  assert.ok(codes(obs([10,12])).includes('tres-petit'));
  assert.ok(codes(obs([10,12,11,13])).includes('petit'));
  assert.ok(codes(obs([10,12,11,13,12,11,60])).includes('aberrant'));
  assert.deepEqual(codes(obs(EXEMPLE)),[]);
  const troue=[{quarter:'2024-Q1',made:10},{quarter:'2024-Q3',made:12}];
  assert.ok(codes(M.selectObservations(troue),troue).includes('manquant'));
});

test('incertitude bootstrap : intervalle ordonné, reproductible',()=>{
  const a=M.bootstrapUncertainty(EXEMPLE,0.8,0.8,{seed:3});
  const b=M.bootstrapUncertainty(EXEMPLE,0.8,0.8,{seed:3});
  assert.deepEqual(a,b);
  assert.ok(a.low<=a.median && a.median<=a.high);
});
