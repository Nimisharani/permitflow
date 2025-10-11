
const n=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const round=(value,digits=2)=>Number(value.toFixed(digits));
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const parseJSON=(value,fallback=[])=>{try{return JSON.parse(value)}catch{return fallback}};
const valuesFrom=value=>String(value).split(/[\s,]+/).map(Number).filter(Number.isFinite);
const result=(status,summary,metrics,rows,detail='')=>({status,summary,metrics,rows,detail});
const erf=x=>{const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+0.3275911*a);const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);return sign*y};
const normalCdf=z=>0.5*(1+erf(z/Math.sqrt(2)));
const wilson=(successes,total)=>{if(!total)return[0,0];const z=1.96,p=successes/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/d;return[clamp(c-h,0,1),clamp(c+h,0,1)]};
const sha256=async value=>{const bytes=new TextEncoder().encode(String(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
const tag=(xml,name)=>xml.match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]?.trim()??'';
const similarity=(a,b)=>{const x=String(a).toLowerCase(),y=String(b).toLowerCase();if(x===y)return 1;const A=new Set(x.split(/\W+/).filter(Boolean)),B=new Set(y.split(/\W+/).filter(Boolean));const inter=[...A].filter(v=>B.has(v)).length;return inter/Math.max(1,new Set([...A,...B]).size)};

export const meta={"slug":"permitflow","name":"Permit Flow","eyebrow":"Database-enforced workflow","description":"Attempt a municipal permit transition and see whether department and state rules allow it.","fields":[{"name":"currentState","label":"Current state","type":"select","options":["DRAFT","SUBMITTED","PLANNING_REVIEW","FIRE_REVIEW","INSPECTION","APPROVED","ISSUED","REJECTED","WITHDRAWN"],"help":""},{"name":"department","label":"Acting department","type":"select","options":["APPLICANT","PLANNING","FIRE","INSPECTIONS","CLERK"],"help":""},{"name":"nextState","label":"Requested state","type":"select","options":["SUBMITTED","PLANNING_REVIEW","FIRE_REVIEW","INSPECTION","APPROVED","ISSUED","REJECTED","WITHDRAWN"],"help":""}]};
export const initialState={"currentState":"SUBMITTED","department":"CLERK","nextState":"ISSUED"};
export const alternateState={"currentState":"SUBMITTED","department":"PLANNING","nextState":"PLANNING_REVIEW"};
export async function compute(i){const transitions={DRAFT:{APPLICANT:['SUBMITTED','WITHDRAWN']},SUBMITTED:{PLANNING:['PLANNING_REVIEW','REJECTED']},PLANNING_REVIEW:{FIRE:['FIRE_REVIEW'],PLANNING:['REJECTED']},FIRE_REVIEW:{INSPECTIONS:['INSPECTION'],FIRE:['REJECTED']},INSPECTION:{INSPECTIONS:['APPROVED','REJECTED']},APPROVED:{CLERK:['ISSUED']}},allowed=transitions[i.currentState]?.[i.department]??[],ok=allowed.includes(i.nextState),terminal=['ISSUED','REJECTED','WITHDRAWN'].includes(i.currentState);return result(ok&&!terminal?'Transition applied':'Transition rejected',terminal?'Terminal permits cannot transition.':ok?`${i.department} may move the permit from ${i.currentState} to ${i.nextState}.`:`${i.department} cannot move ${i.currentState} directly to ${i.nextState}.`,[{label:'Current state',value:i.currentState},{label:'Department',value:i.department},{label:'Requested state',value:i.nextState},{label:'Database verdict',value:ok&&!terminal?'ACCEPT':'REJECT'}],(allowed.length?allowed:['No legal transitions']).map(state=>({legalNextState:state,department:i.department})), 'Illegal transitions are rejected even if a service attempts to bypass its own checks.')}
