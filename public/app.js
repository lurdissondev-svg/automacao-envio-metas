// Security note: All user-provided text is escaped via escapeHtml() before DOM insertion.
// innerHTML is only used with application-controlled template strings where dynamic
// values are always escaped. This is a trusted internal admin panel not exposed to
// untrusted third-party content.

let schedules = [];
let selectedSchedule = null;
let schedulerRunning = false;
let deleteScheduleId = null;
let whatsappConnected = false;
let availableGroups = [];
let selectedGroups = [];
let currentView = 'schedule';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// ========== AUTH ==========

function getToken() { return sessionStorage.getItem('auth_token'); }
function setToken(token) { sessionStorage.setItem('auth_token', token); }
function clearToken() { sessionStorage.removeItem('auth_token'); }

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.querySelector('.app-container').style.display = 'flex';
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.querySelector('.app-container').style.display = 'none';
}

async function doLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errEl.style.display = 'none';

  if (!user || !pass) { errEl.textContent = 'Preencha todos os campos'; errEl.style.display = 'block'; return; }

  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (data.success) {
      setToken(data.data.token);
      showApp();
      initApp();
    } else {
      errEl.textContent = data.error || 'Credenciais invalidas';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'Erro de conexao';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function doLogout() {
  clearToken();
  showLogin();
}

// Fetch com token de autenticacao
async function authFetch(url, options) {
  const token = getToken();
  if (!token) { showLogin(); throw new Error('Nao autenticado'); }

  const opts = options || {};
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(url, opts);
  if (res.status === 401) { clearToken(); showLogin(); throw new Error('Sessao expirada'); }
  return res;
}

// Enter para logar
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') {
    doLogin();
  }
});

async function loadSchedules() {
  try {
    const res = await authFetch('/api/schedules');
    const data = await res.json();
    if (data.success) { schedules = data.data; renderScheduleList(); }
  } catch (e) { showToast('Erro ao carregar agendamentos', 'error'); }
}

async function checkSchedulerStatus() {
  try {
    const res = await authFetch('/api/status');
    const data = await res.json();
    if (data.success) { schedulerRunning = data.data.scheduler.isRunning; updateSchedulerButton(); }
  } catch (e) { /* silent */ }
}

async function checkWhatsAppStatus() {
  try {
    const res = await authFetch('/api/whatsapp/status');
    const data = await res.json();
    if (data.success) { whatsappConnected = data.data.connected; updateConnectionStatus(data.data); }
  } catch (e) { updateConnectionStatus({ connected: false }); }
}

function updateConnectionStatus(data) {
  const indicator = document.getElementById('connectionIndicator');
  const title = document.getElementById('connectionTitle');
  const subtitle = document.getElementById('connectionSubtitle');
  if (data.connected) {
    indicator.classList.add('connected');
    title.textContent = 'WhatsApp Conectado';
    subtitle.textContent = 'Pronto para enviar';
  } else {
    indicator.classList.remove('connected');
    title.textContent = 'WhatsApp Desconectado';
    subtitle.textContent = 'Clique para conectar';
  }
}

function renderScheduleList() {
  const list = document.getElementById('scheduleList');
  if (schedules.length === 0) {
    list.textContent = '';
    const p = document.createElement('div');
    p.style.cssText = 'padding:40px;text-align:center;color:var(--whatsapp-text-secondary)';
    p.textContent = 'Nenhum agendamento';
    list.appendChild(p);
    return;
  }
  // All dynamic values are escaped
  list.innerHTML = schedules.map(s => {
    const cp = s.cron.split(' ');
    const time = cp[1].padStart(2,'0')+':'+cp[0].padStart(2,'0');
    return `<div class="schedule-item ${selectedSchedule?.id===s.id?'active':''}" onclick="selectSchedule('${escapeHtml(s.id)}')"><div class="schedule-avatar">${escapeHtml(s.name.charAt(0).toUpperCase())}</div><div class="schedule-info"><div class="schedule-name">${escapeHtml(s.name)}</div><div class="schedule-time"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>${escapeHtml(time)} - ${s.groups.length} grupo(s)</div></div></div>`;
  }).join('');
}

async function showWhatsAppPanel() {
  currentView = 'whatsapp';
  const m = document.getElementById('mainContent');
  m.innerHTML = `<div class="main-header"><div class="main-header-info"><div class="main-header-avatar" style="background:#25D366"><svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></div><div class="main-header-text"><h2>Conexao WhatsApp</h2><p id="whatsappStatus">Verificando...</p></div></div><div style="display:flex;gap:8px"><button class="btn btn-secondary" onclick="showInstanceInfo()">Info</button></div></div><div class="qr-container" id="qrContainer"><div class="spinner"></div><p style="margin-top:16px">Carregando...</p></div><div id="instanceManagement" style="margin-top:24px;padding:20px;background:var(--whatsapp-sidebar);border-radius:12px;max-width:500px;margin-left:auto;margin-right:auto"><h3 style="margin-bottom:16px;font-size:16px">Gerenciamento de Instancia</h3><div id="instanceInfo" style="margin-bottom:16px;padding:12px;background:var(--whatsapp-input);border-radius:8px"><p style="font-size:13px;color:var(--whatsapp-text-secondary)">Carregando...</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" onclick="showCreateInstanceModal()" style="flex:1;min-width:140px">Nova Instancia</button><button class="btn btn-danger" onclick="confirmDeleteInstance()" id="btnDeleteInstance" style="flex:1;min-width:140px">Deletar Instancia</button></div></div>`;
  await loadInstanceInfo();
  await loadQRCode();
}

async function loadInstanceInfo() {
  const d = document.getElementById('instanceInfo');
  try {
    const res = await authFetch('/api/instance/info');
    const data = await res.json();
    if (data.success) {
      const i = data.data;
      d.innerHTML = `<div style="display:grid;gap:8px;font-size:13px"><div style="display:flex;justify-content:space-between"><span style="color:var(--whatsapp-text-secondary)">Instance ID:</span><span style="font-family:monospace">${escapeHtml(i.instanceId||'Nao configurado')}</span></div><div style="display:flex;justify-content:space-between"><span style="color:var(--whatsapp-text-secondary)">Status:</span><span style="color:${i.connected?'var(--whatsapp-green)':'#ff6b6b'}">${escapeHtml(i.status||'desconhecido')}</span></div><div style="display:flex;justify-content:space-between"><span style="color:var(--whatsapp-text-secondary)">Admin Token:</span><span style="color:${i.hasAdminToken?'var(--whatsapp-green)':'#ff6b6b'}">${i.hasAdminToken?'Configurado':'Nao configurado'}</span></div></div>`;
      const bd = document.getElementById('btnDeleteInstance');
      if (bd&&!i.instanceId){bd.disabled=true;bd.style.opacity='0.5';}
    }
  } catch(e) { d.textContent='Erro ao carregar info'; }
}

function showInstanceInfo(){loadInstanceInfo();showToast('Informacoes atualizadas','success');}

function showCreateInstanceModal(){
  const modal=document.createElement('div');
  modal.className='modal-overlay active';modal.id='createInstanceModal';
  modal.innerHTML=`<div class="modal"><div class="modal-header"><h3>Criar Nova Instancia</h3></div><div class="modal-body"><div class="form-group"><label class="form-label">Nome da Instancia</label><input type="text" id="newInstanceName" class="form-input" placeholder="ex: minha-automacao"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById('createInstanceModal').remove()">Cancelar</button><button class="btn btn-primary" onclick="createNewInstance()">Criar</button></div></div>`;
  document.body.appendChild(modal);
}

async function createNewInstance(){
  const name=document.getElementById('newInstanceName').value.trim();
  if(!name){showToast('Digite um nome','error');return;}
  try{
    const res=await authFetch('/api/instance/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instanceName:name})});
    const data=await res.json();
    if(data.success){document.getElementById('createInstanceModal')?.remove();showToast('Instancia criada!','success');await showWhatsAppPanel();}
    else showToast(data.error||'Erro','error');
  }catch(e){showToast('Erro ao criar','error');}
}

function confirmDeleteInstance(){
  const modal=document.createElement('div');
  modal.className='modal-overlay active';modal.id='deleteInstanceModal';
  modal.innerHTML=`<div class="modal"><div class="modal-header"><h3>Deletar Instancia</h3></div><div class="modal-body"><p>Tem certeza? Irreversivel.</p></div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById('deleteInstanceModal').remove()">Cancelar</button><button class="btn btn-danger" onclick="deleteCurrentInstance()">Deletar</button></div></div>`;
  document.body.appendChild(modal);
}

async function deleteCurrentInstance(){
  try{
    const res=await authFetch('/api/instance/delete',{method:'DELETE'});
    const data=await res.json();
    if(data.success){document.getElementById('deleteInstanceModal')?.remove();showToast('Deletada!','success');await showWhatsAppPanel();}
    else showToast(data.error||'Erro','error');
  }catch(e){showToast('Erro ao deletar','error');}
}

async function loadQRCode(){
  try{
    const res=await authFetch('/api/whatsapp/qrcode');
    const data=await res.json();
    const c=document.getElementById('qrContainer');
    const s=document.getElementById('whatsappStatus');
    if(data.success&&data.data.connected){
      s.textContent='Conectado';
      c.innerHTML=`<svg viewBox="0 0 24 24" fill="var(--whatsapp-green)" width="80" height="80"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><h3 style="margin-top:20px;color:var(--whatsapp-green)">WhatsApp Conectado!</h3><p class="qr-instructions" style="margin-top:12px">Pronto para enviar.</p><button class="btn btn-danger" style="margin-top:20px" onclick="disconnectWhatsApp()">Desconectar</button>`;
      checkWhatsAppStatus();
    } else if(data.success&&data.data.qrCode){
      s.textContent='Aguardando escaneamento';
      // qrCode is a trusted base64 data URI from the UAZAPI server
      c.innerHTML=`<div class="qr-code"><img src="${data.data.qrCode}" alt="QR Code"></div>${data.data.pairingCode?`<p style="color:var(--whatsapp-text-secondary);margin-bottom:8px">Ou use o codigo:</p><div class="pairing-code">${escapeHtml(data.data.pairingCode)}</div>`:''}<p class="qr-instructions">Abra o WhatsApp, va em <strong>Dispositivos conectados</strong> e escaneie.</p><button class="btn btn-secondary" style="margin-top:20px" onclick="loadQRCode()">Atualizar QR Code</button>`;
      setTimeout(()=>{if(currentView==='whatsapp'){checkWhatsAppStatus();loadQRCode();}},30000);
    } else {
      s.textContent='Erro';
      c.innerHTML=`<h3 style="color:#ff6b6b">Erro ao conectar</h3><p class="qr-instructions" style="margin-top:12px">${escapeHtml(data.error||'Verifique a UAZAPI.')}</p><button class="btn btn-primary" style="margin-top:20px" onclick="loadQRCode()">Tentar Novamente</button>`;
    }
  }catch(e){
    const c=document.getElementById('qrContainer');
    c.innerHTML=`<h3 style="color:#ff6b6b">Erro de conexao</h3><p class="qr-instructions" style="margin-top:12px">Nao foi possivel conectar.</p><button class="btn btn-primary" style="margin-top:20px" onclick="loadQRCode()">Tentar Novamente</button>`;
  }
}

async function disconnectWhatsApp(){
  try{const res=await authFetch('/api/whatsapp/logout',{method:'POST'});const data=await res.json();if(data.success){showToast('Desconectado','success');checkWhatsAppStatus();loadQRCode();}}
  catch(e){showToast('Erro','error');}
}

async function selectSchedule(id){
  currentView='schedule';
  try{const res=await authFetch('/api/schedules/'+id);const data=await res.json();if(data.success){selectedSchedule=data.data;renderScheduleForm();renderScheduleList();}}
  catch(e){showToast('Erro ao carregar','error');}
}

function showNewSchedule(){
  currentView='schedule';
  selectedSchedule={id:null,name:'',message:'',groups:[],cron:'0 9 * * 1-5',cronParsed:{hours:'9',minutes:'0',days:[1,2,3,4,5]}};
  renderScheduleForm();renderScheduleList();
}

function renderScheduleForm(){
  const m=document.getElementById('mainContent');
  const s=selectedSchedule;
  const isNew=!s.id;
  if(!s.cronParsed){const p=s.cron.split(' ');s.cronParsed={minutes:p[0],hours:p[1],days:parseCronDays(p[4])};}

  let acts='';
  if(!isNew) acts=`<div class="header-actions"><button class="btn-icon" onclick="runScheduleNow('${escapeHtml(s.id)}')" title="Executar Agora"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button><button class="btn-icon" onclick="showDeleteModal('${escapeHtml(s.id)}')" title="Excluir" style="color:#ff6b6b"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button></div>`;

  let hOpts='',mOpts='';
  for(let i=0;i<24;i++) hOpts+=`<option value="${i}"${parseInt(s.cronParsed.hours)===i?' selected':''}>${String(i).padStart(2,'0')}</option>`;
  for(let i=0;i<60;i++) mOpts+=`<option value="${i}"${parseInt(s.cronParsed.minutes)===i?' selected':''}>${String(i).padStart(2,'0')}</option>`;

  const dayBtns=DAYS.map((d,i)=>`<button type="button" class="day-btn ${s.cronParsed.days.includes(i)?'active':''}" onclick="toggleDay(${i},this)">${d}</button>`).join('');
  const msgVal=s.message||s.messageTemplate||'';
  const stickerName=s.stickerPath?s.stickerPath.split('/').pop():'';

  m.innerHTML=`<div class="main-header"><div class="main-header-info"><div class="main-header-avatar">${escapeHtml(s.name?s.name.charAt(0).toUpperCase():'+')}</div><div class="main-header-text"><h2>${escapeHtml(isNew?'Novo Agendamento':s.name)}</h2><p>${isNew?'Configure os detalhes':'Editar agendamento'}</p></div></div>${acts}</div><div class="form-container"><div class="form-section"><div class="form-section-title">Informacoes</div><div class="form-group"><label class="form-label">Nome do Agendamento</label><input type="text" class="form-input" id="scheduleName" placeholder="Ex: Lembrete Diario" value="${escapeHtml(s.name||'')}"></div></div><div class="form-section"><div class="form-section-title">Figurinha (Sticker)</div><p style="font-size:13px;color:var(--whatsapp-text-secondary);margin-bottom:12px">Envia uma figurinha antes do texto (opcional). Arquivo .webp</p><div id="stickerPreview" style="margin-bottom:12px">${stickerName?'<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--whatsapp-input);border-radius:8px"><span style="font-size:14px">'+escapeHtml(stickerName)+'</span><button class="btn-remove" onclick="removeSticker()">x</button></div>':'<div style="padding:12px;text-align:center;color:var(--whatsapp-text-secondary);background:var(--whatsapp-input);border-radius:8px">Nenhuma figurinha</div>'}</div><div style="display:flex;gap:8px"><button class="btn-add-group" onclick="selectSticker()"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Escolher Sticker</button><label class="btn-add-group" style="cursor:pointer"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>Upload .webp<input type="file" accept=".webp" onchange="uploadSticker(this)" style="display:none"></label></div><input type="hidden" id="stickerPath" value="${escapeHtml(s.stickerPath||'')}"></div><div class="form-section"><div class="form-section-title">Mensagem</div><div class="form-group"><label class="form-label">Texto que sera enviado</label><textarea class="form-input" id="scheduleMessage" placeholder="Digite a mensagem...">${escapeHtml(msgVal)}</textarea></div></div><div class="form-section"><div class="form-section-title">Horario</div><div class="form-group"><label class="form-label">Hora do Envio</label><div class="time-picker"><select id="scheduleHour">${hOpts}</select><span class="time-separator">:</span><select id="scheduleMinute">${mOpts}</select></div></div><div class="form-group"><label class="form-label">Dias da Semana</label><div class="days-selector">${dayBtns}</div></div></div><div class="form-section"><div class="form-section-title">Grupos do WhatsApp</div><div class="groups-list" id="groupsList">${renderGroups(s)}</div><button class="btn-add-group" onclick="openGroupsSelector()" style="margin-top:12px"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>${whatsappConnected?'Selecionar Grupos':'Adicionar Grupo'}</button></div></div><div class="form-actions"><button class="btn btn-secondary" onclick="cancelEdit()">Cancelar</button><button class="btn" style="background:#ff9800;color:white" onclick="openTestModal()">Testar Envio</button><button class="btn btn-primary" onclick="saveSchedule()">${isNew?'Criar Agendamento':'Salvar'}</button></div>`;
}

function renderGroups(schedule){
  if(!schedule.groups||schedule.groups.length===0) return '<div style="padding:20px;text-align:center;color:var(--whatsapp-text-secondary);background:var(--whatsapp-input);border-radius:8px">Nenhum grupo selecionado</div>';
  return schedule.groups.map((gid,i)=>{
    const g=availableGroups.find(x=>x.id===gid);
    return `<div class="group-item"><div class="group-info"><div class="group-name">${escapeHtml(g?g.name:'Grupo '+(i+1))}</div><div class="group-id">${escapeHtml(gid)}</div></div><button class="btn-remove" onclick="removeGroup(${i})">x</button></div>`;
  }).join('');
}

async function selectSticker(){
  try{
    const res=await authFetch('/api/stickers');
    const data=await res.json();
    if(!data.success||data.data.length===0){showToast('Nenhum sticker disponivel. Faca upload primeiro.','error');return;}
    const modal=document.createElement('div');
    modal.className='modal-overlay active';modal.id='stickerModal';
    modal.innerHTML='<div class="modal"><div class="modal-header"><h3>Escolher Sticker</h3></div><div class="modal-body"><div class="groups-selector" id="stickerList">'+data.data.map(function(st){return '<div class="group-selector-item" onclick="pickSticker(\''+escapeHtml(st.path)+'\',\''+escapeHtml(st.name)+'\')"><div class="group-selector-info"><div class="group-selector-name">'+escapeHtml(st.name)+'</div></div></div>';}).join('')+'</div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'stickerModal\').remove()">Cancelar</button></div></div>';
    document.body.appendChild(modal);
  }catch(e){showToast('Erro ao carregar stickers','error');}
}

function pickSticker(stickerPath,name){
  document.getElementById('stickerPath').value=stickerPath;
  selectedSchedule.stickerPath=stickerPath;
  document.getElementById('stickerPreview').innerHTML='<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--whatsapp-input);border-radius:8px"><span style="font-size:14px">'+escapeHtml(name)+'</span><button class="btn-remove" onclick="removeSticker()">x</button></div>';
  var modal=document.getElementById('stickerModal');if(modal)modal.remove();
}

function removeSticker(){
  document.getElementById('stickerPath').value='';
  selectedSchedule.stickerPath='';
  document.getElementById('stickerPreview').innerHTML='<div style="padding:12px;text-align:center;color:var(--whatsapp-text-secondary);background:var(--whatsapp-input);border-radius:8px">Nenhuma figurinha</div>';
}

async function uploadSticker(input){
  const file=input.files[0];
  if(!file)return;
  if(!file.name.endsWith('.webp')){showToast('Apenas arquivos .webp','error');return;}
  const reader=new FileReader();
  reader.onload=async function(){
    const base64=reader.result.split(',')[1];
    const name=file.name.replace('.webp','').replace(/[^a-zA-Z0-9_-]/g,'');
    try{
      const res=await authFetch('/api/stickers/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,data:base64})});
      const data=await res.json();
      if(data.success){pickSticker(data.data.path,data.data.name);showToast('Sticker enviado!','success');}
      else showToast(data.error||'Erro','error');
    }catch(e){showToast('Erro ao enviar sticker','error');}
  };
  reader.readAsDataURL(file);
  input.value='';
}

function openTestModal(){
  const msg=document.getElementById('scheduleMessage');
  if(!msg||!msg.value){showToast('Digite uma mensagem','error');return;}
  if(!selectedSchedule.groups||selectedSchedule.groups.length===0){showToast('Selecione grupos','error');return;}
  document.getElementById('testModal').classList.add('active');
  document.getElementById('btnSendTest').style.display='inline-block';
  const opts=selectedSchedule.groups.map(g=>{const gr=availableGroups.find(x=>x.id===g);return `<option value="${escapeHtml(g)}">${escapeHtml(gr?gr.name:g)}</option>`;}).join('');
  document.getElementById('testModalBody').innerHTML=`<div style="margin-bottom:20px"><h4 style="margin-bottom:12px;color:var(--whatsapp-green)">Mensagem</h4><div style="background:var(--whatsapp-bubble-out);padding:12px 16px;border-radius:8px;white-space:pre-wrap;line-height:1.5">${escapeHtml(msg.value)}</div></div><div><h4 style="margin-bottom:12px;color:var(--whatsapp-green)">Enviar para</h4><select id="testGroupSelect" class="form-input">${opts}</select></div>`;
}

function closeTestModal(){document.getElementById('testModal').classList.remove('active');document.getElementById('btnSendTest').style.display='none';}

async function sendTest(){
  const gs=document.getElementById('testGroupSelect');
  const msg=document.getElementById('scheduleMessage');
  if(!gs||!msg||!msg.value){showToast('Dados incompletos','error');return;}
  const btn=document.getElementById('btnSendTest');
  btn.disabled=true;btn.textContent='Enviando...';
  try{
    const res=await authFetch('/api/test/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId:gs.value,message:msg.value,stickerPath:document.getElementById('stickerPath')?.value||undefined})});
    const data=await res.json();
    if(data.success){showToast('Teste enviado!','success');closeTestModal();}
    else showToast(data.error||'Erro','error');
  }catch(e){showToast('Erro ao enviar','error');}
  finally{btn.disabled=false;btn.textContent='Enviar Teste';}
}

async function openGroupsSelector(){
  if(!whatsappConnected){
    const gid=prompt('Digite o ID do grupo (ex: 5511999999999@g.us):');
    if(gid){if(!selectedSchedule.groups)selectedSchedule.groups=[];if(!selectedSchedule.groups.includes(gid)){selectedSchedule.groups.push(gid);renderScheduleForm();}}
    return;
  }
  document.getElementById('groupsModal').classList.add('active');
  selectedGroups=selectedSchedule.groups?selectedSchedule.groups.slice():[];
  try{
    const res=await authFetch('/api/whatsapp/groups');const data=await res.json();
    if(data.success){availableGroups=data.data;renderGroupsSelector();}
    else document.getElementById('groupsSelector').textContent=data.error||'Erro';
  }catch(e){document.getElementById('groupsSelector').textContent='Erro ao carregar grupos';}
}

function renderGroupsSelector(){
  const c=document.getElementById('groupsSelector');
  if(availableGroups.length===0){c.textContent='Nenhum grupo encontrado';return;}
  c.innerHTML=availableGroups.map(g=>{
    const sel=selectedGroups.includes(g.id);
    return `<div class="group-selector-item ${sel?'selected':''}" onclick="toggleGroupSelection('${escapeHtml(g.id)}')"><input type="checkbox" ${sel?'checked':''}><div class="group-selector-info"><div class="group-selector-name">${escapeHtml(g.name)}</div><div class="group-selector-members">${g.size||0} participantes</div></div></div>`;
  }).join('');
}

function toggleGroupSelection(gid){const i=selectedGroups.indexOf(gid);if(i>-1)selectedGroups.splice(i,1);else selectedGroups.push(gid);renderGroupsSelector();}
function confirmGroupsSelection(){selectedSchedule.groups=selectedGroups.slice();closeGroupsModal();renderScheduleForm();}
function closeGroupsModal(){document.getElementById('groupsModal').classList.remove('active');}

function parseCronDays(s){
  if(s==='*')return[0,1,2,3,4,5,6];
  if(s.includes('-')){const p=s.split('-').map(Number);const d=[];for(let i=p[0];i<=p[1];i++)d.push(i);return d;}
  if(s.includes(','))return s.split(',').map(Number);
  return[parseInt(s)];
}

function toggleDay(day,btn){btn.classList.toggle('active');}
function removeGroup(i){selectedSchedule.groups.splice(i,1);renderScheduleForm();}

async function saveSchedule(){
  const name=document.getElementById('scheduleName').value;
  const message=document.getElementById('scheduleMessage').value;
  const hours=document.getElementById('scheduleHour').value;
  const minutes=document.getElementById('scheduleMinute').value;
  const dBtns=document.querySelectorAll('.day-btn.active');
  const days=Array.from(dBtns).map(b=>DAYS.indexOf(b.textContent.trim()));
  if(!name||!message||selectedSchedule.groups.length===0||days.length===0){showToast('Preencha todos os campos','error');return;}
  try{
    const isNew=!selectedSchedule.id;
    const url=isNew?'/api/schedules':'/api/schedules/'+selectedSchedule.id;
    const res=await authFetch(url,{method:isNew?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,message,groups:selectedSchedule.groups,hours,minutes,days,stickerPath:document.getElementById('stickerPath')?.value||undefined})});
    const data=await res.json();
    if(data.success){showToast(isNew?'Criado!':'Atualizado!','success');await loadSchedules();selectSchedule(data.data.id);}
    else showToast(data.error||'Erro','error');
  }catch(e){showToast('Erro ao salvar','error');}
}

function cancelEdit(){
  selectedSchedule=null;
  document.getElementById('mainContent').innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg><h3>My</h3><p>Selecione um agendamento ou crie um novo</p><button class="btn btn-primary" onclick="showNewSchedule()">Criar Agendamento</button></div>`;
  renderScheduleList();
}

async function runScheduleNow(id){
  try{const res=await authFetch('/api/schedules/'+id+'/run',{method:'POST'});const data=await res.json();if(data.success)showToast('Execucao iniciada!','success');else showToast(data.error||'Erro','error');}
  catch(e){showToast('Erro','error');}
}

function showDeleteModal(id){deleteScheduleId=id;document.getElementById('deleteModal').classList.add('active');}
function closeDeleteModal(){deleteScheduleId=null;document.getElementById('deleteModal').classList.remove('active');}

async function confirmDelete(){
  if(!deleteScheduleId)return;
  try{const res=await authFetch('/api/schedules/'+deleteScheduleId,{method:'DELETE'});const data=await res.json();if(data.success){showToast('Excluido!','success');closeDeleteModal();selectedSchedule=null;await loadSchedules();cancelEdit();}else showToast(data.error||'Erro','error');}
  catch(e){showToast('Erro','error');}
}

async function toggleScheduler(){
  try{const ep=schedulerRunning?'/api/scheduler/stop':'/api/scheduler/start';const res=await authFetch(ep,{method:'POST'});const data=await res.json();if(data.success){schedulerRunning=!schedulerRunning;updateSchedulerButton();showToast(schedulerRunning?'Scheduler iniciado!':'Scheduler parado!','success');}}
  catch(e){showToast('Erro','error');}
}

function updateSchedulerButton(){
  const b=document.getElementById('schedulerToggle');
  if(schedulerRunning){b.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>';b.style.color='var(--whatsapp-green)';b.title='Parar Scheduler';}
  else{b.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';b.style.color='';b.title='Iniciar Scheduler';}
}

function showToast(msg,type){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.className='toast '+(type||'success')+' show';
  setTimeout(()=>t.classList.remove('show'),3000);
}

function initApp(){
  loadSchedules();checkSchedulerStatus();checkWhatsAppStatus();
  setInterval(checkSchedulerStatus,10000);
  setInterval(checkWhatsAppStatus,15000);
}

document.addEventListener('DOMContentLoaded',()=>{
  if(getToken()){
    showApp();
    initApp();
  } else {
    showLogin();
  }
});
