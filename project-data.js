/* Validate into a new object before touching the active project or storage. */
const ProjectData = (() => {
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=()=>{throw new Error('Project ma’lumotlari noto‘g‘ri. Avvalgi loyiha saqlandi.');};
  function text(v,fallback,max) { if(v===undefined)return fallback; if(typeof v!=='string'||v.length>max)fail();return v; }
  function image(v='') { if(typeof v!=='string'||v.length>12*1024*1024||(v&&!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)))fail();return v; }
  function points(v,min,max,count=11) {
    if(!Array.isArray(v)||v.length!==count||v.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<min||n>max)))fail();
    return v.map(p=>[...p]);
  }
  function team(value,fallback) {
    if(!record(value))fail();
    const result={...fallback};
    for(const [key,max] of [['club',28],['sponsor',32]])result[key]=text(value[key],fallback[key],max);
    for(const key of ['teamColor','accentColor']) {result[key]=text(value[key],fallback[key],7);if(!/^#[0-9a-f]{6}$/i.test(result[key]))fail();}
    result.formation=value.formation??fallback.formation;
    if(!['433','4231','442','352'].includes(result.formation))fail();
    result.layoutAngle=value.layoutAngle??null;
    if(result.layoutAngle!==null&&![0,90,180,270].includes(result.layoutAngle))fail();
    result.logoUrl=image(value.logoUrl);
    result.positions=value.positions==null?null:points(value.positions,-100,200);
    const rows=value.players??fallback.players;
    if(!Array.isArray(rows)||rows.length!==11||rows.some(p=>!record(p)))fail();
    result.players=rows.map((p,i)=>({number:text(p.number,fallback.players[i].number,2),name:text(p.name,fallback.players[i].name,20),role:text(p.role,fallback.players[i].role,4),stat:text(p.stat,fallback.players[i].stat,38),photo:image(p.photo)}));
    result.autoLayout=null;
    if(value.autoLayout!=null) {
      const slots=value.autoLayout.slots;
      if(!Array.isArray(slots)||slots.length!==11||slots.some(s=>!record(s)))fail();
      result.autoLayout={slots:slots.map(s=>({role:text(s.role,'',4),point:points([s.point],0,1,1)[0]}))};
      if(result.autoLayout.slots.some(s=>!s.role))fail();
    }
    return result;
  }
  function layers(value={}) {if(!record(value))fail();const out={};for(const key of ['stats','lines'])if(value[key]!==undefined){if(typeof value[key]!=='boolean')fail();out[key]=value[key];}return out;}
  function project(value,fallbacks) {
    if(!record(value)||!record(value.teams)||(value.version!==undefined&&![1,2,3].includes(value.version)))fail();
    if(value.activeTeam!==undefined&&!['home','away'].includes(value.activeTeam))fail();
    return {teams:{home:team(value.teams.home,fallbacks.home),away:team(value.teams.away,fallbacks.away)},activeTeam:value.activeTeam??'home',layers:layers(value.layers)};
  }
  return {team,project,layers,points};
})();
if(typeof module!=='undefined')module.exports=ProjectData;
