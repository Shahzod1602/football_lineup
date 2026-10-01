/* Pitch coordinates: u goes from our goal toward attack, v from left to right. */
const SmartLayout = (() => {
  const formations = {
    '433': [['GK',.10,.50],['RB',.29,.84],['RCB',.26,.62],['LCB',.26,.38],['LB',.29,.16],['RCM',.53,.72],['DM',.47,.50],['LCM',.53,.28],['LW',.77,.16],['ST',.85,.50],['RW',.77,.84]],
    '4231': [['GK',.10,.50],['RB',.28,.84],['RCB',.25,.62],['LCB',.25,.38],['LB',.28,.16],['RDM',.47,.66],['LDM',.47,.34],['AM',.67,.50],['LW',.71,.16],['ST',.87,.50],['RW',.71,.84]],
    '442': [['GK',.10,.50],['RB',.29,.84],['RCB',.26,.62],['LCB',.26,.38],['LB',.29,.16],['RM',.55,.84],['RCM',.52,.62],['LCM',.52,.38],['LM',.55,.16],['RST',.82,.67],['LST',.82,.33]],
    '352': [['GK',.10,.50],['RCB',.28,.74],['CB',.25,.50],['LCB',.28,.26],['LWB',.52,.10],['RCM',.53,.68],['DM',.46,.50],['LCM',.53,.32],['RWB',.52,.90],['RST',.82,.67],['LST',.82,.33]],
  };
  const normalizeRole = value => {
    const role = String(value || '').trim().toUpperCase();
    return ({CDM:'DM',CAM:'AM',CMF:'CM',DMF:'DM',AMF:'AM',CF:'ST',CBR:'RCB',CBL:'LCB'})[role] || role;
  };
  const family = role => {
    if (role === 'GK') return 'GK';
    if (['CB','LCB','RCB'].includes(role)) return 'CB';
    if (['LB','LWB'].includes(role)) return 'LB';
    if (['RB','RWB'].includes(role)) return 'RB';
    if (['CM','LCM','RCM','DM','LDM','RDM','AM'].includes(role)) return 'CM';
    if (['LM','LW'].includes(role)) return 'LW';
    if (['RM','RW'].includes(role)) return 'RW';
    if (['ST','LST','RST','SS'].includes(role)) return 'ST';
    return role;
  };
  function roleCost(player, slot) {
    const a = normalizeRole(player), b = normalizeRole(slot);
    if (a === b) return 0;
    if (a === 'GK' || b === 'GK') return 10000;
    if (family(a) === family(b)) {
      if (family(a) === 'CM') {
        const kind = r => r.endsWith('DM') ? 'DM' : r === 'AM' ? 'AM' : 'CM';
        return kind(a) === kind(b) ? 1 : 3;
      }
      return 1;
    }
    if ((family(a) === 'LW' && b === 'LWB') || (family(a) === 'RW' && b === 'RWB')) return 3;
    return 10;
  }
  function assignPlayers(players, formation) {
    const slots = formations[formation];
    if (!slots || players.length !== 11) throw new Error('11 futbolchi va formation kerak.');
    if (players.filter(p => normalizeRole(p.role) === 'GK').length !== 1) throw new Error('SQUAD ichida aynan bitta futbolchining rolini GK qiling.');
    // Minimum-cost one-to-one assignment; roster row order does not choose roles.
    const costs = Array(1 << 11).fill(Infinity), previous = Array(1 << 11);
    costs[0] = 0;
    for (let mask = 0; mask < costs.length; mask++) {
      const count = mask.toString(2).replaceAll('0', '').length;
      if (count === 11) continue;
      for (let j = 0; j < 11; j++) {
        if (mask & (1 << j)) continue;
        const next = mask | (1 << j), cost = costs[mask] + roleCost(players[count].role, slots[j][0]);
        if (cost < costs[next]) { costs[next] = cost; previous[next] = [mask, j]; }
      }
    }
    const assignment = Array(11);
    let mask = costs.length - 1;
    for (let i = 10; i >= 0; i--) {
      const [last, j] = previous[mask];
      assignment[i] = { role: slots[j][0], point: slots[j].slice(1), mismatch: roleCost(players[i].role, slots[j][0]) >= 3 };
      mask = last;
    }
    return assignment;
  }
  function project(point, h) {
    const [x,y] = point, d = h[6]*x + h[7]*y + h[8];
    if (Math.abs(d) < 1e-7) return null;
    const p = [(h[0]*x+h[1]*y+h[2])/d, (h[3]*x+h[4]*y+h[5])/d];
    return p.every(Number.isFinite) ? p : null;
  }
  function multiply(a,b) {
    return Array.from({length:9}, (_,i) => [0,1,2].reduce((s,k) => s + a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
  }
  function pitchMatrix(quad) {
    if (!Array.isArray(quad) || quad.length !== 4 || quad.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('Sxemadagi 4 nuqtani videoda belgilang.');
    const crosses = quad.map((p,i) => {
      const b=quad[(i+1)%4], c=quad[(i+2)%4];
      return (b[0]-p[0])*(c[1]-b[1])-(b[1]-p[1])*(c[0]-b[0]);
    });
    const area = Math.abs(quad.reduce((s,p,i) => s+p[0]*quad[(i+1)%4][1]-p[1]*quad[(i+1)%4][0],0))/2;
    if (area < .06 || !(crosses.every(v=>v>1e-4) || crosses.every(v=>v< -1e-4))) throw new Error('Nuqtalarni 1–2–3–4 tartibida belgilang; kengroq maydon ko‘rinsin.');
    const rows=[];
    [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i) => {
      const [x,y]=quad[i];
      rows.push([u,v,1,0,0,0,-u*x,-v*x,x], [0,0,0,u,v,1,-u*y,-v*y,y]);
    });
    for (let col=0; col<8; col++) {
      let pivot=col;
      for (let r=col+1;r<8;r++) if (Math.abs(rows[r][col])>Math.abs(rows[pivot][col])) pivot=r;
      if (Math.abs(rows[pivot][col])<1e-9) throw new Error('Maydon nuqtalari bir chiziqda bo‘lmasin.');
      [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
      const divisor=rows[col][col]; rows[col]=rows[col].map(v=>v/divisor);
      for (let r=0;r<8;r++) if (r!==col) {
        const factor=rows[r][col]; rows[r]=rows[r].map((v,j)=>v-factor*rows[col][j]);
      }
    }
    const h=[...rows.map(row=>row[8]),1];
    if ([[0,0],[1,0],[1,1],[0,1]].some(([x,y])=>h[6]*x+h[7]*y+1<.1)) throw new Error('Rakurs juda tor. Kengroq planni tanlang.');
    return h;
  }
  function depthFactors(assignment, h) {
    const areas=assignment.map(({point:[u,v]})=>{
      const p=project([u,v],h), x=project([u+.001,v],h), y=project([u,v+.001],h);
      if (!p || !x || !y) return 1;
      return Math.sqrt(Math.abs((x[0]-p[0])*(y[1]-p[1])-(x[1]-p[1])*(y[0]-p[0]))) || 1e-6;
    });
    const middle=[...areas].sort((a,b)=>a-b)[Math.floor(areas.length/2)];
    return areas.map(a=>Math.max(.82,Math.min(1.18,a/middle)));
  }
  function fitCards(points, depths, width, height, wantStats=true) {
    if (points.length!==11 || points.some(p=>!p || !p.every(Number.isFinite))) return {mode:'blocked', boxes:[]};
    const preferred=Math.max(78,Math.min(118,width*.087));
    const variants=[];
    if (wantStats) for (let scale=1;scale>=.6;scale-=.035) variants.push({mode:'full', width:preferred*scale, ratio:1.55, min:78});
    for (let scale=1;scale>=.6;scale-=.035) variants.push({mode:'no-stats',width:preferred*scale,ratio:1.28,min:64});
    for (const w of [112,100,88,80]) variants.push({mode:'compact',width:w,ratio:0,min:80});
    for (const candidate of variants) {
      const boxes=points.map((p,i)=>{
        const w=candidate.mode==='compact' ? candidate.width : candidate.width*depths[i];
        const h=candidate.mode==='compact' ? 28 : w*candidate.ratio;
        return {x:p[0]*width-w/2,y:p[1]*height-h,width:w,height:h};
      });
      if (boxes.some(b=>b.width<candidate.min || b.x<8 || b.y<32 || b.x+b.width>width-8 || b.y+b.height>height-12)) continue;
      let overlap=false;
      for (let i=0;i<11;i++) for (let j=i+1;j<11;j++) {
        const a=boxes[i],b=boxes[j],gap=7;
        if (a.x<b.x+b.width+gap && a.x+a.width+gap>b.x && a.y<b.y+b.height+gap && a.y+a.height+gap>b.y) overlap=true;
      }
      if (!overlap) return {mode:candidate.mode,boxes};
    }
    return {mode:'blocked',boxes:[]};
  }
  function plan(quad, players, formation) {
    const matrix=pitchMatrix(quad), slots=assignPlayers(players,formation);
    return {matrix,slots,positions:slots.map(slot=>project(slot.point,matrix).map(v=>v*100))};
  }
  return {plan,project,multiply,pitchMatrix,assignPlayers,depthFactors,fitCards,normalizeRole,roleCost};
})();
if (typeof module !== 'undefined') module.exports=SmartLayout;
