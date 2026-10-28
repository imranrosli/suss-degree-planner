'use strict';
const SEED=window.SUSS_SEED;
const REQUIREMENTS=[['suss_comp','SUSS Core Compulsory',15],['suss_people','SUSS Core — People',5],['suss_engage','SUSS Core — Engagement',10],['bme_comp','BME Compulsory',80],['bme_elec','BME Elective',20],['mnper_core','MNPER Core',20],['mnper_elec','MNPER Elective',10],['general','General Elective',10]];
const REQ=Object.fromEntries(REQUIREMENTS.map(x=>[x[0],{name:x[1],cu:x[2]}]));
const TOTAL=170,KEY='suss-planner-v2-user',IMPORTKEY='suss-planner-v2-imports';
const GRADE_POINTS={'A+':5,A:5,'A-':4.5,'B+':4,B:3.5,'B-':3,'C+':2.5,C:2,'D+':1.5,D:1,F:0};
const TERMS=[];for(let y=2025;y<=2042;y++){TERMS.push(`Jan ${y}`,`May ${y}`,`Jul ${y}`)}
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const NAV=[['dashboard','◫','Dashboard'],['planner','▦','Semester Planner'],['roadmap','♧','Degree Roadmap'],['catalogue','▤','Course Catalogue'],['grades','◈','Grades & Assessments'],['settings','⚙','Settings & Imports']];
const baseCatalogue=Object.fromEntries(SEED.catalogue.map(c=>[c.code,c]));

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://glfeeqrrmkkdbvujnvga.supabase.co'; // Replace with your Supabase Project URL
const SUPABASE_ANON_KEY = 'sb_publishable_jhs_j49D6kXIYTLOUk-N9w_jGzPCKpg'; // Replace with your Supabase anon public key
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser = null;

let state=load(KEY,{focus:'Jan 2027',targets:{'Jan 2027':15},records:{},choices:{},blocks:{},plans:{},future:{},scores:{},allowTG:false,manualCourses:{}});
let imports=load(IMPORTKEY,{schedule:{},metadata:{},importLog:[]});
let view='dashboard',tab='courses',selectedPlan='A',catalogueQuery='',catFilter='degree',statusFilter='all',activeCourse=null,stagedImport=null,courseScope='confirmed';
function $(id){return document.getElementById(id)}
function esc(a){return String(a??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(v){return Number(v||0).toLocaleString('en-SG',{maximumFractionDigits:1})}

// Modified save and load to support Supabase Cloud Sync
async function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify(state));
    localStorage.setItem(IMPORTKEY,JSON.stringify(imports));
  }catch(e){
    toast('Browser storage is full. Export a backup; large new schedule imports may need a browser storage upgrade.');
  }
  if(currentUser && supabaseClient){
    try{
      await supabaseClient.from('user_profiles').upsert({
        id: currentUser.id,
        planner_state: state,
        updated_at: new Date().toISOString()
      });
    }catch(err){
      console.error('Cloud sync failed:', err);
    }
  }
}

function load(k,def){try{const x=JSON.parse(localStorage.getItem(k));return x&&typeof x==='object'?x:def}catch(e){return def}}

async function initCloudSync(){
  if(!supabaseClient) return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user ?? null;
  updateAuthUI();
  if(currentUser){
    try{
      let { data, error } = await supabaseClient
        .from('user_profiles')
        .select('planner_state')
        .eq('id', currentUser.id)
        .single();
      if(data && data.planner_state){
        state = data.planner_state;
        purgeStalePlans();
        render();
      }
    }catch(e){
      console.error('Could not fetch cloud state:', e);
    }
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user ?? null;
    updateAuthUI();
    if(currentUser){
      let { data } = await supabaseClient
        .from('user_profiles')
        .select('planner_state')
        .eq('id', currentUser.id)
        .single();
      if(data && data.planner_state){
        state = data.planner_state;
        purgeStalePlans();
        render();
      }
    }
  });
}

function updateAuthUI() {
  const authBtn = $('authBtn');
  const authStatus = $('authStatus');
  if (authBtn && authStatus) {
    if (currentUser) {
      authBtn.textContent = 'Sign Out';
      authStatus.textContent = `● Logged in`;
      authStatus.style.color = '#367855';
    } else {
      authBtn.textContent = 'Sign In';
      authStatus.textContent = '● Offline mode';
      authStatus.style.color = '#788b7e';
    }
  }
}

function toast(m){$('toast').textContent=m;$('toast').classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>$('toast').classList.remove('show'),4000)}
function catalogue(){return {...baseCatalogue,...imports.metadata,...state.manualCourses}}
function course(code){return state.manualCourses[code]||imports.metadata[code]||baseCatalogue[code]||{code,name:code,cat:'unassigned',cu:0,prereq:'',offerings:[]}}
function optionsFor(term){return imports.schedule[term]||SEED.schedule[term]||{}}
function groupsFor(term,code){return optionsFor(term)[code]||{}}
function available(term,code){return Object.keys(groupsFor(term,code)).length>0}
function record(code){return state.records[code]||{status:'todo',grade:'',term:''}}
function earned(c){let r=record(c.code);return r.status==='completed'&&(r.grade==='P'||r.grade==='CR'||r.grade==='EX'||Object.hasOwn(GRADE_POINTS,r.grade)&&r.grade!=='F')}
// Registration choices are not academic history: an ongoing or passed course
// must never be suggested for a second registration unless a failed attempt is marked.
function registrationExclusion(c){
 const r=record(c.code);
 if(earned(c))return 'Already completed/passed';
 if(r.status==='inprogress')return 'Already in progress'+(r.term?' ('+r.term+')':'');
 if(r.status==='completed'&&r.grade!=='F')return 'Previous attempt completed; result pending';
 return '';
}
function canRegister(c){return !registrationExclusion(c)}
function catEarned(id){return Object.values(catalogue()).filter(c=>c.cat===id&&earned(c)).reduce((a,c)=>a+Number(c.cu||0),0)}
function catLeft(id){return Math.max(0,REQ[id].cu-catEarned(id))}
function earnedTotal(){return REQUIREMENTS.reduce((s,r)=>s+Math.min(r[2],catEarned(r[0])),0)}
function gpa(){let pts=0,cu=0;for(const c of Object.values(catalogue())){const r=record(c.code);if(r.status==='completed'&&Object.hasOwn(GRADE_POINTS,r.grade)){pts+=GRADE_POINTS[r.grade]*c.cu;cu+=c.cu}}return cu?`${(pts/cu).toFixed(2)} / 5.0`:'Not entered'}
function choices(term){return state.choices[term]||{}}
function termTarget(term){return Number(state.targets[term]||15)}
function niceTerm(t){return t.replace('Jan','January').replace('Jul','July')}
function picked(term){return Object.entries(choices(term)).filter(([code,v])=>v.priority&&v.priority!=='none'&&canRegister(course(code))).map(([code,v])=>({...v,code}))}
function weekday(d){return DAYS[new Date(d+'T12:00:00').getDay()]}
function clock(n){let h=Math.floor(n/60),m=n%60;return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`}
function datePretty(d){return new Date(d+'T12:00:00').toLocaleDateString('en-SG',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}
function cmp(a,b){return a.d===b.d&&a.s<b.e&&b.s<a.e}
function blocks(term){return state.blocks[term]||[]}
function clashBlock(events,term){const list=[];for(const e of events)for(const b of blocks(term)){if(b.date&&e.d!==b.date)continue;if(!b.date&&weekday(e.d)!==b.day)continue;if(e.s<b.end&&b.start<e.e)list.push({event:e,block:b})}return list}
function groupSessions(term,code,group){return (groupsFor(term,code)[group]||[]).map(s=>({...s,c:code,g:group}))}
function eventConflicts(incoming,existing){let found=[];for(const a of incoming)for(const b of existing){if(cmp(a,b))found.push([a,b])}return found}
function travelWarnings(list){let warns=[];const s=[...list].sort((a,b)=>a.d.localeCompare(b.d)||a.s-b.s);for(let i=1;i<s.length;i++){let a=s[i-1],b=s[i];if(a.d===b.d&&a.c!==b.c&&a.v!=='ONL'&&b.v!=='ONL'&&a.v!==b.v&&b.s>=a.e&&b.s-a.e<45)warns.push(`${a.c} → ${b.c}: only ${b.s-a.e} minutes between ${a.v} and ${b.v} on ${datePretty(a.d)}`)}return warns}
function passPrereq(code){const p=course(code).prereq||'';if(!p)return {ok:true,note:''};if(/90\s*CU/i.test(p))return {ok:false,note:'Advanced CU prerequisite needs manual verification'};let codes=[...new Set(p.match(/(?:BME|MTH|NIE|NCO|ENG)\d{3}/g)||[])];if(!codes.length)return {ok:false,note:'Prerequisite requires manual verification'};if(/programme dependent/i.test(p))return {ok:true,note:'Programme-specific prerequisite needs checking'};let missing=codes.filter(c=>!earned(course(c)));return missing.length?{ok:false,note:'Prerequisite not marked completed: '+missing.join(', ')}:{ok:true,note:''}}
function groupCandidates(term,code,variant){let all=Object.keys(groupsFor(term,code));if(!state.allowTG)all=all.filter(g=>g.startsWith('CRN'));all=all.filter(g=>!(groupsFor(term,code)[g]||[]).some(e=>e.r));const pref=(choices(term)[code]||{}).group;all.sort((a,b)=>a.localeCompare(b));if(variant!=='B'&&pref)all.sort((a,b)=>(a===pref?-1:0)-(b===pref?-1:0));if(variant==='B'&&pref)all.sort((a,b)=>(a===pref?1:0)-(b===pref?1:0));if(variant==='B'&&!pref)all.reverse();return all}
function fitCandidate(code,term,plan,variant){if(!canRegister(course(code)))return {reason:registrationExclusion(course(code))};let elig=passPrereq(code);if(!elig.ok)return {reason:elig.note};if(!REQ[course(code).cat])return {reason:'Course category is not assigned to a graduation requirement'};if(catLeft(course(code).cat)<=0)return {reason:'This category is already completed'};
 let best=null;for(const g of groupCandidates(term,code,variant)){let ses=groupSessions(term,code,g);if(!ses.length)continue;const bd=clashBlock(ses,term),hard=bd.filter(x=>x.block.kind==='hard');if(hard.length)continue;const collisions=eventConflicts(ses,plan.events);if(collisions.length)continue;let soft=bd.filter(x=>x.block.kind==='soft').length;let warning=travelWarnings([...ses,...plan.events]).length;let preference=choices(term)[code]?.group===g?0:1;let score=soft*10+warning*2+preference; if(variant==='B'&&preference===0)score+=6; if(!best||score<best.score)best={group:g,events:ses,soft,warnings:warning,score}}
 return best||{reason:available(term,code)?'All eligible CRNs conflict with classes, hard blocks, or restrictions':'No confirmed timetable for this semester'};}
function assessmentPenalty(code){const a=course(code).assessment||[];return a.reduce((s,x)=>s+(/EXAM/i.test(x.name)?x.w:0),0)}
function planBuild(term,variant,desired=[],avoid=new Set()){let ch=picked(term);let must=ch.filter(x=>x.priority==='must'),pref=ch.filter(x=>x.priority==='preferred'),back=ch.filter(x=>x.priority==='backup');let p={variant,courses:[],events:[],cu:0,notes:[],soft:0,travel:0,confirmed:true};let pickedSet=new Set();let usedCat={};let target=termTarget(term);
 const add=(x,force)=>{const code=x.code,c=course(code);if(pickedSet.has(code)||!canRegister(c))return false;
 let room=Math.max(0,catLeft(c.cat)-(usedCat[c.cat]||0));if(room<c.cu){if(x.priority==='must')p.notes.push(`${code}: would exceed this degree category's remaining CU requirement.`);return false}if(p.cu+c.cu>target&&!force)return false;if(c.cat==='mnper_core'&&['PAR307','PAR309'].includes(code)&&p.courses.some(item=>['PAR307','PAR309'].includes(item.code))){if(x.priority==='must')p.notes.push('PAR307 and PAR309 cannot both be included.');return false}
 let fit=fitCandidate(code,term,p,variant);if(!fit.group){if(x.priority==='must')p.notes.push(`${code}: ${fit.reason}`);return false}
 p.courses.push({code,group:fit.group,cu:c.cu,priority:x.priority||'suggested'});p.events.push(...fit.events);p.cu+=Number(c.cu||0);p.soft+=fit.soft;p.travel+=fit.warnings;usedCat[c.cat]=(usedCat[c.cat]||0)+Number(c.cu);pickedSet.add(code);return true};
 must.sort((a,b)=>a.code.localeCompare(b.code));for(const c of must)add(c,true);
 const sorted=arr=>arr.sort((a,b)=>{const ca=course(a.code),cb=course(b.code);let ar=catLeft(ca.cat),br=catLeft(cb.cat);return br-ar||assessmentPenalty(a.code)-assessmentPenalty(b.code)||a.code.localeCompare(b.code)});
 const requested=variant==='B'&&desired.length?desired.filter(x=>!must.some(m=>m.code===x.code)):(variant==='C'?[...sorted([...back]),...sorted([...pref])]:[...sorted([...pref]),...sorted([...back])]);
 for(const c of requested)add(c,false);
 if(variant!=='B'&&(variant==='C'||p.cu<target)){let extra=Object.values(catalogue()).filter(c=>REQ[c.cat]&&c.cu&&available(term,c.code)&&!pickedSet.has(c.code)&&canRegister(c)&&!choices(term)[c.code]?.priority&&catLeft(c.cat)>0&&passPrereq(c.code).ok).sort((a,b)=>(variant==='C'?(Number(avoid.has(a.code))-Number(avoid.has(b.code))):0)||catLeft(b.cat)-catLeft(a.cat)||assessmentPenalty(a.code)-assessmentPenalty(b.code)||a.code.localeCompare(b.code));for(const c of extra){if(p.cu>=target)break;add({code:c.code,priority:'suggested'},false)}}
 // Keep unscheduled / missing-CRN courses visible in the shortlist but never
 // silently count them as a checked, clash-free registration option.
 const omitted=must.filter(c=>!pickedSet.has(c.code));if(omitted.length)p.notes.unshift(`Must Take courses not accommodated: ${omitted.map(x=>x.code).join(', ')}`);
 for(const x of ch.filter(x=>!pickedSet.has(x.code)&&!available(term,x.code))){
  p.notes.push(`${x.code} (${x.priority}): no confirmed CRN / timetable for ${term}. It remains on your tentative shortlist, but is excluded from checked registration plans.`);
 }

 if(p.cu<target)p.notes.push(`${fmt(target-p.cu)} CU below your target; no additional confirmed, valid selection was found.`);
 p.travel=travelWarnings(p.events).length;p.verified=!!p.courses.length&&!!p.events.length&&!omitted.length;
 return p;}
function planSignature(p){return p.courses.map(c=>c.code+':'+c.group).sort().join(',')}
function sameCoursesAlternative(term,primary){
 if(!primary.courses.length)return null;
 let exact=primary.courses, best=null,tries=0;
 const original=Object.fromEntries(exact.map(c=>[c.code,c.group]));
 const walk=(i,selected,events,soft)=>{
  if(++tries>60000)return;
  if(i===exact.length){
   let changed=selected.filter(c=>c.group!==original[c.code]).length;
   if(!changed)return;
   let travel=travelWarnings(events).length;
   // Minimize flexible restrictions and travel first, then favor additional backup groups.
   let score=soft*20+travel*4-changed;
   if(!best||score<best.score)best={score,selected,events,soft,travel};
   return;
  }
  let item=exact[i],all=groupCandidates(term,item.code,'B');
  for(let g of all){
   let ses=groupSessions(term,item.code,g);if(!ses.length)continue;
   const b=clashBlock(ses,term);if(b.some(x=>x.block.kind==='hard'))continue;
   if(eventConflicts(ses,events).length)continue;
   walk(i+1,[...selected,{...item,group:g}],[...events,...ses],soft+b.filter(x=>x.block.kind==='soft').length);
  }
 };
 walk(0,[],[],0);
 if(!best)return null;
 return {variant:'B',courses:best.selected,events:best.events,cu:primary.cu,notes:[],soft:best.soft,travel:best.travel,verified:primary.verified};
}
function generatePlans(term){let a=planBuild(term,'A'),b=sameCoursesAlternative(term,a)||planBuild(term,'B',a.courses),c=planBuild(term,'C',[],new Set(a.courses.filter(x=>x.priority==='suggested').map(x=>x.code)));let out={A:a,B:b,C:c};if(a.courses.map(x=>x.code).sort().join('|')!==b.courses.map(x=>x.code).sort().join('|'))b.notes.push('Could not retain every Plan A course with alternative CRNs. Plan B contains only compatible courses; no substitutions were made.');if(planSignature(a)===planSignature(b))b.notes.push('No distinct alternative CRN combination was found with these constraints.');if(planSignature(a)===planSignature(c))c.notes.push('No distinct alternative course combination was found under the current constraints.');return out}
function snapshotPlan(p){return {variant:p.variant,courses:p.courses,cu:p.cu,notes:p.notes,soft:p.soft,travel:p.travel,verified:p.verified,created:new Date().toISOString()}}
function chosenEvents(term){let selections=state.plans[term]?.approved?.courses||picked(term).map(x=>({code:x.code,group:x.group}));return selections.flatMap(p=>groupSessions(term,p.code,p.group||Object.keys(groupsFor(term,p.code))[0]))}
function warningsForEvents(events,term){let overlaps=eventConflicts(events,events).filter(([a,b])=>a.c!==b.c);let dedup=[...new Set(overlaps.map(([a,b])=>`${datePretty(a.d)}: ${a.c} ${a.g} and ${b.c} ${b.g} (${clock(Math.max(a.s,b.s))}–${clock(Math.min(a.e,b.e))})`))];return [...dedup,...clashBlock(events,term).filter(x=>x.block.kind==='hard മറ്റൊരു'||x.block.kind==='hard').map(x=>`${x.event.c}: hard-blocked ${datePretty(x.event.d)}`)]}
function nav(){ $('nav').innerHTML=NAV.map(([id,icon,name])=>`<button class="navbtn ${view===id?'active':''}" data-view="${id}"><span class="ni">${icon}</span>${name}</button>`).join('');$('crumb').textContent=NAV.find(x=>x[0]===view)?.[2]||'Dashboard';$('sidebarCUs').textContent=`${fmt(earnedTotal())} / ${TOTAL} CU`;$('sidebarMeter').style.width=(100*earnedTotal()/TOTAL)+'%'}
function head(eyebrow,title,subtitle,button=''){return `<div class="headline"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p class="subhead">${esc(subtitle)}</p></div>${button}</div>`}
function render(){nav();$('content').innerHTML=({dashboard:dashboard,planner:planner,roadmap:roadmap,catalogue:courseCatalogue,grades:grades,settings:settings})[view]();}
function progressRow(r){let done=Math.min(r[2],catEarned(r[0]));return `<div><div class="progress-head"><strong>${esc(r[1])}</strong><span class="muted">${fmt(done)} / ${fmt(r[2])} CU</span></div><div class="bar"><i style="width:${(done/r[2]*100).toFixed(2)}%"></i></div></div>`}
function startDateText(){let curr=state.focus;return niceTerm(curr)}
function dashboard(){const done=earnedTotal(),left=TOTAL-done,plan=state.plans[state.focus]?.approved;const forecasts=forecast(15);return head('MY ACADEMIC WORKSPACE','Your degree at a glance','One calming place to manage course registration, academic progress and graduation.')+`<div class="stats"><div class="card stat"><div class="label">Completed credits</div><div class="metric">${fmt(done)} <span class="tiny">/ 170 CU</span></div><small class="muted">Based on entered completed results</small></div><div class="card stat"><div class="label">Remaining credits</div><div class="metric">${fmt(left)} <span class="tiny">CU</span></div><small class="muted">Across eight separate requirements</small></div><div class="card stat"><div class="label">Estimated GPA</div><div class="metric" style="font-size:24px">${esc(gpa())}</div><small class="muted">Personal estimate; not official CGPA</small></div><div class="card stat"><div class="label">Graduation projection</div><div class="metric" style="font-size:22px">${esc(forecasts||'Needs data')}</div><small class="muted">Tentative completion semester</small></div></div><div class="two"><section class="card"><div class="card-title"><h2>Degree requirement progress</h2><span class="pill info">${(done/TOTAL*100).toFixed(0)}% complete</span></div><div class="progress-list">${REQUIREMENTS.map(progressRow).join('')}</div><p class="footer">Excess CU in one category never automatically counts toward another category.</p></section><section class="cards"><div class="card"><div class="card-title"><h2>Next semester</h2><span class="pill info">${esc(niceTerm(state.focus))}</span></div><div class="mini-stats"><span>Target <strong>${fmt(termTarget(state.focus))} CU</strong></span><span>Selected <strong>${picked(state.focus).length} courses</strong></span></div>${plan?`<div class="note">Approved plan: ${plan.courses.map(c=>esc(c.code+' '+c.group)).join(' · ')} · ${fmt(plan.cu)} CU</div>`:`<div class="note">Your registration plan is not approved yet. Choose courses and generate Plans A, B and C.</div>`}<div style="margin-top:16px"><button class="btn" data-view="planner">Open semester planner →</button></div></div><div class="card"><div class="card-title"><h2>Study-load comparison</h2><span class="pill">Forecast only</span></div><div class="list">${[10,15,20].map(cu=>`<div class="between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span>${cu} CU / semester</span><strong>${esc(forecast(cu)||'—')}</strong></div>`).join('')}</div><p class="footer">Forecasts use optimistic future presentations and verified prerequisites where possible. They are not official SUSS dates or guarantees.</p></div></section></div>`}
function chooserOptions(term){return TERMS.filter(x=>x.startsWith('Jan')||x.startsWith('Jul')||x.startsWith('May')).filter(x=>parseInt(x.slice(-4))>=2026&&parseInt(x.slice(-4))<=2040).map(x=>`<option ${state.focus===x?'selected':''}>${x}</option>`).join('')}
function chosenPicker(c,term){const ch=choices(term)[c.code]||{},g=Object.keys(groupsFor(term,c.code)).filter(x=>state.allowTG||x.startsWith('CRN'));const scheduled=available(term,c.code);return `<div class="course ${scheduled?'':'course-unconfirmed'}"><div class="course-info"><div class="course-code">${esc(c.code)} <span class="pill">${fmt(c.cu)} CU</span></div><div class="course-name">${esc(c.name)}</div><div class="meta">${esc(REQ[c.cat]?.name||'Unclassified')} · ${scheduled?g.length+' '+(state.allowTG?'groups':'evening CRNs'):'No published CRN'} · ${c.prereq?'Prerequisite: '+esc(c.prereq):'No prerequisite listed'}${scheduled?'':' · TIMETABLE UNCONFIRMED — tentative only'}</div></div><div class="course-actions"><select data-choice="${esc(c.code)}" aria-label="Priority for ${esc(c.code)}"><option value="none">Not selected</option>${[['must','Must Take'],['preferred','Preferred'],['backup','Backup']].map(([v,l])=>`<option ${ch.priority===v?'selected':''} value="${v}">${l}</option>`).join('')}</select>${scheduled?`<select data-group="${esc(c.code)}" aria-label="Preferred group for ${esc(c.code)}"><option value="">Any CRN</option>${g.map(gi=>`<option ${ch.group===gi?'selected':''} value="${esc(gi)}">${gi}${(groupsFor(term,c.code)[gi]||[]).some(e=>e.r)?' · Restricted':''}</option>`).join('')}</select>`:'<span class="pill warn">CRN unconfirmed</span>'}<button class="btn small outline" data-course="${esc(c.code)}">Details</button></div></div>`}
function planner(){let term=state.focus,off=optionsFor(term);
 const degree=Object.values(catalogue()).filter(c=>REQ[c.cat]&&c.cu>0&&canRegister(c));
 const eligible=degree.filter(c=>available(term,c.code));
 const unscheduled=degree.filter(c=>!available(term,c.code));
 const chosenCodes=new Set(picked(term).map(x=>x.code));
 const availableCourses=eligible.filter(c=>!chosenCodes.has(c.code));
 const otherCourses=unscheduled.filter(c=>!chosenCodes.has(c.code));
 const sort=(a,b)=>a.code.localeCompare(b.code);
 const selected=degree.filter(c=>chosenCodes.has(c.code)).sort(sort);
 availableCourses.sort(sort);otherCourses.sort(sort);
 const currentlyStudying=Object.values(catalogue()).filter(c=>REQ[c.cat]&&record(c.code).status==='inprogress');
 const no=Object.keys(off).length===0;
 return head('COURSE REGISTRATION',niceTerm(term),'Choose courses and let the app find compatible actual-date timetables.',`<button class="btn small outline" data-view="settings">↑ Import schedule</button>`)+`<div class="toolbar"><label class="fieldlabel">Semester<select id="focusTerm">${chooserOptions()}</select></label><label class="fieldlabel">Target CU<input id="targetCu" type="number" value="${termTarget(term)}" min="2.5" max="40" step="2.5"></label><span class="pill ${no?'warn':'ok'}">${no?'No exact schedule imported':Object.keys(off).length+' courses in full schedule'}</span><span class="spacer"></span><button class="btn" id="generate">✧ Generate Plans A, B & C</button></div>${no?'<div class="note warning">Exact timetable not imported for this semester. The unscheduled list is for tentative planning only; verified clash-free registration plans require a full schedule.</div>':''}${currentlyStudying.length?`<div class="note" style="margin-bottom:15px"><strong>Already studying — excluded from new registration suggestions:</strong> ${currentlyStudying.map(c=>esc(c.code)+(record(c.code).term?' ('+esc(record(c.code).term)+')':'')).join(' · ')}. These courses remain in the Course Catalogue and Grades pages.</div>`:''}<div class="tabs">${[['courses','Course Selection'],['calendar','Dated Calendar'],['plans','Plans A / B / C']].map(([v,n])=>`<button class="tab ${tab===v?'active':''}" data-tab="${v}">${n}</button>`).join('')}</div>${tab==='courses'?`<div class="two"><section class="card"><div class="card-title"><h2>My shortlisted courses</h2><span class="pill">${picked(term).length} selected</span></div>${selected.length?`<div class="list">${selected.map(c=>chosenPicker(c,term)).join('')}</div>`:'<div class="empty">Choose courses from the lists on the right. Set Must Take, Preferred or Backup.</div>'}<p class="footer">"Must Take" choices are protected as far as a valid timetable allows. You can specify a preferred CRN or let the planner decide.</p></section><section class="card"><div class="card-title"><h2>Degree course options</h2><span class="pill">${availableCourses.length} scheduled · ${otherCourses.length} unscheduled</span></div><input class="field search" id="semesterSearch" placeholder="Search all degree courses, including PAR301…" style="width:100%;margin-bottom:12px"><div class="tabs" style="margin-bottom:13px"><button class="tab ${courseScope==='confirmed'?'active':''}" data-course-scope="confirmed">Confirmed CRNs · ${availableCourses.length}</button><button class="tab ${courseScope==='unscheduled'?'active':''}" data-course-scope="unscheduled">No confirmed CRN · ${otherCourses.length}</button></div><div id="availableList" style="max-height:620px;overflow:auto"><div class="listing-group" id="confirmedCourses" ${courseScope==='confirmed'?'':'style="display:none"'}><h3>Confirmed in ${esc(niceTerm(term))} timetable <span class="pill ok">${availableCourses.length}</span></h3><div class="list">${availableCourses.map(c=>chosenPicker(c,term)).join('')||'<div class="empty">No confirmed courses match.</div>'}</div></div><div class="listing-group" id="unscheduledCourses" ${courseScope==='unscheduled'?'':'style="display:none"'}><h3>Other degree courses — no confirmed CRN <span class="pill warn">${otherCourses.length}</span></h3><p class="subhead" style="margin:6px 0 13px">Including MNPER options such as PAR301. You may mark them as tentative priorities, but they will not appear in a clash-checked registration plan until the semester timetable confirms a CRN.</p><div class="list">${otherCourses.map(c=>chosenPicker(c,term)).join('')||'<div class="empty">All degree courses have a confirmed timetable.</div>'}</div></div></div><p class="footer">Already in-progress or successfully completed courses are excluded from these lists. Unclassified courses remain in the Course Catalogue for review.</p></section></div>`:tab==='calendar'?renderCalendar(term):renderPlans(term)}`}
function renderCalendar(term){let ev=chosenEvents(term);let warn=warningsForEvents(ev,term);const by={};for(const e of ev){by[e.d]??=[];by[e.d].push(e)}const dates=Object.keys(by).sort();return `<section class="card"><div class="card-title"><h2>Actual dated sessions</h2><span class="pill">${ev.length} sessions</span></div><div class="note">Showing approved Plan A/B/C when available, otherwise your shortlisted preferred CRNs. Classes on the same weekday are allowed if their actual dates and times don't overlap.</div>${warn.map(w=>`<div class="note error">${esc(w)}</div>`).join('')}<div class="table-wrap" style="margin-top:15px"><table><thead><tr><th>Date</th><th>Course / Group</th><th>Class type</th><th>Time</th><th>Campus</th></tr></thead><tbody>${dates.slice(0,150).flatMap(d=>by[d].sort((a,b)=>a.s-b.s).map(e=>`<tr><td>${esc(datePretty(d))}</td><td>${esc(e.c)} · ${esc(e.g)}</td><td>${esc(e.m)}</td><td>${clock(e.s)}–${clock(e.e)}</td><td>${esc(e.v)}</td></tr>`)).join('')||'<tr><td colspan="5">No CRNs selected yet.</td></tr>'}</tbody></table></div>${dates.length>150?'<p class="footer">Showing the first 150 session dates for readability.</p>':''}</section>`}
function renderPlans(term){const obj=state.plans[term],list=obj?.generated||{};let selected=list[selectedPlan];return `<section class="card"><div class="card-title"><h2>Automatically generated plans</h2>${obj?.updated?`<span class="tiny">Generated ${esc(new Date(obj.updated).toLocaleString('en-SG'))}</span>`:''}</div><div class="note">Plans are ranked by your priority tiers, eligibility, actual class/lab/exam dates, semester CU target, personal restrictions, then assessment workload. Seat availability is never guaranteed.</div><div class="tabs" style="margin-top:16px">${[['A','Plan A · Preferred'],['B','Plan B · Other CRNs'],['C','Plan C · Backup courses']].map(([a,b])=>`<button class="tab ${selectedPlan===a?'active':''}" data-plan="${a}">${b}</button>`).join('')}</div>${selected?`<div class="plan ${selectedPlan==='A'?'top':''}"><div class="title-row"><h2>Plan ${selectedPlan}</h2><span class="pill ${selected.verified?'ok':'warn'}">${selected.verified?'Sessions checked':'Needs review'}</span></div><div class="mini-stats" style="margin-top:12px"><span><strong>${fmt(selected.cu)} CU</strong> / ${fmt(termTarget(term))} target</span><span><strong>${selected.courses.length}</strong> courses</span><span><strong>${selected.soft}</strong> flexible-block overlaps</span><span><strong>${selected.travel}</strong> travel warnings</span></div><div class="plan-list">${selected.courses.map(c=>`<div class="plan-course"><span><strong>${esc(c.code)}</strong> · ${esc(course(c.code).name)} <small class="muted">(${esc(c.priority)})</small></span><span class="no-wrap"><strong>${esc(c.group)}</strong> · ${fmt(c.cu)} CU</span></div>`).join('')||'<div class="empty">No eligible courses could be scheduled.</div>'}</div>${selected.notes.map(n=>`<div class="note warning">${esc(n)}</div>`).join('')}${selected.soft?'<div class="note warning">Some sessions overlap your flexible preferences. Check before approving.</div>':''}${selected.travel?'<div class="note warning">One or more back-to-back campus changes may need more travel time.</div>':''}<div class="toolbar" style="margin:18px 0 0"><button class="btn" data-approve="${selectedPlan}" ${!selected.courses.length?'disabled':''}>✓ Approve Plan ${selectedPlan}</button><button class="btn outline" data-copyplan="${selectedPlan}">Copy CRN checklist</button><button class="btn light" data-view="planner" data-tab="calendar">View sessions →</button></div></div>`:'<div class="empty" style="margin-top:16px">Your generated plans will appear here. Select courses then click “Generate Plans A, B & C”.</div>'}${obj?.approved?`<div class="note">Approved: Plan ${esc(obj.approved.variant)}, ${fmt(obj.approved.cu)} CU. Remember this is a personal plan, not an SUSS registration.</div>`:''}</section>`}
function canForecastTake(c,t,done){const p=c.prereq||'';let codes=[...new Set(p.match(/(?:BME|NIE|NCO|MTH|ENG)\d{3}/g) || [])];if(/90\s*CU/i.test(p))return done.filter(code=>course(code).cat!=='suss_comp'&&course(code).cat!=='suss_people'&&course(code).cat!=='suss_engage').reduce((a,code)=>a+(course(code).cu||0),0)>=90;if(/programme dependent/i.test(p))return true;return codes.every(code=>done.includes(code))}
function likelyOffered(c,t){if(available(t,c.code))return true;if((c.offerings||[]).includes(t))return true;let yy=Number(t.slice(-4)),month=t.slice(0,3);if(yy<=2028&&c.offerings?.length)return false;let p=(c.pattern||'').toUpperCase();if(p.includes('EVERY JAN'))return month==='Jan';if(p.includes('EVERY JUL'))return month==='Jul';if(p.includes('ALL SEMESTERS'))return true;if(p.includes('EVERY REGULAR'))return month!=='May';if(month==='May')return false;let o=c.offerings||[];let j=o.some(x=>x.startsWith('Jan')),l=o.some(x=>x.startsWith('Jul'));if(j&&!l)return month==='Jan';if(l&&!j)return month==='Jul';return true}
function simulate(target){
 let ongoing=Object.values(catalogue()).filter(c=>REQ[c.cat]&&c.cu>0&&record(c.code).status==='inprogress');
 let done=[...new Set([...Object.values(catalogue()).filter(earned).map(x=>x.code),...ongoing.map(x=>x.code)])];
 let left=Object.fromEntries(REQUIREMENTS.map(r=>[r[0],Math.max(0,catLeft(r[0])-ongoing.filter(c=>c.cat===r[0]).reduce((sum,c)=>sum+Number(c.cu),0))]));let start=Math.max(TERMS.indexOf('Jan 2027'),TERMS.indexOf(state.focus));if(start<0)start=TERMS.indexOf('Jan 2027');let details=[];let end='';let deferred={};
 for(let i=start;i<TERMS.length;i++){let term=TERMS[i];if(term.startsWith('May')&&!Object.keys(state.future[term]||{}).length)continue;let limit=Number(state.targets[term]||target),used=0,entries=[];let cands=Object.values(catalogue()).filter(c=>REQ[c.cat]&&c.cu>0&&!done.includes(c.code)&&left[c.cat]>=c.cu&&likelyOffered(c,term)&&canForecastTake(c,term,done));cands.sort((a,b)=>(state.future[term]?.[b.code]?1:0)-(state.future[term]?.[a.code]?1:0)||left[b.cat]-left[a.cat]||a.code.localeCompare(b.code));for(let c of cands){if(used+c.cu>limit||left[c.cat]<c.cu)continue;if(c.cat==='mnper_core'&&['PAR307','PAR309'].includes(c.code)&&[...done,...entries].some(x=>['PAR307','PAR309'].includes(x)))continue;used+=Number(c.cu);left[c.cat]-=Number(c.cu);entries.push(c.code)}
 if(!term.startsWith('May')){while(left.general>0&&used+2.5<=limit){let step=Math.min(5,left.general,limit-used);if(step<2.5)break;used+=step;left.general-=step;entries.push('General Elective (TBD) '+fmt(step)+' CU');}}
 done.push(...entries.filter(c=>!c.includes(' (TBD) ')));details.push({term,cu:used,courses:entries});if(Object.values(left).every(x=>x<=0)){end=term;break}if(i>TERMS.indexOf('Jan 2040'))break}
 return {end,details,left}}
function forecast(target){let {end}=simulate(target);return end?niceTerm(end):'Insufficient data'}
function roadmap(){const base=simulate(termTarget(state.focus));const cs=Object.entries(state.future).flatMap(([term,codes])=>Object.entries(codes).filter(([,v])=>v).map(([code])=>({term,code})));let preview=base.details.filter(x=>Number(x.term.slice(-4))<=2033).slice(0,12);return head('DEGREE ROADMAP','Plan beyond next semester','Explore tentative future courses, approve postponements, and compare paths to graduation.')+`<div class="stats">${[10,15,20].map(n=>`<div class="card stat"><div class="label">${n} CU / regular semester</div><div class="metric" style="font-size:20px">${esc(forecast(n))}</div><div class="tiny">Tentative completion</div></div>`).join('')}<div class="card stat"><div class="label">Current planning target</div><div class="metric">${fmt(termTarget(state.focus))} CU</div><small class="muted">For ${esc(niceTerm(state.focus))}</small></div></div><div class="two"><section class="card"><div class="card-title"><h2>Projected degree progression</h2><span class="pill warn">Forecast, not confirmed timetable</span></div><div class="roadmap">${preview.map(x=>`<div class="road-term"><div><strong>${esc(niceTerm(x.term))}</strong><p class="tagline">${fmt(x.cu)} CU projected</p></div><div class="label">${esc(x.courses.join(' · ')||'No eligible courses estimated')}${x.courses.length?'<p class="footer">Illustrative allocation, not approved or registered.</p>':''}</div></div>`).join('')}</div></section><section class="cards"><div class="card"><div class="card-title"><h2>Future-semester moves</h2></div><p class="subhead" style="margin-bottom:16px">Choose a postponed course and target semester. The forecast will give it priority there, without altering your registration plan.</p><div class="stack"><label class="fieldlabel">Course<select id="postponeCourse">${Object.values(catalogue()).filter(c=>REQ[c.cat]&&!earned(c)).sort((a,b)=>a.code.localeCompare(b.code)).map(c=>`<option value="${c.code}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label><label class="fieldlabel">Move to<select id="postponeTerm">${TERMS.filter(x=>parseInt(x.slice(-4))>=2027&&parseInt(x.slice(-4))<=2039).map(x=>`<option value="${x}">${esc(niceTerm(x))}</option>`).join('')}</select></label><button class="btn" id="postpone">Suggest & save future placement</button></div>${cs.length?`<div style="margin-top:17px"><h3>Saved future placements</h3>${cs.map(x=>`<div class="switchline"><span>${esc(x.code)} → ${esc(niceTerm(x.term))}</span><button class="btn small outline" data-removefuture="${esc(x.term)}|${esc(x.code)}">Remove</button></div>`).join('')}</div>`:''}</div><div class="card"><h2 style="margin-bottom:12px">Forecast limitations</h2><div class="note warning">The estimates assume courses marked In progress are eventually passed (they do not yet count as completed CU). Category-specific requirements and known presentation patterns are considered, but future seats, timetable clashes, academic results, eligibility rules, and SUSS course availability cannot be predicted. Special semesters count only when specifically planned. BME499 is a multi-semester project and may extend the academic timeline.</div></div></section></div>`}
function courseCatalogue(){const search=catalogueQuery.toLowerCase().trim();const all=Object.values(catalogue()).filter(c=>(catFilter==='all'||catFilter==='degree'&&REQ[c.cat]||c.cat===catFilter)&&(statusFilter==='all'||record(c.code).status===statusFilter)&&(!search||`${c.code} ${c.name}`.toLowerCase().includes(search))).sort((a,b)=>a.code.localeCompare(b.code));return head('COURSE CATALOGUE','Explore all your courses','Browse degree categories, presentation patterns, eligibility and assessment details.',`<button class="btn small outline" id="addCourse">+ Add course</button>`)+`<div class="toolbar"><input class="field search" id="catalogueSearch" placeholder="Search course code or name" value="${esc(catalogueQuery)}"><select id="catFilter"><option value="degree" ${catFilter==='degree'?'selected':''}>My degree courses</option><option value="all" ${catFilter==='all'?'selected':''}>All imported courses (including unclassified)</option>${REQUIREMENTS.map(r=>`<option value="${r[0]}" ${catFilter===r[0]?'selected':''}>${esc(r[1])}</option>`).join('')}<option value="unassigned" ${catFilter==='unassigned'?'selected':''}>Unclassified / review</option></select><select id="statusFilter"><option value="all">Any progress</option>${[['todo','Not started'],['planned','Planned'],['inprogress','In progress'],['completed','Completed']].map(([v,t])=>`<option ${statusFilter===v?'selected':''} value="${v}">${t}</option>`).join('')}</select><span class="pill">${all.length} matching courses</span></div><div class="card"><div class="list">${all.slice(0,160).map(c=>`<div class="course"><div class="course-info"><div class="course-code">${esc(c.code)} <span class="pill">${fmt(c.cu||0)} CU</span></div><div class="course-name">${esc(c.name||'Title not imported')}</div><div class="meta">${esc(REQ[c.cat]?.name||'Category not assigned')} · ${esc(c.pattern||'Presentation requires verification')} · ${esc(record(c.code).status)}</div></div><div class="course-actions"><span class="pill ${earned(c)?'ok':''}">${earned(c)?'Completed':(c.assessment?c.assessment.length+' assessments':'Matrix not imported')}</span><button class="btn small outline" data-course="${esc(c.code)}">View / Edit →</button></div></div>`).join('')||'<div class="empty">No courses match these filters.</div>'}</div>${all.length>160?`<p class="footer">Showing first 160 results. Filter by category or search code for more specific results.</p>`:''}</div>`}
function grades(){let courses=Object.values(catalogue()).filter(c=>REQ[c.cat]&&c.cu&& (record(c.code).status!=='todo'||c.assessment)).sort((a,b)=>a.code.localeCompare(b.code));let pending=Object.values(catalogue()).filter(c=>record(c.code).status==='completed'&&!record(c.code).grade);return head('ACADEMIC RESULTS','Grades & assessment tracker','Record official outcomes and your individual assessment scores.')+`<div class="stats"><div class="card stat"><div class="label">Personal estimated GPA</div><div class="metric" style="font-size:23px">${esc(gpa())}</div><span class="tiny">Non-GPA pass/fail courses excluded</span></div><div class="card stat"><div class="label">Completed courses</div><div class="metric">${Object.values(catalogue()).filter(earned).length}</div></div><div class="card stat"><div class="label">Awaiting grades</div><div class="metric">${pending.length}</div></div><div class="card stat"><div class="label">Preloaded assessment matrices</div><div class="metric">${Object.values(catalogue()).filter(c=>c.assessment?.length).length}</div></div></div><section class="card"><div class="card-title"><h2>Courses and assessments</h2><span class="pill info">Click a course to enter marks</span></div><div class="list">${courses.map(c=>`<div class="course"><div class="course-info"><div class="course-code">${esc(c.code)}</div><div class="course-name">${esc(c.name)}</div><div class="meta">${esc(record(c.code).status)} · ${c.assessment?.length||0} assessment items · ${fmt(c.cu)} CU</div></div><div class="course-actions"><span class="pill ${earned(c)?'ok':''}">${esc(record(c.code).grade||'Grade pending')}</span><button class="btn small outline" data-course="${esc(c.code)}">Open assessment →</button></div></div>`).join('')||'<div class="empty">Add course results in the Course Catalogue first.</div>'}</div></section><p class="footer">The displayed GPA uses standard five-point grade mappings as an estimate. Always use the official SUSS grade transcript for definitive GPA and CU recognition.</p>`}
function settings(){let term=state.focus;return head('PREFERENCES & DATA','Settings and PDF imports','All planning data stays on your Mac. You control imports, edits and backups.')+`<div class="two"><section class="cards"><div class="card"><div class="card-title"><h2>Semester schedule imports</h2><span class="pill info">Offline processing</span></div><p class="subhead">Import a new Full Interim Course Schedule PDF, a curriculum plan, individual assessment PDFs, or an extracted text/JSON file.</p><div class="toolbar" style="margin:17px 0"><button class="btn" id="importPdf">↑ Import PDF / TXT / JSON</button></div><div class="note">PDF extraction uses the included local Mac launcher and built-in macOS PDFKit (or a locally installed PDF utility). Preview and confirm the results before replacing a timetable. Nothing is uploaded to the internet.</div>${stagedImport?stagePreview():''}<p class="footer">Preloaded: ${SEED.sessions.toLocaleString()} sessions from the supplied SUSS timetable, plus ${Object.keys(SEED.schedule['Jan 2027']||{}).length} Jan 2027 course codes and 16 course matrices.</p>${imports.importLog.map(l=>`<div class="switchline"><span>${esc(l.name)}<small class="muted"> · ${esc(l.when)}</small></span><span class="pill">${esc(l.kind)}</span></div>`).join('')}</div><div class="card"><h2 style="margin-bottom:12px">Save / restore all your data</h2><div class="toolbar"><button class="btn" data-action="export">↓ Export JSON backup</button><button class="btn light" id="restoreButton">↑ Restore JSON backup</button></div><p class="footer">The backup contains your grades, priorities, planned courses, restrictions, imports and saved CRNs. Keep copies in a safe place. Clearing browser data may erase locally saved information.</p></div></section><section class="cards"><div class="card"><div class="card-title"><h2>Availability & personal commitments</h2><span class="pill">${esc(niceTerm(term))}</span></div><div class="stack"><div class="fieldrow"><label class="fieldlabel">Restriction type<select id="blockKind"><option value="hard">Hard block — exclude</option><option value="soft">Flexible — warning</option></select></label><label class="fieldlabel">Repeat<select id="blockRepeat"><option value="weekly">Weekly day</option><option value="date">Specific date</option></select></label><label class="fieldlabel" id="blockDayLabel">Day<select id="blockDay">${DAYS.map(d=>`<option>${d}</option>`).join('')}</select></label><label class="fieldlabel" id="blockDateLabel" style="display:none">Date<input type="date" id="blockDate" value="2027-01-13"></label></div><div class="fieldrow"><label class="fieldlabel">Start<input type="time" id="blockStart" value="09:00"></label><label class="fieldlabel">End<input type="time" id="blockEnd" value="18:00"></label><label class="fieldlabel">Reason<input class="field" id="blockReason" placeholder="Work / personal" value="Work"></label></div><button class="btn soft" id="addBlock">+ Add availability restriction</button></div><div style="margin-top:15px">${blocks(term).length?blocks(term).map((b,i)=>`<div class="switchline"><span><span class="pill ${b.kind==='hard'?'danger':'warn'}">${b.kind==='hard'?'Hard':'Flexible'}</span> ${esc(b.date||b.day)}, ${clock(b.start)}–${clock(b.end)} <small class="muted">${esc(b.reason||'')}</small></span><button class="btn small outline" data-removeblock="${i}">Remove</button></div>`).join(''):'<div class="empty">No restrictions set yet.</div>'}</div></div><div class="card"><div class="card-title"><h2>Planning preferences</h2></div><label class="check"><input type="checkbox" id="allowTG" ${state.allowTG?'checked':''}> Show daytime TG groups (for eligible full-time students)</label><p class="footer">The planner uses CRN evening groups by default. Restricted CRNs are excluded from automatic combinations.</p></div></section></div>`}
function stagePreview(){let s=stagedImport;return `<div class="note" style="margin:15px 0"><strong>Import preview:</strong> ${esc(s.kind||'Unknown')} · ${esc(s.name||'File')} · ${s.sessions||0} sessions · ${s.courseCount||0} course codes. ${s.warning?'<br>'+esc(s.warning):''}<div class="toolbar" style="margin:12px 0 0"><button class="btn small" id="confirmImport" ${!s.courseCount&&!s.metadataCount?'disabled':''}>Confirm import</button><button class="btn small outline" id="cancelImport">Cancel</button></div></div>`}
function modal(content){$('modalInner').innerHTML=content;$('modalBack').classList.remove('hidden')}
function closeModal(){$('modalBack').classList.add('hidden');activeCourse=null}
function courseModal(code){activeCourse=code;let c=course(code),r=record(code),a=c.assessment||[],score=state.scores[code]||{},weighted=a.reduce((s,x)=>s+((Number.isFinite(Number(score[x.name]))&&score[x.name]!==''&&score[x.name]!=null)?x.w*Number(score[x.name])/100:0),0);return modal(`<div class="eyebrow">COURSE PROFILE</div><h2>${esc(code)} — ${esc(c.name)}</h2><p class="subhead" style="margin-bottom:14px">${esc(REQ[c.cat]?.name||'Unclassified')} · ${fmt(c.cu)} CU · ${esc(c.pattern||'Presentation not verified')}</p><div class="tabs"><span class="pill info">Course details</span>${a.length?'<span class="pill">'+a.length+' assessment components</span>':''}</div><div class="stack"><div class="split"><label class="fieldlabel">Degree requirement<select id="editCat">${[['unassigned','Not assigned'],...REQUIREMENTS.map(x=>[x[0],x[1]])].map(([id,n])=>`<option value="${id}" ${id===c.cat?'selected':''}>${esc(n)}</option>`).join('')}</select></label><label class="fieldlabel">Credit units<input id="editCu" type="number" step="2.5" min="0" value="${c.cu||0}"></label></div><div class="split"><label class="fieldlabel">Academic status<select id="editStatus">${[['todo','Not started'],['planned','Planned'],['inprogress','In progress'],['completed','Completed']].map(([v,n])=>`<option value="${v}" ${r.status===v?'selected':''}>${n}</option>`).join('')}</select></label><label class="fieldlabel">Official grade<select id="editGrade"><option value="">Not entered</option>${[...Object.keys(GRADE_POINTS),'P','F','CR','EX'].map(x=>`<option ${r.grade===x?'selected':''}>${x}</option>`).join('')}</select></label></div><div class="split"><label class="fieldlabel">Semester completed / studying<select id="editTerm"><option value="">Not recorded</option>${TERMS.map(t=>`<option value="${t}" ${r.term===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label><label class="fieldlabel">Prerequisite (reference)<input class="field" id="editPre" value="${esc(c.prereq||'')}"></label></div><button class="btn" id="saveCourse">Save course information</button>${c.synopsis?`<div class="note"><strong>Synopsis</strong><p style="margin-top:5px">${esc(c.synopsis)}</p></div>`:''}${a.length?`<div><h3 style="margin-bottom:9px">Assessment matrix</h3><div class="note">The original published weightages can change. Enter provisional scores out of 100; your weighted result below is not the official course grade.</div>${a.map(x=>`<div class="assessment-row"><span>${esc(x.name)}</span><strong>${fmt(x.w)}%</strong><input type="number" step="0.1" min="0" max="100" data-score="${esc(x.name)}" value="${score[x.name]===undefined?'':esc(score[x.name])}" placeholder="Score %"><strong>${score[x.name]!==undefined?((Number(score[x.name])*x.w)/100).toFixed(1)+'%':'—'}</strong></div>`).join('')}<div class="between" style="margin-top:12px"><span>Weighted marks earned so far</span><strong>${weighted.toFixed(1)} / 100</strong></div><button class="btn small soft" id="saveScores" style="margin-top:13px">Save assessment scores</button></div>`:'<div class="note">Assessment matrix not imported for this course yet. You can add its course information PDF from Settings.</div>'}${c.source?`<small class="muted">Source: ${esc(c.source)}. Subject to updates.</small>`:''}</div>`)}
function simpleAddCourse(){modal(`<div class="eyebrow">COURSE CATALOGUE</div><h2>Add a course manually</h2><div class="stack"><label class="fieldlabel">Course code<input id="newCode" class="field" placeholder="e.g. BME400"></label><label class="fieldlabel">Course title<input id="newTitle" class="field" placeholder="Course title"></label><div class="split"><label class="fieldlabel">Requirement<select id="newCat">${REQUIREMENTS.map(x=>`<option value="${x[0]}">${esc(x[1])}</option>`).join('')}</select></label><label class="fieldlabel">Credit units<input id="newCU" type="number" value="5" min="0" step="2.5"></label></div><button class="btn" id="saveNewCourse">Add course</button></div>`)}
function invalidatePlan(term){delete state.plans[term];save()}
function updateChoice(code,key,value){if(!canRegister(course(code))){toast(`${code} is already in progress or completed and cannot be shortlisted for another registration.`);render();return}let term=state.focus;state.choices[term]??={};let item=state.choices[term][code]||{priority:'none',group:''};item[key]=value;state.choices[term][code]=item;invalidatePlan(term);render()}
function doExport(){const payload={format:'SUSS_PLANNER_V2',version:2,exported:new Date().toISOString(),state,imports};const file=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});let u=URL.createObjectURL(file);let a=document.createElement('a');a.href=u;a.download='SUSS_Degree_Planner_Backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);toast('Backup file created. Keep a copy outside your browser.')}
async function startImport(file){if(!file)return;toast(`Reading ${file.name} locally…`);try{let result;if(file.name.toLowerCase().endsWith('.json')){let raw=JSON.parse(await file.text());if(raw.format==='SUSS_PLANNER_V2'){if(!confirm('This is a full app backup, not a course schedule. Restore it and replace your current data?'))return;state=raw.state;imports=raw.imports||{schedule:{},metadata:{},importLog:[]};purgeStalePlans();save();render();toast('Backup restored; outdated registration plans were discarded.');return}if(raw.schedule||raw.metadata){result={kind:'JSON schedule',name:file.name,term:Object.keys(raw.schedule||{})[0]||'',schedule:raw.schedule||{},metadata:raw.metadata||{},sessions:Object.values(raw.schedule||{}).flatMap(x=>Object.values(x).flatMap(g=>Object.values(g).flat())).length,courseCount:Object.values(raw.schedule||{}).reduce((s,x)=>s+Object.keys(x).length,0),metadataCount:Object.keys(raw.metadata||{}).length}}else throw new Error('JSON format not recognised');}else{
  if(location.protocol!=='http:'&&location.protocol!=='https:')throw new Error('PDF import needs the Mac launcher. Open “Start SUSS Planner.command” first, then use the Import button.');
  let buf=await file.arrayBuffer();let res=await fetch('/api/import?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});let json=await res.json();if(!res.ok)throw new Error(json.error||'Importer failed');result=json;
 }stagedImport=result;view='settings';render();toast('Import preview ready — review the counts and confirm.');}catch(e){toast('Import not completed: '+e.message)}}
async function restoreFile(file){if(!file)return;try{let raw=JSON.parse(await file.text());if(raw.format!=='SUSS_PLANNER_V2'||!raw.state||!raw.imports)throw new Error('Not a SUSS Planner v2 backup');if(!confirm('Replace all current local planner data with this backup?'))return;state=raw.state;imports=raw.imports;purgeStalePlans();save();render();toast('Complete backup restored; outdated plans were discarded.')}catch(e){toast('Restore failed: '+e.message)}}
function purgeStalePlans(){let changed=false;for(const [term,p] of Object.entries(state.plans||{})){
 const versions=[...Object.values(p.generated||{}),p.approved].filter(Boolean);
 if(versions.some(v=>(v.courses||[]).some(row=>!canRegister(course(row.code))))){delete state.plans[term];changed=true}
 }if(changed)save();return changed}
function acceptImport(){const s=stagedImport;if(!s)return;for(let [term,sc] of Object.entries(s.schedule||{})){if(!Object.keys(sc||{}).length)continue;imports.schedule[term]=sc;delete state.plans[term]}
 for(let [code,info] of Object.entries(s.metadata||{})){let original=course(code);let merged={...original,...info,code}; if(original.cat&&original.cat!=='unassigned'&&(!info.cat||info.cat==='unassigned'))merged.cat=original.cat;if(original.cu&&!info.cu)merged.cu=original.cu;imports.metadata[code]=merged;}
 imports.importLog.unshift({name:s.name||'Unknown file',kind:s.kind||'PDF import',when:new Date().toLocaleString('en-SG')});imports.importLog=imports.importLog.slice(0,12);stagedImport=null;invalidatePlan(state.focus);save();render();toast('Import saved locally. Review new CRNs and your generated plans.');}
function copyPlan(k){let p=state.plans[state.focus]?.generated?.[k];if(!p)return;let text=`SUSS ${state.focus} Plan ${k} (${fmt(p.cu)} CU)\n`+p.courses.map(c=>`${c.code} | ${c.group} | ${fmt(c.cu)} CU | ${course(c.code).name}`).join('\n')+'\n\nPersonal plan only. Confirm all course restrictions and seats at SUSS eCR.';if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>toast('CRN checklist copied.'),()=>{window.prompt('Copy this plan:',text)});else window.prompt('Copy this plan:',text)}
function minInput(v){return Number(v.slice(0,2))*60+Number(v.slice(3,5))}
function exportPlanApproval(k){let p=state.plans[state.focus]?.generated?.[k];if(!p||!p.courses.length)return;state.plans[state.focus].approved=snapshotPlan(p);save();render();toast(`Plan ${k} saved as your current approved registration plan.`)}

$('backupQuick').onclick=doExport;
$('menuButton').onclick=()=>{$('sidebar').classList.toggle('open')};
$('closeModal').onclick=closeModal;
$('modalBack').onclick=e=>{if(e.target===$('modalBack'))closeModal()};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
$('pdfInput').addEventListener('change',async e=>{await startImport(e.target.files?.[0]);e.target.value=''});
$('restoreInput').addEventListener('change',async e=>{await restoreFile(e.target.files?.[0]);e.target.value=''});

document.addEventListener('click',async e=>{
 let authBtn = e.target.closest('#authBtn');
 if(authBtn){
   if(currentUser){
     if(supabaseClient){
       await supabaseClient.auth.signOut();
       toast('Signed out successfully.');
       render();
     }
   } else {
     let email = prompt('Enter your email to sign in / sign up:');
     if(!email) return;
     if(supabaseClient){
       let { error } = await supabaseClient.auth.signInWithOtp({ email });
       if(error) toast('Error: ' + error.message);
       else toast('Check your email for the magic link login!');
     }
   }
   return;
 }

 let b=e.target.closest('[data-view]');if(b){view=b.dataset.view;if(b.dataset.tab)tab=b.dataset.tab;render();$('sidebar').classList.remove('open');return}
 b=e.target.closest('[data-tab]');if(b){tab=b.dataset.tab;render();return}
 b=e.target.closest('[data-plan]');if(b){selectedPlan=b.dataset.plan;render();return}
 b=e.target.closest('[data-course-scope]');if(b){courseScope=b.dataset.courseScope;render();return}
 b=e.target.closest('[data-course]');if(b){courseModal(b.dataset.course);return}
 b=e.target.closest('[data-approve]');if(b){exportPlanApproval(b.dataset.approve);return}
 b=e.target.closest('[data-copyplan]');if(b){copyPlan(b.dataset.copyplan);return}
 b=e.target.closest('[data-removeblock]');if(b){let i=Number(b.dataset.removeblock);blocks(state.focus).splice(i,1);invalidatePlan(state.focus);render();return}
 b=e.target.closest('[data-removefuture]');if(b){let [term,code]=b.dataset.removefuture.split('|');delete state.future[term][code];save();render();return}
 if(e.target.id==='generate'){if(!picked(state.focus).length){toast('Set at least one course to Must Take, Preferred or Backup first.');return}state.plans[state.focus]={generated:generatePlans(state.focus),updated:new Date().toISOString()};save();tab='plans';selectedPlan='A';render();toast('Plans generated using actual session dates.');return}
 if(e.target.id==='saveCourse'){
  const code=activeCourse;if(!code)return;let previous=course(code);let cu=Number($('editCu').value);if(!Number.isFinite(cu)||cu<0||cu>40)return toast('Enter a valid CU value.');
  const nextCourse={...previous,cat:$('editCat').value,cu,prereq:$('editPre').value};
  const nextRecord={status:$('editStatus').value,grade:$('editGrade').value,term:$('editTerm').value};
  const was=record(code);
  const changed=JSON.stringify(was)!==JSON.stringify(nextRecord)||nextCourse.cat!==previous.cat||nextCourse.cu!==previous.cu||nextCourse.prereq!==previous.prereq;
  state.manualCourses[code]=nextCourse;state.records[code]=nextRecord;
  if(changed)state.plans={}; 
  save();closeModal();render();toast(`${code} saved.${changed?' Registration plans must be regenerated.':''}`);return}
 if(e.target.id==='saveScores'){const code=activeCourse;if(!code)return;state.scores[code]??={};$('modalInner').querySelectorAll('[data-score]').forEach(el=>{if(el.value==='')delete state.scores[code][el.dataset.score];else{let n=Number(el.value);if(n>=0&&n<=100)state.scores[code][el.dataset.score]=n}});save();courseModal(code);toast('Assessment scores saved.');return}
 if(e.target.id==='addCourse'){simpleAddCourse();return}
 if(e.target.id==='saveNewCourse'){let code=$('newCode').value.trim().toUpperCase(),name=$('newTitle').value.trim(),cu=Number($('newCU').value);if(!/^[A-Z]{2,7}\d{3}[A-Z]{0,4}$/.test(code)||!name||!(cu>0))return toast('Enter a valid code, title and positive CU amount.');if(course(code).name!==code&&baseCatalogue[code])return toast('This code exists. Open its record to edit it.');state.manualCourses[code]={code,name,cat:$('newCat').value,cu,prereq:'',offerings:[]};save();closeModal();render();toast(code+' added.');return}
 if(e.target.id==='importPdf'){$('pdfInput').click();return}
 if(e.target.id==='restoreButton'){$('restoreInput').click();return}
 if(e.target.id==='confirmImport'){acceptImport();return}
 if(e.target.id==='cancelImport'){stagedImport=null;render();return}
 if(e.target.dataset.action==='export'){doExport();return}
 if(e.target.id==='postpone'){let code=$('postponeCourse').value,term=$('postponeTerm').value;if(!likelyOffered(course(code),term)){if(!confirm(`${code} is not shown as an expected presentation in ${term}. Save this tentative move anyway?`))return;}state.future[term]??={};state.future[term][code]=true;save();render();toast('Future course placement saved as tentative.');return}
 if(e.target.id==='addBlock'){let time1=$('blockStart').value,time2=$('blockEnd').value;if(!time1||!time2||minInput(time1)>=minInput(time2))return toast('End time must be later than start time.');let isdate=$('blockRepeat').value==='date',date=$('blockDate').value;if(isdate&&!date)return toast('Choose a specific date.');state.blocks[state.focus]??=[];state.blocks[state.focus].push({kind:$('blockKind').value,date:isdate?date:'',day:isdate?'':$('blockDay').value,start:minInput(time1),end:minInput(time2),reason:$('blockReason').value});invalidatePlan(state.focus);render();toast('Personal timetable restriction added.');return}
});

document.addEventListener('change',e=>{
 let el=e.target;
 if(el.dataset.choice){updateChoice(el.dataset.choice,'priority',el.value);return}
 if(el.dataset.group){updateChoice(el.dataset.group,'group',el.value);return}
 if(el.id==='focusTerm'){state.focus=el.value;tab='courses';save();render();return}
 if(el.id==='targetCu'){let n=Number(el.value);if(n>0&&n<=40){state.targets[state.focus]=n;invalidatePlan(state.focus);render()}return}
 if(el.id==='catFilter'){catFilter=el.value;render();return}
 if(el.id==='statusFilter'){statusFilter=el.value;render();return}
 if(el.id==='allowTG'){state.allowTG=el.checked;invalidatePlan(state.focus);render();return}
 if(el.id==='blockRepeat'){$('blockDateLabel').style.display=el.value==='date'?'grid':'none';$('blockDayLabel').style.display=el.value==='date'?'none':'grid';return}
});

document.addEventListener('input',e=>{
 if(e.target.id==='catalogueSearch'){catalogueQuery=e.target.value;const start=e.target.selectionStart;render();let el=$('catalogueSearch');el.focus();el.setSelectionRange(start,start);return}
 if(e.target.id==='semesterSearch'){
  let q=e.target.value.toLowerCase().trim();
  const hits={confirmed:0,unscheduled:0};
  for(const [id,scope] of [['confirmedCourses','confirmed'],['unscheduledCourses','unscheduled']]){
   let el=$(id);if(!el)continue;
   el.querySelectorAll('.course').forEach(row=>{let matched=!q||row.textContent.toLowerCase().includes(q);row.style.display=matched?'flex':'none';if(matched)hits[scope]++});
   el.style.display=q?(hits[scope]?'':'none'):(scope===courseScope?'':'none');
  }
  const activeSearchScope=q?(hits.unscheduled&&!hits.confirmed?'unscheduled':hits.confirmed&&!hits.unscheduled?'confirmed':null):courseScope;
  document.querySelectorAll('[data-course-scope]').forEach(t=>t.classList.toggle('active',t.dataset.courseScope===activeSearchScope));
  return}
});

purgeStalePlans();
initCloudSync().then(() => {
  render();
});
