'use strict';
const el = id => document.getElementById(id);
const viewport = el('viewport'), plane = el('plane'), img = el('plan-img');
const fieldLabels = {name:'阀门名称',type:'类型',model:'型号',maker:'生产厂家',pressure:'公称压力',diameter:'公称通径',date:'制造日期',notes:'备注'};
const placeholders = {name:'例如：低加正常疏水旁路阀',pressure:'例如：1.6 MPa',diameter:'例如：DN50',date:'例如：2022 年 12 月'};
let planId='', records=[], selected=null, placing=null, draft=null, version=0, uploadId='', removeTarget=null;
let base=1, zoom=1, tx=0, ty=0, ready=false, toastTimer;
const phone=matchMedia('(max-width:800px), (max-width:1000px) and (max-height:520px) and (pointer:coarse)');
let viewWidth=0, viewHeight=0;
function mobileView(view) {
  document.body.dataset.mobileView=view;
  el('mobile-map').setAttribute('aria-pressed',String(view==='map'));
  el('mobile-records').setAttribute('aria-pressed',String(view==='records'));
}
el('mobile-map').onclick=()=>mobileView('map');
el('mobile-records').onclick=()=>{show(null);mobileView('records');};
const make=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
const button=(label,cls,fn)=>{const b=make('button',cls,label);b.type='button';b.onclick=fn;return b;};
const code=n=>String(n).padStart(2,'0');
function uuid() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;
  const s=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');
}
function toast(message){el('toast').textContent=message;el('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el('toast').hidden=true,3700);}
function status(ok){el('connection').textContent=ok?'服务器已连接':'连接中断';el('connection').classList.toggle('ok',ok);}
async function api(url,method='GET',body) {
  const options={method,headers:{'X-Atlas-Request':'1'}};
  if(body instanceof Blob)options.body=body;
  else if(body!==undefined){options.body=JSON.stringify(body);options.headers['Content-Type']='application/json';}
  let response;
  try{response=await fetch(url,options);}catch{status(false);throw Error('连接失败，请检查网络后重试。');}
  status(true);
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'请求失败');
  return result;
}
function endpoint(){return '/api/plans/'+encodeURIComponent(planId)+'/valves';}
function syncView() {
  const s=base*zoom;
  plane.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';
  plane.style.setProperty('--inv',1/s);
  el('zoom').value=Math.round(zoom*100)+'%';
}
function resizeMap(mode='preserve'){
  const w=viewport.clientWidth,h=viewport.clientHeight;
  if(!ready||!img.naturalWidth||w<20||h<20)return;
  if(mode==='preserve'&&w===viewWidth&&h===viewHeight)return;
  const scale=base*zoom;
  const sameArea=mode==='preserve'&&viewWidth>0;
  const cx=sameArea?(viewWidth/2-tx)/scale:img.naturalWidth/2;
  const cy=sameArea?(viewHeight/2-ty)/scale:img.naturalHeight/2;
  viewWidth=w;viewHeight=h;
  base=Math.min((w-16)/img.naturalWidth,(h-16)/img.naturalHeight);
  if(mode==='initial'&&phone.matches&&planId.startsWith('cad-')){
    zoom=Math.min(3,Math.max(w/img.naturalWidth,h/img.naturalHeight)/base);
  }else if(!sameArea){zoom=1;}
  tx=w/2-cx*base*zoom;ty=h/2-cy*base*zoom;syncView();
}
function magnify(next,x,y){
  if(!ready)return;
  next=Math.max(.4,Math.min(16,next));
  const r=next/zoom;tx=x-(x-tx)*r;ty=y-(y-ty)*r;zoom=next;syncView();
}
function chooseZoom(r){magnify(zoom*r,viewport.clientWidth/2,viewport.clientHeight/2);}
el('fit').onclick=()=>resizeMap('fit');el('in').onclick=()=>chooseZoom(1.35);el('out').onclick=()=>chooseZoom(1/1.35);
new ResizeObserver(()=>resizeMap()).observe(viewport);
function setPlacing(mode){
  placing=mode;
  if(mode)mobileView('map');
  el('add').classList.toggle('active',!!mode);
  el('add').querySelector('span').textContent=mode?'取消标记':'添加点位';
  viewport.classList.toggle('placing',!!mode);
  el('map-alert').hidden=!mode;
  el('map-alert').textContent=mode?.id?'点击图纸，选择新位置':'点击图纸，放置阀门点位';
}
el('add').onclick=()=>setPlacing(placing?null:{});
function renderPins(){
  plane.querySelectorAll('.pin').forEach(n=>n.remove());
  records.filter(v=>v.x!==null).forEach(v=>{
    const b=button(code(v.seq),'pin'+(v.id===selected?' selected':''),e=>{if(!placing){e.stopPropagation();show(v.id,true);}});
    b.style.left=v.x*100+'%';b.style.top=v.y*100+'%';b.title=v.fields.name;b.setAttribute('aria-label',code(v.seq)+' '+v.fields.name);
    plane.append(b);
  });
}
function show(id,fromMap=false) {
  selected=id;setPlacing(null);
  const v=records.find(x=>x.id===id);
  el('detail').hidden=!v;el('inventory').hidden=!!v;
  if(v){
    const d=el('detail');d.replaceChildren();
    d.append(button('‹  返回清单','back',()=>show(null)));
    const heading=make('div','detail-title');heading.append(make('span','number','V-'+code(v.seq)),make('span','subtle','阀门资料'));
    d.append(heading,make('h2','',v.fields.name));
    if(v.x===null)d.append(make('p','pending-info','待定位 · 请在图纸上确认实际位置。'));
    const dl=make('dl');
    for(const [key,label] of Object.entries(fieldLabels)){
      if(key==='name')continue;
      const row=make('div');row.append(make('dt','',label),make('dd','',v.fields[key]||'—'));dl.append(row);
    }
    const actions=make('div','detail-actions');
    if(v.x!==null)actions.append(button('查看位置','phone-label primary',()=>{
      mobileView('map');centerValve(v);
    }));
    actions.append(button('编辑资料','',()=>openEdit(v)),button(v.x===null?'在图上定位':'移动点位',v.x===null?'primary':'',()=>{setPlacing(v);if(!phone.matches)viewport.scrollIntoView({block:'nearest'});}),button('移除','remove',()=>{
      removeTarget=v;el('delete-text').textContent='从图纸移除「'+v.fields.name+'」？';openDialog('delete-dialog');
    }));
    d.append(dl,actions);
    if(!fromMap)centerValve(v);
    if(phone.matches){mobileView('records');d.scrollTop=0;}
  }
  renderPins();
}
function centerValve(v){
  if(!ready||v.x===null)return;
  tx=viewport.clientWidth/2-v.x*img.naturalWidth*base*zoom;
  ty=viewport.clientHeight/2-v.y*img.naturalHeight*base*zoom;
  syncView();
}
function renderList(){
  const q=el('filter').value.trim().toLowerCase();
  const found=records.filter(v=>[v.fields.name,v.fields.model,'V-'+code(v.seq)].join(' ').toLowerCase().includes(q));
  const list=el('list');list.replaceChildren();el('count').textContent=records.length;
  el('mobile-count').textContent=records.length;
  for(const v of found){
    const row=button('','row',()=>show(v.id)),desc=make('span','desc');
    desc.append(make('strong','',v.fields.name),make('small','',[v.x===null?'待定位':'',v.fields.type,v.fields.diameter].filter(Boolean).join('  ·  ')||'查看资料'));
    row.append(make('span','number',code(v.seq)),desc,make('span','chev','›'));list.append(row);
  }
  if(!found.length)list.append(make('p','empty',q?'没有匹配的阀门。':'这张图纸还没有点位。点击「添加点位」开始标记。'));
}
el('filter').oninput=renderList;
async function loadPlan(id){
  const ticket=++version;
  planId=id;ready=false;setPlacing(null);el('add').disabled=true;
  records=[];el('filter').value='';renderList();show(null);plane.hidden=true;
  el('sample-tag').hidden=!id.startsWith('cad-');
  el('field-note').hidden=id!=='cad-0301-02';
  el('sheet-ref').textContent=id.startsWith('cad-')?'Z750SR-8B-'+id.slice(4):'';
  const url=new URL(location.href);url.searchParams.set('plan',id);history.replaceState(null,'',url);
  img.src='/api/plans/'+encodeURIComponent(id)+'/image';
  try{
    const [rows]=await Promise.all([api(endpoint()),img.decode()]);
    if(ticket!==version)return;
    records=rows;plane.style.width=img.naturalWidth+'px';plane.style.height=img.naturalHeight+'px';
    ready=true;el('add').disabled=false;plane.hidden=false;resizeMap('initial');renderPins();renderList();
  }catch(e){if(ticket===version){el('map-alert').hidden=false;el('map-alert').textContent='图纸加载失败，刷新页面后重试';throw e;}}
}
async function loadPlans(preferred){
  const plans=await api('/api/plans');
  const sel=el('plans');sel.replaceChildren();
  for(const p of plans)sel.add(new Option(p.name,p.id));
  sel.value=plans.some(p=>p.id===preferred)?preferred:plans[0].id;
  await loadPlan(sel.value);
}
el('plans').onchange=()=>loadPlan(el('plans').value).catch(e=>toast(e.message));
function localPoint(e){const r=viewport.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
const pointers=new Map();let tap=null;
function pair(){
  const [a,b]=[...pointers.values()];
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};
}
viewport.addEventListener('pointerdown',e=>{
  if(!ready||e.button!==0||(!placing&&e.target.closest('.pin')))return;
  e.preventDefault();viewport.setPointerCapture(e.pointerId);
  const p=localPoint(e);pointers.set(e.pointerId,p);tap=pointers.size===1?p:null;viewport.classList.add('drag');
});
viewport.addEventListener('pointermove',e=>{
  const prev=pointers.get(e.pointerId);if(!prev)return;
  const old=pointers.size===2?pair():null,p=localPoint(e);pointers.set(e.pointerId,p);
  if(tap&&Math.hypot(p.x-tap.x,p.y-tap.y)>5)tap=null;
  if(old){const now=pair();tx+=now.x-old.x;ty+=now.y-old.y;magnify(zoom*now.d/Math.max(1,old.d),now.x,now.y);}
  else if(!tap&&pointers.size===1){tx+=p.x-prev.x;ty+=p.y-prev.y;syncView();}
});
function endPointer(e){
  if(!pointers.has(e.pointerId))return;
  if(tap&&placing&&e.type==='pointerup'){
    const p=localPoint(e),x=(p.x-tx)/(base*zoom*img.naturalWidth),y=(p.y-ty)/(base*zoom*img.naturalHeight);
    if(x>=0&&x<=1&&y>=0&&y<=1){const v=placing.id?placing:null;setPlacing(null);openEdit(v,x,y);}
    else toast('请点击图纸范围内的位置');
  }
  pointers.delete(e.pointerId);tap=null;
  if(!pointers.size)viewport.classList.remove('drag');
}
viewport.onpointerup=endPointer;viewport.onpointercancel=endPointer;
viewport.addEventListener('wheel',e=>{e.preventDefault();const p=localPoint(e);magnify(zoom*Math.exp(-Math.max(-300,Math.min(300,e.deltaY))*.002),p.x,p.y);},{passive:false});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&placing)setPlacing(null);});
function openDialog(id){const d=el(id);d.querySelector('.error').textContent='';d.showModal();}
document.querySelectorAll('dialog').forEach(d=>{
  d.querySelectorAll('.close,.cancel').forEach(b=>b.onclick=()=>d.close());
  d.oncancel=e=>{if(d.querySelector('[type=submit]').disabled)e.preventDefault();};
});
function openEdit(v,x=v?.x,y=v?.y){
  draft={id:v?.id||uuid(),rev:v?.rev,x,y};
  el('edit-title').textContent=v?'编辑阀门点位':'新增阀门点位';
  for(const key of Object.keys(fieldLabels))el('f-'+key).value=v?.fields[key]||'';
  openDialog('edit-dialog');
}
for(const [key,label] of Object.entries(fieldLabels)){
  const wrap=make('label','field'+(['name','notes'].includes(key)?' wide':''),label+(key==='name'?' *':''));
  const input=make(key==='notes'?'textarea':'input');input.id='f-'+key;
  input.maxLength=key==='notes'?2500:150;input.required=key==='name';input.placeholder=placeholders[key]||'';
  wrap.append(input);el('fields').append(wrap);
}
el('upload').onclick=()=>{el('upload-form').reset();el('filename').textContent='选择图纸图片';uploadId=uuid();openDialog('upload-dialog');};
el('file').onchange=()=>{const f=el('file').files[0];if(f){el('filename').textContent=f.name;if(!el('plan-name').value)el('plan-name').value=f.name.replace(/\.[^.]+$/,'').slice(0,100);}};
function onSubmit(formId,task) {
  const f=el(formId);
  f.onsubmit=async e=>{
    e.preventDefault();const buttons=[...f.querySelectorAll('button')];if(buttons.at(-1).disabled)return;
    buttons.forEach(b=>b.disabled=true);f.querySelector('.error').textContent='';
    try{await task();}catch(error){f.querySelector('.error').textContent=error.message;if(!f.closest('dialog').open)toast(error.message);}
    finally{buttons.forEach(b=>b.disabled=false);}
  };
}
onSubmit('upload-form',async()=>{
  const f=el('file').files[0],name=el('plan-name').value.trim();
  if(!name)throw Error('请填写图纸名称');
  if(f.size>16*1024*1024)throw Error('图纸超过 16 MB');
  const preview=new Image();preview.src=URL.createObjectURL(f);
  try{await preview.decode();}catch{throw Error('图片无法读取，请另选一张图纸');}finally{URL.revokeObjectURL(preview.src);}
  const result=await api('/api/plans?'+new URLSearchParams({name,id:uploadId}),'POST',f);
  el('upload-dialog').close();mobileView('map');await loadPlans(result.id);toast('图纸已保存');
});
async function refreshList(focus) {
  const ticket=version,rows=await api(endpoint());
  if(ticket!==version)return;
  records=rows;renderList();show(focus,true);
}
onSubmit('edit-form',async()=>{
  const fields={};for(const key of Object.keys(fieldLabels))fields[key]=el('f-'+key).value.trim();
  const result=await api(endpoint()+(draft.rev?'/'+draft.id:''),draft.rev?'PUT':'POST',{...draft,fields});
  el('edit-dialog').close();await refreshList(result.id);toast('阀门点位已保存');
});
onSubmit('delete-form',async()=>{
  await api(endpoint()+'/'+removeTarget.id,'DELETE',{rev:removeTarget.rev});
  el('delete-dialog').close();await refreshList(null);toast('点位已移除');
});

// Small line icons share the same stroke weight at every display density.
const shapes={upload:['M12 16V3 M7 8l5-5 5 5 M4 15v5h16v-5'],layers:['M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5'],pin:['M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z','M14 10a2 2 0 1 1-4 0 2 2 0 1 1 4 0z'],plus:['M12 5v14 M5 12h14'],minus:['M5 12h14'],fit:['M9 4H4v5 M15 4h5v5 M4 15v5h5 M20 15v5h-5'],search:['M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0z M15.5 15.5l5 5'],mouse:['M6 9a6 6 0 0 1 12 0v6a6 6 0 0 1-12 0z M12 6v4']};
shapes.records=['M8 5h12 M8 12h12 M8 19h12 M3 5h1 M3 12h1 M3 19h1'];
for(const icon of document.querySelectorAll('[data-i]')){
  const c=make('canvas');c.width=c.height=48;c.setAttribute('aria-hidden','true');
  const ctx=c.getContext('2d');ctx.scale(2,2);ctx.strokeStyle=getComputedStyle(icon).color;ctx.lineWidth=1.6;ctx.lineJoin='round';ctx.lineCap='round';
  shapes[icon.dataset.i].forEach(p=>ctx.stroke(new Path2D(p)));icon.append(c);
}
loadPlans(new URLSearchParams(location.search).get('plan')).catch(e=>toast(e.message));
