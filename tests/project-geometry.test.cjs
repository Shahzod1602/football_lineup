const {test}=require('node:test');
const assert=require('node:assert/strict');
const data=require('../project-data.js');
const geometry=require('../video-geometry.js');
const layout=require('../smart-layout.js');
const team={club:'TEST',sponsor:'PARTNER',formation:'433',layoutAngle:90,teamColor:'#00ad76',accentColor:'#d8ff43',players:Array.from({length:11},(_,i)=>({number:String(i+1),name:'PLAYER',role:i?'CB':'GK',stat:'',photo:''})),positions:null};
const defaults={home:team,away:structuredClone(team)};
test('invalid imports are rejected without modifying the previous project',()=>{
 for(const mutate of [p=>p.teams.home.formation='999',p=>p.teams.home.players.pop(),p=>p.teams.home.players[0].photo="x');background:url(https://bad)",p=>p.teams.home.positions=Array(11).fill([NaN,50]),p=>p.layers={stats:'yes'},p=>p.version=999]){
  const before=JSON.stringify(defaults),incoming={version:3,teams:structuredClone(defaults)};mutate(incoming);
  assert.throws(()=>data.project(incoming,defaults));assert.equal(JSON.stringify(defaults),before);
 }
});
test('valid and legacy projects load as independent objects',()=>{
 const incoming={version:3,activeTeam:'away',teams:structuredClone(defaults),layers:{stats:false}};
 const output=data.project(incoming,defaults);output.teams.home.players[0].name='CHANGED';
 assert.equal(incoming.teams.home.players[0].name,'PLAYER');assert.equal(output.activeTeam,'away');assert.equal(output.layers.stats,false);
 delete incoming.teams.home.layoutAngle;assert.equal(data.project(incoming,defaults).teams.home.layoutAngle,null);
});
test('4:3 and portrait clicks account for the visible crop',()=>{
 const c=geometry.cover(640,480);assert.ok(Math.abs(c.toSource([.07,.12])[1]-.215)<1e-9);
 for(const [w,h] of [[640,480],[1920,1080],[1080,1920],[2560,1080]]){
  const g=geometry.cover(w,h);
  for(const p of [[0,0],[.2,.7],[1,1]]){const q=g.toStage(g.toSource(p));assert.ok(Math.hypot(q[0]-p[0],q[1]-p[1])<1e-9);}
 }
});
test('source camera motion composes into preview coordinates',()=>{
 const g=geometry.cover(640,480),h=[1.04,.01,.02,-.02,1.03,.04,.002,.003,1],p=[.25,.65];
 const expected=g.toStage(layout.project(g.toSource(p),h));const actual=layout.project(p,g.toStageHomography(h));
 assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<1e-9);
});
