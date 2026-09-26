export type Interval={start:number;end:number};
export function mergeIntervals(input:Interval[]):Interval[]{const xs=input.filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);const out:Interval[]=[];for(const x of xs){const last=out.at(-1);if(last&&x.start<=last.end)last.end=Math.max(last.end,x.end);else out.push({...x});}return out}
export function coverageMs(xs:Interval[]):number{return mergeIntervals(xs).reduce((n,x)=>n+x.end-x.start,0)}
export function dataQuality(n:number):'insufficient'|'low'|'normal'{return n<2?'insufficient':n<5?'low':'normal'}
