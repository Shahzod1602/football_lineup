const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../smart-layout.js');
const roles = ['GK','RB','CB','CB','LB','CM','DM','AM','LW','ST','RW'];
const players = roles.map((role,i)=>({role,number:String(i+1),name:`PLAYER ${i}`}));
const quad = [[.1,.12],[.85,.17],[.94,.92],[.06,.86]];

test('pitch corners map exactly, including mirrored camera views', () => {
  for (const q of [quad, quad.map(([x,y])=>[1-x,y])]) {
    const h=layout.pitchMatrix(q);
    [[0,0],[1,0],[1,1],[0,1]].forEach((p,i)=>{
      const actual=layout.project(p,h);
      assert.ok(Math.hypot(actual[0]-q[i][0],actual[1]-q[i][1])<1e-8);
    });
  }
});
test('invalid, crossed, degenerate and tiny pitch selections are rejected', () => {
  for (const q of [null, [[0,0],[1,1],[1,0],[0,1]], [[0,0],[.2,0],[.4,0],[.6,0]], [[.1,.1],[.2,.1],[.2,.2],[.1,.2]], [[0,0],[1,0],[1,NaN],[0,1]]]) assert.throws(()=>layout.pitchMatrix(q));
});
test('roles choose unique slots independently of roster row order', () => {
  const shuffled=[...players.slice(4),...players.slice(0,4)];
  const slots=layout.assignPlayers(shuffled,'433');
  const at=role=>slots[shuffled.findIndex(p=>p.role===role)];
  assert.equal(at('GK').role,'GK'); assert.equal(at('LW').role,'LW'); assert.equal(at('RW').role,'RW');
  assert.ok(at('LW').point[1]<at('RW').point[1]);
  assert.ok(at('GK').point[0]<at('ST').point[0]);
  assert.equal(new Set(slots.map(s=>s.point.join(','))).size,11);
  assert.ok(at('AM').mismatch, 'AM assigned to CM must be shown as a role mismatch');
});
test('all formations assign each player once and enforce one goalkeeper', () => {
  for (const f of ['433','4231','442','352']) assert.equal(layout.assignPlayers(players,f).length,11);
  assert.throws(()=>layout.assignPlayers(players.map(p=>({...p,role:'ST'})),'433'));
  assert.throws(()=>layout.assignPlayers(players.map(p=>({...p,role:'GK'})),'433'));
});
test('card fitting keeps foot anchors, readable minimums and no overlaps', () => {
  for (const formation of ['433','4231','442','352']) {
    const plan=layout.plan(quad,players,formation);
    const points=plan.positions.map(p=>p.map(v=>v/100));
    const fit=layout.fitCards(points,layout.depthFactors(plan.slots,plan.matrix),1440,810);
    assert.notEqual(fit.mode,'blocked', formation);
    fit.boxes.forEach((b,i)=>{
      assert.ok(Math.abs(b.x+b.width/2-points[i][0]*1440)<1e-8);
      assert.ok(Math.abs(b.y+b.height-points[i][1]*810)<1e-8);
      assert.ok(b.width>=64 && b.x>=8 && b.y>=32 && b.x+b.width<=1432 && b.y+b.height<=798);
      for (const c of fit.boxes.slice(i+1)) assert.ok(b.x+b.width<=c.x || c.x+c.width<=b.x || b.y+b.height<=c.y || c.y+c.height<=b.y);
    });
  }
});
test('overcrowded or out-of-frame views are blocked instead of shifting tactical positions', () => {
  assert.equal(layout.fitCards(Array.from({length:11},()=>[.5,.5]),Array(11).fill(1),1000,560).mode,'blocked');
  const plan=layout.plan(quad,players,'433');
  const points=plan.positions.map(p=>p.map(v=>v/100)); points[0]=[-.1,.5];
  assert.equal(layout.fitCards(points,Array(11).fill(1),1000,560).mode,'blocked');
});
test('readability falls back from portraits to compact cards and blocks a narrow viewport', () => {
  const plan=layout.plan([[.07,.12],[.91,.16],[.96,.94],[.04,.88]],players,'433');
  const points=plan.positions.map(p=>p.map(v=>v/100));
  const depths=layout.depthFactors(plan.slots,plan.matrix);
  for (const [width,mode] of [[1920,'full'],[1440,'no-stats'],[990,'compact'],[356,'blocked']]) {
    assert.equal(layout.fitCards(points,depths,width,width*9/16).mode,mode);
  }
  assert.notEqual(layout.fitCards(points,depths,1920,1080,false).mode,'full');
});
test('camera motion composes with the pitch map', () => {
  const map=layout.pitchMatrix(quad), motion=[1,0,.02,0,1,-.01,0,0,1];
  const point=[.4,.6], before=layout.project(point,map), after=layout.project(point,layout.multiply(motion,map));
  assert.ok(Math.abs(after[0]-before[0]-.02)<1e-8 && Math.abs(after[1]-before[1]+.01)<1e-8);
});
