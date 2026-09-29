const STORAGE_KEY = 'site-workbench-demo-v1';
const today = new Date();

function localDateKey(date) { return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'); }
function dateOffset(days) { const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days); return localDateKey(date); }

const initialState = {
  sites: [
    {id:'pixvael',name:'Pixvael · 图片工具',phase:'增长变现',strategy:'推进',goal:'验证“批量处理”是否带来付费意愿',decision:'保留免费入口，先观察三次自然流量回访',nextAction:'整理 3 个用户回访问题，更新定价页',checkpoint:dateOffset(2),assets:'本地手动链接',condition:'',updatedAt:dateOffset(-1)},
    {id:'morse',name:'Morse Code 分析',phase:'需求验证',strategy:'观察',goal:'等待第二轮搜索数据稳定',decision:'暂不扩展语言范围，先看核心词点击',nextAction:'复盘 GSC 点击率，决定是否做 FAQ',checkpoint:dateOffset(5),assets:'本地手动链接',condition:`等待第二轮 GSC 数据；${dateOffset(5)} 检查`,updatedAt:dateOffset(-3)},
    {id:'muse',name:'Muse Voice Transcribe',phase:'稳定运营',strategy:'低频维护',goal:'保持转录入口稳定并记录需求',decision:'每两周做一次依赖和错误检查',nextAction:'检查转录失败日志',checkpoint:dateOffset(6),assets:'本地手动链接',condition:'',updatedAt:dateOffset(-2)}
  ],
  tasks: [
    {id:'t1',siteId:'pixvael',title:'整理 3 个用户回访问题',type:'执行',date:dateOffset(0),status:'待处理',source:'演示 seed'},
    {id:'t2',siteId:'morse',title:'第二轮 GSC 数据复盘',type:'复盘',date:dateOffset(0),status:'待处理',source:'演示 seed'},
    {id:'t3',siteId:'muse',title:'检查转录失败日志',type:'固定维护',date:dateOffset(6),status:'待处理',source:'演示 seed'},
    {id:'t4',siteId:'pixvael',title:'定价页回访决定',type:'硬截止',date:dateOffset(2),status:'待处理',source:'演示 seed'}
  ],
  logs: [
    {id:'l1',siteId:'pixvael',date:dateOffset(-1),text:'完成定价页首版，决定先看三次自然流量回访再加付费墙。',source:'ChatGPT 对话 · 手动粘贴',url:'本地手动链接',confirmed:true},
    {id:'l2',siteId:'morse',date:dateOffset(-3),text:'第二轮数据还不够新，先观察到检查日。',source:'Zcode 对话 · 手动粘贴',url:'本地手动链接',confirmed:true}
  ],
  opportunities:[{id:'o1',problem:'小团队不想为一次性图片处理上传大文件',evidence:'3 次访谈提到本地处理和可撤销',validation:'做一个本地批处理入口并邀请 5 人试用',scope:'批量压缩 + 导出',budget:'2 个周末',pass:'3/5 用户完成第二次使用',stop:'无人愿意留下邮箱',status:'验证中',siteId:null}],
  captures:[],
  selectedSite:'pixvael'
};

let currentView = 'today';
let calendarWeekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let state;
let dialogRestoreFocus = null;
let activeCaptureId = null;
let captureRouteKind = null;
let opportunityCaptureId = null;
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const clone = value => JSON.parse(JSON.stringify(value));
const siteById = id => state.sites.find(site => site.id === id);
const escapeHTML = (value='') => String(value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const sourceLink = url => /^https?:\/\//i.test(url||'') ? `<a class="source-link" href="${escapeHTML(url)}" target="_blank" rel="noreferrer">${escapeHTML(url)}</a>` : `<span class="source-link">${escapeHTML(url||'本地报告')}</span>`;
function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch (error) { return false; } }
state = loadState();

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}
function formatDate(value) { return isValidDate(value) ? new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(new Date(`${value}T12:00:00`)) : '日期异常'; }
function normalizeType(type) { return type === '维护' ? '固定维护' : type; }

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return clone(initialState);
    const loaded = JSON.parse(saved);
    const migrated = {...clone(initialState), ...loaded, tasks:Array.isArray(loaded.tasks) ? loaded.tasks : [], captures:Array.isArray(loaded.captures) ? loaded.captures : []};
    (loaded.calendar || []).forEach(event => {
      const type = normalizeType(event.type);
      const exists = migrated.tasks.some(task => task.siteId === event.siteId && task.date === event.date && normalizeType(task.type) === type);
      if (!exists) migrated.tasks.push({id:`migrated-${event.id}`,siteId:event.siteId,title:event.title,type,date:event.date,status:'待处理',source:'旧版日历迁移'});
    });
    delete migrated.calendar;
    return migrated;
  } catch (error) { return clone(initialState); }
}
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); $('#saveState').textContent = '本地已保存'; } catch (error) { $('#saveState').textContent = '仅当前页面保存'; } }
function persistCaptureChange(nextState,errorNode) { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(nextState)); state=nextState; $('#saveState').textContent='本地已保存'; return true; } catch (error) { errorNode.textContent='本地存储不可用或空间不足，未保存。请保留文字后重试。'; $('#saveState').textContent='保存失败'; return false; } }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => node.classList.remove('show'), 2600); }
function closeDialog() { const dialog=$('#actionDialog'); if(!dialog||dialog.hidden)return; dialog.hidden=true; dialog.innerHTML=''; const focusTarget=dialogRestoreFocus; dialogRestoreFocus=null; if(focusTarget?.isConnected)focusTarget.focus(); }
function openDialog({title,description,content,focusSelector}) { const dialog=$('#actionDialog'); dialogRestoreFocus=document.activeElement; dialog.innerHTML=`<div class="dialog-card"><h2 id="dialogTitle">${escapeHTML(title)}</h2><p class="dialog-description">${escapeHTML(description)}</p>${content}</div>`; dialog.hidden=false; const cancel=$('[id$="Cancel"]',dialog); if(cancel)cancel.onclick=closeDialog; if(focusSelector)$(focusSelector,dialog).focus(); }
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDialog();});
function render() { renderToday(); renderSites(); renderCalendar(); renderOpportunities(); renderInbox(); save(); }
function switchView(view) { currentView=view; $$('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view)); $$('.view').forEach(section=>section.classList.toggle('active',section.id===`view-${view}`)); const titles={today:'今天，先把一个闭环收好',sites:'把每个站点放回自己的上下文',calendar:'把下一次动作放到日历里',opportunities:'先验证，再决定要不要开始',inbox:'先接住想法，再决定去向'}; $('#pageTitle').textContent=titles[view]; render(); }

function discardCaptureDraft() {
  $('#quickCaptureForm').reset();$('#captureError').textContent='';$('#quickCapturePanel').hidden=true;
}
function saveQuickCapture(event) {
  event.preventDefault();const errorNode=$('#captureError');errorNode.textContent='';
  const text=$('#captureText').value.trim();
  if(!text){errorNode.textContent='请先写下一句话；这里只保存文字。';$('#captureText').focus();return;}
  const capture={id:`c${Date.now()}-${Math.random().toString(36).slice(2,7)}`,createdAt:new Date().toISOString(),text,status:'待整理',processedAt:null,destination:null};
  if(!persistCaptureChange({...state,captures:[capture,...state.captures]},errorNode))return;
  discardCaptureDraft();switchView('inbox');toast('已保存到待整理，尚未创建任务或机会');
}

function captureTimestamp(value) { const date=new Date(value);return Number.isNaN(date.getTime())?'时间异常':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date); }
function captureDestination(capture) {
  const destination=capture.destination;
  if(!destination)return '';
  if(destination.kind==='log')return `站点日志 · ${siteById(destination.siteId)?.name||'异常站点'}`;
  if(destination.kind==='task')return `站点任务 · ${siteById(destination.siteId)?.name||'异常站点'}`;
  return `新站计划池 · ${state.opportunities.find(item=>item.id===destination.id)?.problem||'异常机会'}`;
}
function captureRouteForm(capture) {
  if(activeCaptureId!==capture.id)return '';
  const sites=`<option value="">请选择站点</option>${state.sites.map(site=>`<option value="${escapeHTML(site.id)}">${escapeHTML(site.name)}</option>`).join('')}`;
  const fields=captureRouteKind==='log'?`<label>关联站点<select name="siteId" required>${sites}</select></label><label>写入日志的整理说明<textarea name="entry" rows="3" required>${escapeHTML(capture.text)}</textarea></label>`:`<label>关联站点<select name="siteId" required>${sites}</select></label><label>任务标题<input name="title" required value="${escapeHTML(capture.text.split('\n')[0].slice(0,100))}" placeholder="明确下一步动作"></label><label>执行日期<input name="date" type="date" required></label>`;
  return `<form class="capture-route-form" id="captureRouteForm" novalidate><strong>${captureRouteKind==='log'?'写入站点日志':'转为站点任务'}</strong><p class="capture-note">原始文字会留在待整理，可从记录回看。</p>${fields}<p id="captureRouteError" class="form-error" role="alert"></p><div class="capture-route-actions"><button class="small-button" id="cancelCaptureRoute" type="button">取消</button><button class="coral-button" type="submit">确认分流</button></div></form>`;
}
function renderInbox() {
  const pending=state.captures.filter(capture=>capture.status==='待整理').length;
  $('#inboxNavCount').textContent=pending;$('#inboxSummary').textContent=`${pending} 条待整理`;
  $('#captureList').innerHTML=state.captures.length?[...state.captures].sort((a,b)=>(a.status==='待整理'?0:1)-(b.status==='待整理'?0:1)||b.createdAt.localeCompare(a.createdAt)).map(capture=>{
    const legacyAudio=capture.audioDataUrl||capture.audioMime;
    const pendingCapture=capture.status==='待整理';
    const rawText=capture.text?escapeHTML(capture.text):'旧版记录没有原始文字；请在分流表单中补充文字，正式版不会导入这条音频记录。';
    const legacyNote=legacyAudio?'<p class="capture-note">旧版记录含历史音频字段；当前原型只读保留，不播放、不导入，也不会为新记录创建音频。</p>':'';
    return `<article class="capture-card ${pendingCapture?'':'processed'}" id="capture-${escapeHTML(capture.id)}" tabindex="-1"><div class="capture-card-header"><div><span class="eyebrow">${pendingCapture?'待整理':'已处理'} · ${escapeHTML(capture.id)}</span><h3>${pendingCapture?'先保留原话':'原话已保留'}</h3></div><time datetime="${escapeHTML(capture.createdAt)}">${captureTimestamp(capture.createdAt)}</time></div><p class="capture-raw">${rawText}</p>${legacyNote}${pendingCapture?`<div class="capture-actions"><button class="small-button" type="button" data-capture-route="log" data-capture-id="${escapeHTML(capture.id)}">写入站点日志</button><button class="small-button" type="button" data-capture-route="task" data-capture-id="${escapeHTML(capture.id)}">转为站点任务</button><button class="small-button" type="button" data-capture-route="opportunity" data-capture-id="${escapeHTML(capture.id)}">转入新站计划池</button></div>${captureRouteForm(capture)}`:`<p class="capture-destination">${escapeHTML(captureDestination(capture))} · ${captureTimestamp(capture.processedAt)}</p><button class="small-button" type="button" data-capture-destination="${escapeHTML(capture.id)}">查看去向</button>`}</article>`;
  }).join(''):'<div class="panel empty-state">还没有随手记。点右上角「+ 随手记」记录一条想法。</div>';
  $$('[data-capture-route]').forEach(button=>button.onclick=()=>{
    const capture=state.captures.find(item=>item.id===button.dataset.captureId&&item.status==='待整理');
    if(!capture)return toast('这条记录已处理，请刷新查看');
    if(button.dataset.captureRoute==='opportunity'){openOpportunityFromCapture(capture);return;}
    activeCaptureId=capture.id;captureRouteKind=button.dataset.captureRoute;renderInbox();$('#captureRouteForm [name="siteId"]').focus();
  });
  if($('#captureRouteForm')){$('#cancelCaptureRoute').onclick=()=>{activeCaptureId=null;captureRouteKind=null;renderInbox();};$('#captureRouteForm').onsubmit=confirmCaptureRoute;}
  $$('[data-capture-destination]').forEach(button=>button.onclick=()=>viewCaptureDestination(button.dataset.captureDestination));
}
function confirmCaptureRoute(event) {
  event.preventDefault();const capture=state.captures.find(item=>item.id===activeCaptureId&&item.status==='待整理');
  if(!capture)return toast('这条记录已处理，请刷新查看');
  const form=new FormData(event.target),site=siteById(form.get('siteId')),errorNode=$('#captureRouteError');
  if(!site){errorNode.textContent='请选择关联站点。';event.target.elements.siteId.focus();return;}
  const processedAt=new Date().toISOString();let record,nextState;
  if(captureRouteKind==='log'){
    const entry=String(form.get('entry')||'').trim();
    if(!entry){errorNode.textContent='请填写整理说明；原始文字仍会保留。';event.target.elements.entry.focus();return;}
    record={id:`l${Date.now()}-${Math.random().toString(36).slice(2,7)}`,siteId:site.id,date:dateOffset(0),text:entry,source:'随手记 · 人工整理',url:'本地随手记',confirmed:true,captureId:capture.id};
    nextState={...state,logs:[...state.logs,record]};
  } else {
    const title=String(form.get('title')||'').trim(),date=String(form.get('date')||'');
    if(!title){errorNode.textContent='请填写明确的任务标题。';event.target.elements.title.focus();return;}
    if(!isValidDate(date)){errorNode.textContent='请选择真实有效的执行日期。';event.target.elements.date.focus();return;}
    record={id:`t${Date.now()}-${Math.random().toString(36).slice(2,7)}`,siteId:site.id,title,type:'执行',date,status:'待处理',source:'随手记 · 人工整理',captureId:capture.id};
    nextState={...state,tasks:[...state.tasks,record]};
  }
  const destination={kind:captureRouteKind,id:record.id,siteId:site.id};
  nextState.captures=state.captures.map(item=>item.id===capture.id?{...item,status:'已处理',processedAt,destination}:item);
  if(!persistCaptureChange(nextState,errorNode))return;
  activeCaptureId=null;captureRouteKind=null;render();toast(destination.kind==='log'?'已写入站点日志，原始随手记仍可查看':'已创建站点任务，日历同步更新');
}
function viewCaptureDestination(id) {
  const capture=state.captures.find(item=>item.id===id),destination=capture?.destination;
  if(!destination)return toast('找不到处理去向');
  if(destination.kind==='opportunity'){switchView('opportunities');document.getElementById(`opportunity-${destination.id}`)?.scrollIntoView({block:'center'});return;}
  if(!siteById(destination.siteId))return toast('关联站点不存在，原始记录仍在待整理');
  state.selectedSite=destination.siteId;switchView('sites');const target=document.getElementById(`${destination.kind}-${destination.id}`);target?.scrollIntoView({block:'center'});target?.focus();
}
function viewOriginalCapture(id) { switchView('inbox');const card=document.getElementById(`capture-${id}`);card?.scrollIntoView({block:'center'});card?.focus(); }

function renderToday() {
  const pending=state.tasks.filter(task=>task.status!=='完成'&&task.date<=dateOffset(0));
  const reviewCount=state.tasks.filter(task=>task.type==='复盘'&&task.status!=='完成'&&task.date<=dateOffset(7)).length;
  const recentLogCount=state.logs.filter(log=>isValidDate(log.date)&&log.date>=dateOffset(-6)&&log.date<=dateOffset(0)).length;
  $('#todaySiteSummary').textContent=`${state.sites.length} 个站点 · ${reviewCount} 个待复盘节点`; $('#todoCount').textContent=pending.length; $('#waitingCount').textContent=state.sites.filter(site=>['观察','暂停'].includes(site.strategy)).length; $('#reviewCount').textContent=reviewCount; $('#recentLogCount').textContent=recentLogCount; $('#taskLabel').textContent=`${pending.length} 项`;
  $('#taskList').innerHTML=pending.length?pending.map(task=>{const site=siteById(task.siteId);return `<div class="task-row"><i class="task-marker"></i><div><button class="task-title task-link" type="button" data-task-site="${escapeHTML(task.siteId||'')}">${escapeHTML(task.title)}</button><div class="task-meta">${escapeHTML(site?.name||'异常站点')} · ${escapeHTML(task.type)} · ${formatDate(task.date)}</div></div><div class="task-actions"><button class="small-button" data-complete="${task.id}">完成</button><button class="small-button" data-reschedule="${task.id}">改期</button></div></div>`}).join(''):'<div class="empty-state">今天没有排定执行。去计划池记录一个新机会。</div>';
  $('#waitingList').innerHTML=state.sites.filter(site=>['观察','暂停'].includes(site.strategy)).map(site=>`<div class="waiting-item"><strong>${escapeHTML(site.name)}</strong><p>${escapeHTML(site.condition||'条件异常：请补充策略条件')}</p></div>`).join('')||'<div class="empty-state">目前没有等待条件。</div>';
  $('#sitePulse').innerHTML=state.sites.map(site=>`<button class="pulse-card" data-pulse-site="${site.id}"><div class="card-top"><span class="eyebrow">${escapeHTML(site.phase)}</span><span class="strategy ${site.strategy==='观察'?'observe':''} ${site.strategy==='暂停'?'pause':''}">${escapeHTML(site.strategy)}</span></div><h4>${escapeHTML(site.name)}</h4><p>${escapeHTML(site.goal)}</p><div class="next-action"><small>下一行动 · ${formatDate(site.checkpoint)}</small>${escapeHTML(site.nextAction)}</div></button>`).join('');
  $$('[data-complete]').forEach(button=>button.onclick=()=>completeTask(button.dataset.complete)); $$('[data-reschedule]').forEach(button=>button.onclick=()=>rescheduleTask(button.dataset.reschedule)); $$('[data-task-site]').forEach(button=>button.onclick=()=>{if(!siteById(button.dataset.taskSite))return toast('异常：找不到任务所属站点');state.selectedSite=button.dataset.taskSite;switchView('sites')}); $$('[data-pulse-site]').forEach(button=>button.onclick=()=>{state.selectedSite=button.dataset.pulseSite;switchView('sites')}); $$('.text-button[data-view-target]').forEach(button=>button.onclick=()=>switchView(button.dataset.viewTarget));
}
function completeTask(id) { const task=state.tasks.find(item=>item.id===id); if(!task)return toast('异常：找不到任务'); task.status='完成'; save(); toast('任务已完成，日历同步更新'); render(); }
function rescheduleTask(id) { const task=state.tasks.find(item=>item.id===id); if(!task)return toast('异常：找不到任务'); openTaskDialog(task,false); }
function openTaskDialog(task,allowComplete) { openDialog({title:allowComplete?'处理日历任务':'改期任务',description:`${task.title} · ${siteById(task.siteId)?.name||'异常站点'}`,focusSelector:'#dialogDate',content:`<form class="dialog-form" id="dialogForm"><label for="dialogDate">新的任务日期<input id="dialogDate" name="date" type="date" required value="${escapeHTML(task.date)}" aria-describedby="dialogError"></label><p class="dialog-error" id="dialogError" role="alert"></p><div class="dialog-actions"><button class="small-button" type="button" id="dialogCancel">取消</button>${allowComplete?'<button class="small-button" type="button" id="dialogComplete">完成任务</button>':''}<button class="coral-button" type="submit">确认改期</button></div></form>`}); $('#dialogForm').onsubmit=event=>{event.preventDefault();const next=$('#dialogDate').value;if(!isValidDate(next)){ $('#dialogError').textContent='请输入真实有效的日期';$('#dialogDate').focus();return;}task.date=next;task.status='已改期';save();closeDialog();toast(`已改期到 ${formatDate(next)}，日历同步更新`);render();}; if(allowComplete)$('#dialogComplete').onclick=()=>{closeDialog();completeTask(task.id);}; }
function upsertReviewTask(site,date,title=`${site.name} · 阶段复盘`,source='策略观察') { const matches=state.tasks.filter(task=>task.siteId===site.id&&task.type==='复盘'&&task.source===source); const task=matches[0]; if(task){task.title=title;task.date=date;task.status=task.status==='完成'?'待处理':task.status;matches.slice(1).forEach(duplicate=>{state.tasks=state.tasks.filter(item=>item.id!==duplicate.id);});return task;} const created={id:`t${Date.now()}-${Math.random().toString(36).slice(2,7)}`,siteId:site.id,title,type:'复盘',date,status:'待处理',source}; state.tasks.push(created); return created; }
function addExecutionTask(site,title,date,source) { const duplicate=state.tasks.find(task=>task.siteId===site.id&&task.type==='执行'&&task.title===title&&task.date===date&&task.source===source&&task.status!=='完成'); if(duplicate)return duplicate; const task={id:`t${Date.now()}-${Math.random().toString(36).slice(2,7)}`,siteId:site.id,title,type:'执行',date,status:'待处理',source}; state.tasks.push(task); return task; }

function renderSites() {
  const selected=siteById(state.selectedSite)||state.sites[0]; if(!selected)return; state.selectedSite=selected.id;
  $('#siteList').innerHTML=state.sites.map(site=>`<button class="site-card ${site.id===selected.id?'selected':''}" data-site-select="${site.id}"><div class="card-top"><small>${escapeHTML(site.phase)}</small><span class="strategy ${site.strategy==='观察'?'observe':''} ${site.strategy==='暂停'?'pause':''}">${escapeHTML(site.strategy)}</span></div><h4>${escapeHTML(site.name)}</h4><p>下一检查点 · ${formatDate(site.checkpoint)}</p></button>`).join(''); $$('[data-site-select]').forEach(button=>button.onclick=()=>{state.selectedSite=button.dataset.siteSelect;renderSites()}); renderSiteDetail(selected);
}
function renderSiteDetail(site) {
  const logs=state.logs.filter(log=>log.siteId===site.id).sort((a,b)=>b.date.localeCompare(a.date)); const tasks=state.tasks.filter(task=>task.siteId===site.id);
  $('#siteDetail').innerHTML=`<div class="detail-header"><div><span class="eyebrow">${escapeHTML(site.phase)} · 最后更新 ${formatDate(site.updatedAt||logs[0]?.date)}</span><h2>${escapeHTML(site.name)}</h2><p class="detail-sub">${escapeHTML(site.goal)}</p></div><div class="detail-actions"><button class="outline-button" id="generateHandoff">生成交接包</button><button class="coral-button" id="toggleReport">收尾报告</button></div></div><div class="detail-grid"><div><dl class="fact-grid"><div class="fact"><dt>策略</dt><dd><select id="strategySelect" aria-label="策略"><option>推进</option><option>观察</option><option>低频维护</option><option>暂停</option><option>归档</option></select></dd></div><div class="fact"><dt>下一检查点</dt><dd>${formatDate(site.checkpoint)}</dd></div><div class="fact full"><dt>最近决策</dt><dd>${escapeHTML(site.decision)}</dd></div><div class="fact full"><dt>下一行动</dt><dd>${escapeHTML(site.nextAction)}</dd></div></dl><div id="conditionArea"></div><div class="panel timeline"><div class="panel-heading"><div><span class="eyebrow">原文留痕</span><h3>时间线</h3></div><span class="count-label">${logs.length} 条</span></div>${logs.map(log=>`<div class="timeline-item"><time>${escapeHTML(log.date)} · ${escapeHTML(log.source)}</time><p>${escapeHTML(log.text)}</p>${sourceLink(log.url)}</div>`).join('')}<form class="inline-form" id="timelineForm"><label>追加一条工作记录<textarea name="text" required rows="2" placeholder="发生了什么？下一步做什么？"></textarea></label><div class="form-two"><label>下一行动<input name="nextAction" required value="${escapeHTML(site.nextAction)}"></label><label>行动日期<input name="date" type="date" required value="${isValidDate(site.checkpoint)?site.checkpoint:''}"></label></div><button class="outline-button" type="submit">追加时间线并排入日历</button></form></div></div><div><div class="panel"><div class="panel-heading"><div><span class="eyebrow">任务</span><h3>站点任务</h3></div></div>${tasks.map(task=>`<div class="task-row"><i class="task-marker"></i><div><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta">${escapeHTML(task.type)} · ${formatDate(task.date)} · ${escapeHTML(task.status)}</div></div></div>`).join('')||'<div class="empty-state">暂无任务。</div>'}</div><div id="reportPanel"></div><div id="handoffPanel"></div></div></div>`;
  $$('.timeline-item',$('#siteDetail')).forEach((node,index)=>{node.id=`log-${logs[index].id}`;node.tabIndex=-1;const captureId=logs[index]?.captureId;if(!captureId)return;const button=document.createElement('button');button.type='button';button.className='small-button';button.textContent='查看原始随手记';button.onclick=()=>viewOriginalCapture(captureId);node.append(button);});
  $$('.detail-grid > div:last-child > .panel .task-row',$('#siteDetail')).forEach((node,index)=>{const task=tasks[index];node.id=`task-${task.id}`;node.tabIndex=-1;if(!task.captureId)return;const button=document.createElement('button');button.type='button';button.className='small-button';button.textContent='查看原始随手记';button.onclick=()=>viewOriginalCapture(task.captureId);node.children[1].append(button);});
  $('#strategySelect').value=site.strategy; $('#strategySelect').onchange=()=>changeStrategy(site);
  $('#timelineForm').onsubmit=event=>{event.preventDefault();const form=new FormData(event.target);const date=form.get('date');if(!isValidDate(date))return toast('请输入真实有效的行动日期');site.nextAction=form.get('nextAction').trim();site.checkpoint=date;site.updatedAt=dateOffset(0);state.logs.push({id:`l${Date.now()}`,siteId:site.id,date:dateOffset(0),text:form.get('text').trim(),source:'工作台 · 时间线追加',url:'本地记录',confirmed:true});state.tasks.push({id:`t${Date.now()}`,siteId:site.id,title:site.nextAction,type:'执行',date,status:'待处理',source:'时间线追加'});save();toast('时间线已追加，下一行动已排入日历');render()};
  $('#toggleReport').onclick=()=>showReportPanel(site); $('#generateHandoff').onclick=()=>showHandoff(site);
}
function changeStrategy(site) { const value=$('#strategySelect').value; const area=$('#conditionArea'); if(value==='观察')area.innerHTML=`<div class="condition-note"><strong>观察需要等待条件和检查日期</strong><label>等待条件<input id="conditionInput" required placeholder="例如：等待 5 个用户完成第二次使用"></label><label>检查日期<input id="conditionDate" type="date" required value="${isValidDate(site.checkpoint)?site.checkpoint:''}"></label><button class="small-button" id="saveCondition">保存观察策略</button></div>`; else if(value==='暂停')area.innerHTML='<div class="condition-note"><strong>暂停需要重启条件</strong><label>重启条件<input id="conditionInput" required placeholder="例如：有 3 个付费用户主动询价"></label><button class="small-button" id="saveCondition">保存暂停策略</button></div>'; else {site.strategy=value;site.condition='';site.updatedAt=dateOffset(0);save();toast(`策略已更新为“${value}”`);render();return;} $('#saveCondition').onclick=()=>{const condition=$('#conditionInput').value.trim();const checkDate=value==='观察'?$('#conditionDate').value:'';if(!condition||(value==='观察'&&!isValidDate(checkDate)))return toast(value==='观察'?'请填写等待条件和真实检查日期':'请填写重启条件');site.strategy=value;site.condition=condition+(value==='观察'?`；${checkDate} 检查`:'');if(value==='观察'){site.checkpoint=checkDate;upsertReviewTask(site,checkDate);}site.updatedAt=dateOffset(0);save();toast(`已切换为“${value}”并保存条件`);render();}; }
function showHandoff(site) { const panel=$('#handoffPanel'); const text=`【${site.name} · 交接包】\n阶段：${site.phase}｜策略：${site.strategy}\n最近决策：${site.decision}\n下一行动：${site.nextAction}\n检查点：${site.checkpoint}\n遗留：${site.condition||'暂无'}\n来源：${state.logs.find(log=>log.siteId===site.id)?.url||'暂无'}`; panel.innerHTML=`<div class="panel handoff-panel"><div class="panel-heading"><div><span class="eyebrow">可复制摘要</span><h3>交接包</h3></div><button class="small-button" id="copyHandoff">复制</button></div><div class="handoff-text" id="handoffText">${escapeHTML(text)}</div></div>`; $('#copyHandoff').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('交接包已复制')}catch(error){const range=document.createRange();range.selectNode($('#handoffText'));getSelection().removeAllRanges();getSelection().addRange(range);toast('剪贴板不可用，已选中摘要文本')}}; }
function showReportPanel(site) { $('#reportPanel').innerHTML=`<div class="panel report-panel"><div class="panel-heading"><div><span class="eyebrow">收尾记录</span><h3>粘贴报告</h3></div></div><p class="report-help">规则演示：按字段标签提取，不连接真实模型。请编辑预览并人工确认。</p><textarea id="reportInput" rows="7" placeholder="完成：……\n证据：……\n遗留：……\n下一步：……\n下一行动日期：${dateOffset(1)}\n复盘日期：${dateOffset(4)}"></textarea><label class="report-source">原始来源 URL（可选）<input id="reportSourceUrl" type="url" placeholder="https://chatgpt.com/... 或 https://zcode... "></label><button class="coral-button" id="extractReport" style="margin-top:12px">生成提取预览</button><div id="previewArea"></div></div>`; $('#extractReport').onclick=()=>extractReport(site); }
function extractReport(site) { const text=$('#reportInput').value.trim();if(!text){toast('请先粘贴收尾报告');$('#reportInput').focus();return;}const pick=(label,fallback)=>{const match=text.match(new RegExp(`${label}[：:]\\s*(.+)`,'i'));return match?match[1].trim():fallback;};const data={completed:pick('完成',''),evidence:pick('证据',''),openItems:pick('遗留',''),nextStep:pick('下一步',''),nextActionDate:pick('下一行动日期',site.checkpoint),reviewDate:pick('复盘日期','')};$('#previewArea').innerHTML=`<div class="preview-box"><h4>提取预览 <span class="preview-badge">规则演示 · 可编辑 · 待确认</span></h4><div class="preview-grid"><label>完成<textarea id="reportCompleted" required>${escapeHTML(data.completed)}</textarea></label><label>证据<textarea id="reportEvidence" required>${escapeHTML(data.evidence)}</textarea></label><label>遗留<textarea id="reportOpenItems" required>${escapeHTML(data.openItems)}</textarea></label><label>下一步<textarea id="reportNextStep" required>${escapeHTML(data.nextStep||site.nextAction)}</textarea></label><label>下一行动日期<input id="reportNextActionDate" type="date" required value="${escapeHTML(data.nextActionDate)}"></label><label>复盘日期<input id="reportReviewDate" type="date" required value="${escapeHTML(data.reviewDate)}"></label></div><p id="reportError" class="form-error" role="alert"></p><button class="coral-button" id="confirmReport" style="margin-top:13px">确认回填</button></div>`;$('#confirmReport').onclick=()=>{const button=$('#confirmReport');if(button.disabled)return;const fields={completed:$('#reportCompleted').value.trim(),evidence:$('#reportEvidence').value.trim(),openItems:$('#reportOpenItems').value.trim(),nextStep:$('#reportNextStep').value.trim(),nextActionDate:$('#reportNextActionDate').value,reviewDate:$('#reportReviewDate').value,sourceUrl:$('#reportSourceUrl').value.trim()};const error=$('#reportError');const missing=Object.entries(fields).filter(([key,value])=>!value&&['completed','evidence','openItems','nextStep'].includes(key)).map(([key])=>({completed:'完成',evidence:'证据',openItems:'遗留',nextStep:'下一步'}[key]));if(missing.length||!isValidDate(fields.nextActionDate)||!isValidDate(fields.reviewDate)||fields.sourceUrl&&!isHttpUrl(fields.sourceUrl)){error.textContent=missing.length?`请补充：${missing.join('、')}`:fields.sourceUrl?'来源 URL 必须以 http:// 或 https:// 开头':'请输入真实有效的下一行动日期和复盘日期';return;}button.disabled=true;const sourceUrl=fields.sourceUrl||'本地报告';site.nextAction=fields.nextStep;site.checkpoint=fields.reviewDate;site.updatedAt=dateOffset(0);state.logs.push({id:`l${Date.now()}`,siteId:site.id,date:dateOffset(0),text,source:'收尾报告 · 人工确认',url:sourceUrl,confirmed:true,report:fields});addExecutionTask(site,fields.nextStep,fields.nextActionDate,'收尾报告确认');upsertReviewTask(site,fields.reviewDate,`${site.name} · 阶段复盘`,'收尾报告确认');save();toast('报告已确认，下一行动和复盘任务已更新');render();}; }
function renderCalendar() { const names=['日','一','二','三','四','五','六'];const days=Array.from({length:7},(_,index)=>{const date=new Date(calendarWeekStart);date.setDate(calendarWeekStart.getDate()+index);return localDateKey(date);});$('#calendarBoard').innerHTML=`<div class="calendar-toolbar"><button class="small-button" id="calendarPrev">上一周</button><strong>${formatDate(days[0])} – ${formatDate(days[6])}</strong><button class="small-button" id="calendarNext">下一周</button></div>${days.map(day=>{const dayIndex=new Date(`${day}T12:00:00`).getDay();return `<div class="day-column ${day===dateOffset(0)?'today':''}"><div class="day-name">${day===dateOffset(0)?'今天':`周${names[dayIndex]}`}</div><div class="day-number">${day.slice(-2)}</div>${state.tasks.filter(task=>task.status!=='完成'&&task.date===day).map(task=>`<button class="calendar-event ${task.type==='复盘'?'review':''} ${task.type==='固定维护'?'maintenance':''} ${task.type==='硬截止'?'deadline':''}" data-calendar-task="${task.id}"><strong>${escapeHTML(task.type)}</strong>${escapeHTML(task.title)}</button>`).join('')||'<div class="calendar-empty">无安排</div>'}</div>`;}).join('')}`;$('#calendarPrev').onclick=()=>{calendarWeekStart.setDate(calendarWeekStart.getDate()-7);renderCalendar();};$('#calendarNext').onclick=()=>{calendarWeekStart.setDate(calendarWeekStart.getDate()+7);renderCalendar();};$$('[data-calendar-task]').forEach(button=>button.onclick=()=>{const task=state.tasks.find(item=>item.id===button.dataset.calendarTask);if(!task)return toast('异常：找不到任务');openTaskDialog(task,true);}); }
function renderOpportunities() {
  const list=$('#opportunityList');
  list.innerHTML=state.opportunities.length?state.opportunities.map(opportunity=>`<article class="opportunity-card" id="opportunity-${escapeHTML(opportunity.id)}"><label class="opportunity-status">状态<select data-opportunity-status="${escapeHTML(opportunity.id)}" ${opportunity.siteId?'disabled':''}><option ${opportunity.status==='想法'?'selected':''}>想法</option><option ${opportunity.status==='验证中'?'selected':''}>验证中</option><option ${opportunity.status==='通过'?'selected':''}>通过</option><option ${opportunity.status==='停止'?'selected':''}>停止</option></select></label><h3>${escapeHTML(opportunity.problem)}</h3><p><b>证据：</b>${escapeHTML(opportunity.evidence)}</p><p><b>最小验证：</b>${escapeHTML(opportunity.validation)}</p><p><b>投入上限：</b>${escapeHTML(opportunity.budget)} · <b>停止：</b>${escapeHTML(opportunity.stop)}</p><div class="opportunity-actions"><button class="small-button" data-promote="${escapeHTML(opportunity.id)}" ${opportunity.siteId||opportunity.status!=='通过'?'disabled':''}>${opportunity.siteId?'已转入网站':'转入新网站'}</button><span class="task-meta">${opportunity.siteId?`已关联 ${escapeHTML(siteById(opportunity.siteId)?.name||'异常站点')}`:'尚未关联'}</span>${opportunity.captureId?`<button class="small-button" type="button" data-opportunity-capture="${escapeHTML(opportunity.captureId)}">查看原始随手记</button>`:''}</div></article>`).join(''):'<div class="panel empty-state">还没有机会。记录一个用户问题，开始验证。</div>';
  $$('[data-opportunity-status]').forEach(select=>select.onchange=()=>{const opportunity=state.opportunities.find(item=>item.id===select.dataset.opportunityStatus);if(!opportunity||opportunity.siteId)return;opportunity.status=select.value;save();toast(`机会状态已更新为“${select.value}”`);renderOpportunities();});
  $$('[data-promote]').forEach(button=>button.onclick=()=>promoteOpportunity(button.dataset.promote));
  $$('[data-opportunity-capture]').forEach(button=>button.onclick=()=>viewOriginalCapture(button.dataset.opportunityCapture));
}
function promoteOpportunity(id) { const opportunity=state.opportunities.find(item=>item.id===id);if(!opportunity)return;if(opportunity.status!=='通过')return toast('请先把机会状态设为“通过”，再转入新网站');openDialog({title:'转入新网站',description:'机会已通过。填写名称后会创建站点、任务并保留机会关联。',focusSelector:'#dialogSiteName',content:`<form class="dialog-form" id="dialogForm"><label for="dialogSiteName">新网站名称<input id="dialogSiteName" name="name" required maxlength="80" value="${escapeHTML(opportunity.problem.slice(0,24))}" aria-describedby="dialogError"></label><p class="dialog-error" id="dialogError" role="alert"></p><div class="dialog-actions"><button class="small-button" type="button" id="dialogCancel">取消</button><button class="coral-button" type="submit">确认转入</button></div></form>`}); $('#dialogForm').onsubmit=event=>{event.preventDefault();const name=$('#dialogSiteName').value.trim();if(!name){$('#dialogError').textContent='请填写新网站名称';$('#dialogSiteName').focus();return;}const site={id:`site${Date.now()}`,name,phase:'机会验证',strategy:'推进',goal:opportunity.problem,decision:'机会已通过，开始最小验证',nextAction:opportunity.validation,checkpoint:dateOffset(7),assets:'待补充',condition:'',updatedAt:dateOffset(0)};state.sites.push(site);opportunity.siteId=site.id;addExecutionTask(site,opportunity.validation,site.checkpoint,'机会转入网站');state.selectedSite=site.id;save();closeDialog();toast(`已创建新网站“${site.name}”`);render();}; }

function openOpportunityFromCapture(capture) {
  opportunityCaptureId=capture.id;activeCaptureId=null;captureRouteKind=null;
  switchView('opportunities');
  const form=$('#opportunityForm');form.reset();form.elements.problem.value=capture.text.slice(0,120);
  $('#opportunityCaptureNote').hidden=false;$('#opportunityCaptureNote').textContent=`来源：随手记 ${capture.id}。请补全所有字段并人工确认；原始文字会留在待整理。`;
  $('#opportunityError').textContent='';$('#opportunityFormWrap').hidden=false;form.elements.problem.focus();
}
function cancelOpportunityForm() {
  const fromCapture=Boolean(opportunityCaptureId);
  opportunityCaptureId=null;$('#opportunityForm').reset();$('#opportunityError').textContent='';$('#opportunityCaptureNote').hidden=true;$('#opportunityFormWrap').hidden=true;
  if(fromCapture)switchView('inbox');
}

$('#resetDemo').onclick=()=>openDialog({title:'重置演示数据',description:'本地改动会被覆盖，站点、任务、日志、计划池和随手记将恢复初始数据。',focusSelector:'#dialogResetCancel',content:'<div class="dialog-actions"><button class="small-button" type="button" id="dialogResetCancel">取消</button><button class="coral-button" type="button" id="dialogResetConfirm">确认重置</button></div>'});
document.addEventListener('click',event=>{if(event.target===$('#dialogResetConfirm')){discardCaptureDraft();activeCaptureId=null;captureRouteKind=null;opportunityCaptureId=null;$('#opportunityForm').reset();$('#opportunityFormWrap').hidden=true;state=clone(initialState);calendarWeekStart=new Date(today.getFullYear(),today.getMonth(),today.getDate());save();closeDialog();toast('已恢复演示数据');render();}});
$$('.nav-item').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('#openQuickCapture').onclick=()=>{$('#quickCapturePanel').hidden=false;$('#captureText').focus();};
$('#cancelQuickCapture').onclick=discardCaptureDraft;
$('#quickCaptureForm').onsubmit=saveQuickCapture;
$('#showOpportunityForm').onclick=()=>{if(!$('#opportunityFormWrap').hidden){cancelOpportunityForm();return;}opportunityCaptureId=null;$('#opportunityCaptureNote').hidden=true;$('#opportunityError').textContent='';$('#opportunityFormWrap').hidden=false;$('#opportunityForm [name="problem"]').focus();};
$('#cancelOpportunityForm').onclick=cancelOpportunityForm;
$('#opportunityForm').onsubmit=event=>{
  event.preventDefault();const form=event.target,errorNode=$('#opportunityError');errorNode.textContent='';
  const data=Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,String(value).trim()]));
  const missing=Object.keys(data).find(key=>!data[key]);
  if(missing){errorNode.textContent='请补齐所有机会字段后再保存。';form.elements[missing].focus();return;}
  const capture=opportunityCaptureId?state.captures.find(item=>item.id===opportunityCaptureId&&item.status==='待整理'):null;
  if(opportunityCaptureId&&!capture){errorNode.textContent='原始随手记已处理，请返回待整理核对。';return;}
  const opportunity={id:`o${Date.now()}-${Math.random().toString(36).slice(2,7)}`,...data,status:'想法',siteId:null,...(capture?{captureId:capture.id}:{})};
  const nextState={...state,opportunities:[...state.opportunities,opportunity]};
  if(capture)nextState.captures=state.captures.map(item=>item.id===capture.id?{...item,status:'已处理',processedAt:new Date().toISOString(),destination:{kind:'opportunity',id:opportunity.id}}:item);
  if(!persistCaptureChange(nextState,errorNode))return;
  form.reset();$('#opportunityFormWrap').hidden=true;$('#opportunityCaptureNote').hidden=true;opportunityCaptureId=null;
  switchView(capture?'inbox':'opportunities');toast('机会已加入计划池，原始随手记仍可查看');
};
$('#topDate').textContent=new Intl.DateTimeFormat('zh-CN',{weekday:'short',month:'2-digit',day:'2-digit'}).format(today);
render();
