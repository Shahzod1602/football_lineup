/* Normalized coordinates for object-fit: cover inside a fixed 16:9 program. */
const VideoGeometry = (() => {
  function multiply(a,b) { return Array.from({length:9},(_,i)=>[0,1,2].reduce((s,k)=>s+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0)); }
  function cover(width,height,aspect=16/9) {
    if (![width,height,aspect].every(v=>Number.isFinite(v)&&v>0)) throw new Error('Video o‘lchami tayyor emas.');
    const scale=Math.max(aspect/width,1/height), x=width*scale/aspect, y=height*scale;
    const forward=[x,0,(1-x)/2,0,y,(1-y)/2,0,0,1];
    const inverse=[1/x,0,(x-1)/(2*x),0,1/y,(y-1)/(2*y),0,0,1];
    return {
      toSource: ([u,v])=>[(u+(x-1)/2)/x,(v+(y-1)/2)/y],
      toStage: ([u,v])=>[x*u+(1-x)/2,y*v+(1-y)/2],
      toStageHomography: h=>multiply(multiply(forward,h),inverse),
    };
  }
  return {cover};
})();
if (typeof module!=='undefined') module.exports=VideoGeometry;
