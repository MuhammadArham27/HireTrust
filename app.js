const app=document.getElementById("app");
let mediaStream=null;
let verificationAudioStream=null;
let verificationAudioMeterFrame=null;
const state={
  page:"login",loggedIn:false,user:null,interviewStarted:false,interviewLocked:false,warnings:0,
  interviewerSession:null,interviewerTimer:null,liveClockTimer:null,candidateStream:null,decision:null,
  interviewerEvents:[],roomViews:{},roomCamera:null,roomHashes:[],dashboardSessions:[],audioConsent:false,audioRecorder:null,audioChunks:[],voiceTimer:null,sessionStartedAt:null,violationCount:0,
peer:null,signalTimer:null,signalRole:null,receivedSignals:new Set(),silentSeconds:0,lastVoiceAlertAt:0,assignedInterviewer:null, selfiePhoto:null, idFileName:'', faceMatchScore:null, faceMatchStatus:'Not checked', idDocumentData:null, verificationStarted:false, candidateAudioLevel:0, interviewerAudioLevel:0, audioMeterTimer:null, remoteAudioContext:null, localAudioContext:null, eyeMonitor:null, eyeAwaySince:0, lastEyeAlertAt:0, phoneHeartbeatTimer:null, phoneRisk:'Unknown', monitorEventTimer:null,feedbackRating:0, pending2fa:null, connectionTimer:null, chatTimer:null, chatSeen:new Set(), audioMeters:{}, remoteAudioStreams:[]
};

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v||'').trim());}
function ageFromDob(dob){const d=new Date(`${dob}T00:00:00`);if(Number.isNaN(d.getTime()))return null;const n=new Date();let a=n.getFullYear()-d.getFullYear();const m=n.getMonth()-d.getMonth();if(m<0||(m===0&&n.getDate()<d.getDate()))a--;return a;}
function formatAppDate(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(d)+' IST';}
async function api(path,options={}){
  let r;
  try{
    r=await fetch(path,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  }catch(e){
    throw new Error(e?.message==='Failed to fetch'?'Cannot connect to HireTrust server. Confirm that npm start is running and that this page was opened from http://localhost:8000 (not from a file).':(e?.message||'Network request failed.'));
  }
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||`Request failed (${r.status})`);
  return d;
}
async function sendMonitorEvent(type, details={}, severity='Warning'){
  if(!state.sessionId)return;
  try{await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/monitor-event`,{method:'POST',body:JSON.stringify({type,details,severity})});}catch(e){console.warn('monitor event',e);}
}
async function startPhonePresenceMonitor(){
  if(!state.sessionId)return;
  try{
    const d=await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/phone-status`);
    const phones=Array.isArray(d.devices)?d.devices:[];
    const risk=phones.length?'Phone companion detected on network':'No companion phone verified';
    state.phoneRisk=risk;
    const el=document.getElementById('phoneStatus');
    if(el){el.textContent=phones.length?`${phones.length} phone(s) detected`:'No phone verified';el.className=phones.length?'badge warning':'badge ready';}
  }catch(e){}
  clearInterval(state.phoneHeartbeatTimer);
  state.phoneHeartbeatTimer=setInterval(async()=>{
    try{const d=await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/phone-status`);const phones=d.devices||[];const el=document.getElementById('phoneStatus');if(el){el.textContent=phones.length?`${phones.length} phone(s) detected`:'No phone verified';el.className=phones.length?'badge warning':'badge ready';}if(phones.length)await sendMonitorEvent('Nearby phone/network companion detected',{count:phones.length},'Warning');}catch(e){}
  },5000);
}
function stopPhonePresenceMonitor(){clearInterval(state.phoneHeartbeatTimer);state.phoneHeartbeatTimer=null;}

function routeLoader(show=true){const l=document.getElementById('htRouteLoader');if(!l)return;if(show){l.classList.add('show');l.setAttribute('aria-hidden','false')}else{l.classList.remove('show');l.setAttribute('aria-hidden','true')}}

function toast(msg){
  const text=String(msg||'');
  let type='info';
  if(/\b(success|saved|recorded|captured|complete|completed|passed|active)\b/i.test(text)) type='success';
  if(/\b(warning|warn|please|attention|invalid|blocked|required|silence|looking away)\b/i.test(text)) type='warning';
  if(/\b(error|failed|terminated|cannot|could not|denied|unavailable|rejected)\b/i.test(text)) type='danger';
  const titles={info:'Notification',success:'Success',warning:'Attention',danger:'Action required'};
  const icons={info:'i',success:'✓',warning:'!',danger:'×'};
  let t=document.querySelector('.toast.notification-bar');
  if(!t){
    t=document.createElement('div');
    t.className='toast notification-bar';
    document.body.appendChild(t);
  }
  t.className=`toast notification-bar is-${type}`;
  t.innerHTML=`<div class="toast-icon" aria-hidden="true"><img src="assets/hiretrust-logo.png" alt="HireTrust"></div><div class="toast-content"><div class="toast-title">${titles[type]}</div><div class="toast-message">${esc(text)}</div></div><button class="toast-close" type="button" aria-label="Dismiss notification">×</button>`;
  t.querySelector('.toast-close').onclick=()=>t.classList.remove('show');
  clearTimeout(window.__htToastTimer);
  requestAnimationFrame(()=>t.classList.add('show'));
  window.__htToastTimer=setTimeout(()=>t.classList.remove('show'),4200);
}

function startHireTrustMotion(){
  const appRoot=document.getElementById('app');
  if(!appRoot||appRoot.__htMotionReady)return;
  appRoot.__htMotionReady=true;
  const animate=()=>{
    const root=appRoot.firstElementChild;
    if(!root)return;
    root.classList.remove('ht-page-enter');
    void root.offsetWidth;
    root.classList.add('ht-page-enter');
  };
  new MutationObserver(animate).observe(appRoot,{childList:true});
}
startHireTrustMotion();

function setCandidateLock(){
  history.pushState({candidate:true},"","#candidate");
  window.onpopstate=()=>{history.pushState({candidate:true},"","#candidate");toast("Candidate sessions cannot return to the home page.");};
}
function clearCandidateLock(){window.onpopstate=null;}

function shell(content){
  clearCandidateLock();
  app.innerHTML=`<div class="app"><header class="topbar"><div class="brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><span>Hire<span>Trust</span></span></div><div class="top-actions"><span class="portal-pill"><span class="portal-dot"></span>Interviewer Portal</span><div class="avatar">${esc((state.user?.name||"I")[0].toUpperCase())}</div></div></header><div class="layout"><aside class="sidebar"><div class="sidebar-context"><span class="context-dot"></span><div><b>Interviewer workspace</b><small>Secure session environment</small></div></div><nav class="nav">
  <div class="nav-group"><span class="nav-group-label">WORKSPACE</span>
    <button type="button" class="nav-btn ${state.page==="dashboard"?"active":""}" data-nav="dashboard"><span class="nav-icon">▦</span>Dashboard</button>
    <button type="button" class="nav-btn ${state.page==="operations"?"active":""}" data-nav="operations"><span class="nav-icon">◫</span>Operations Center</button>
    <button type="button" class="nav-btn ${state.page==="schedule"?"active":""}" data-nav="schedule"><span class="nav-icon">◷</span>Schedule</button>
    <button type="button" class="nav-btn ${state.page==="sessions"?"active":""}" data-nav="sessions"><span class="nav-icon">◉</span>Interview Sessions</button>
  </div>
  <div class="nav-group"><span class="nav-group-label">TALENT</span>
    <button type="button" class="nav-btn ${state.page==="candidates"?"active":""}" data-nav="candidates"><span class="nav-icon">♙</span>Candidates</button>
    <button type="button" class="nav-btn ${state.page==="questions"?"active":""}" data-nav="questions"><span class="nav-icon">☷</span>Question Bank</button>
    <button type="button" class="nav-btn ${state.page==="feedback"?"active":""}" data-nav="feedback"><span class="nav-icon">✦</span>Candidate Feedback</button>
  </div>
  <div class="nav-group"><span class="nav-group-label">INSIGHTS</span>
    <button type="button" class="nav-btn ${state.page==="analytics"?"active":""}" data-nav="analytics"><span class="nav-icon">▥</span>Analytics</button>
    <button type="button" class="nav-btn ${state.page==="evaluations"?"active":""}" data-nav="evaluations"><span class="nav-icon">✓</span>Evaluations</button>
    <button type="button" class="nav-btn ${state.page==="ai"?"active":""}" data-nav="ai"><span class="nav-icon">◇</span>AI Insights</button>
    <button type="button" class="nav-btn ${state.page==="notifications"?"active":""}" data-nav="notifications"><span class="nav-icon">◌</span>Notifications</button>
  </div>
  <div class="nav-group"><span class="nav-group-label">SECURITY & LOGS</span>
    <button type="button" class="nav-btn ${state.page==="security"?"active":""}" data-nav="security"><span class="nav-icon">◇</span>Security Center</button>
    <button type="button" class="nav-btn ${state.page==="audit"?"active":""}" data-nav="audit"><span class="nav-icon">≡</span>Audit Logs</button>
    <button type="button" class="nav-btn ${state.page==="timing"?"active":""}" data-nav="timing"><span class="nav-icon">◴</span>Timing Log</button>
  </div>
  <div class="nav-group"><span class="nav-group-label">ACCOUNT</span>
    <button type="button" class="nav-btn ${state.page==="profile"?"active":""}" data-nav="profile"><span class="nav-icon">○</span>Profile</button>
    <button type="button" class="nav-btn ${state.page==="settings"?"active":""}" data-nav="settings"><span class="nav-icon">⚙</span>Settings</button>
    ${state.user?.role==='admin'?`<button type="button" class="nav-btn ${state.page==="admin"?"active":""}" data-nav="admin"><span class="nav-icon">▣</span>Admin Console</button>`:''}
  </div>
  <div class="nav-footer"><button type="button" class="nav-btn signout-btn" data-action="signout"><span class="nav-icon">↪</span>Sign Out</button></div>
 </nav></aside><main class="main">${content}</main></div></div>`;
  app.querySelectorAll("[data-nav]").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.nav)));
  const signout=app.querySelector("[data-action=signout]"); if(signout) signout.addEventListener("click",interviewerLogout);
}

function togglePassword(inputId, button){
  const input=document.getElementById(inputId);
  if(!input)return;
  const showing=input.type==='text';
  input.type=showing?'password':'text';
  button.textContent=showing?'👁':'🙈';
  button.setAttribute('aria-label',showing?'Show password':'Hide password');
  button.title=showing?'Show password':'Hide password';
}
function passwordInput(id, placeholder, autocomplete='current-password'){
  return `<div class="password-input-wrap"><input id="${id}" type="password" required autocomplete="${autocomplete}" placeholder="${placeholder}"><button type="button" class="password-toggle" onclick="togglePassword('${id}',this)" aria-label="Show password" title="Show password">👁</button></div>`;
}

function interviewerLogin(){
  clearCandidateLock();
  app.innerHTML=`<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><span>Hire<span>Trust</span></span></div><h1>Interviewer Login</h1><p class="muted">Sign in with your registered email or phone, User ID and password.</p><form onsubmit="event.preventDefault();doLogin('interviewer')">
  <div class="field"><label>Email or Phone Number</label><input id="loginEmail" placeholder="interviewer@example.com or +919876543210"></div>
  <div class="field"><label>User ID</label><input id="loginId" required placeholder="INT-1001"></div>
  <div class="field"><label>Password</label>${passwordInput('loginPassword','••••••••')}</div>
  
  <button class="btn primary" style="width:100%;margin-top:8px">Login</button></form>
  <div style="display:flex;justify-content:flex-end;margin-top:10px"><button type="button" class="link-btn" onclick="forgotPasswordPage('interviewer')">Forgot password?</button></div>
  <div id="loginMsg" class="notice" style="display:none"></div>
  <div class="auth-links"><button class="link-btn" onclick="signupPage()">Create an account</button><button class="link-btn" onclick="candidateLogin()">Candidate Login</button></div>
 </div></div>`;
}

function forgotPasswordPage(role='interviewer'){
  clearCandidateLock();
  app.innerHTML=`<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><span>Hire<span>Trust</span></span></div><h1>Forgot Password</h1><p class="muted">Enter the Gmail/email address registered with your HireTrust account. We will send a secure password-reset link.</p><form onsubmit="event.preventDefault();requestPasswordReset()"><div class="field"><label>Registered Email Address</label><input id="resetEmail" type="email" required placeholder="you@gmail.com"></div><button class="btn primary" style="width:100%;margin-top:8px">Send Reset Link</button></form><div id="resetRequestMsg" class="notice" style="display:none;margin-top:12px"></div><div class="helper-note" style="margin-top:14px">If the email is not registered, HireTrust will tell you to create an account. For a registered email, the reset link is sent from the sender account configured in Interviewer → Settings → Email Settings.</div><div class="auth-links"><button class="link-btn" onclick="${role==='candidate'?'candidateLogin()':'interviewerLogin()'}">Back to Login</button></div></div></div>`;
}
async function requestPasswordReset(){
  const msg=document.getElementById('resetRequestMsg');
  try{
    const email=document.getElementById('resetEmail').value.trim().toLowerCase();
    if(!validEmail(email))throw new Error('Enter a valid email address.');
    const d=await api('/api/forgot-password',{method:'POST',body:JSON.stringify({email})});
    if(msg){msg.style.display='block';msg.className='notice success-notice';msg.textContent=d.message||'Password reset link sent. Check your inbox and spam folder.';}
    toast(d.message||'Password reset link sent.','success');
  }catch(e){
    if(msg){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}
    toast(e.message,'warning');
  }
}
function resetPasswordPage(token){
  clearCandidateLock();
  if(!token){interviewerLogin();toast('Password reset link is missing or invalid.','danger');return;}
  app.innerHTML=`<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><span>Hire<span>Trust</span></span></div><h1>Change Password</h1><p class="muted">Create a new password for your HireTrust account.</p><form onsubmit="event.preventDefault();submitPasswordReset()"><div class="field"><label>New Password</label>${passwordInput('newResetPassword','At least 6 characters + 1 special character','new-password')}</div><div class="field"><label>Confirm New Password</label>${passwordInput('confirmResetPassword','Re-enter your new password','new-password')}</div><div class="password-hint">Password must contain at least 6 characters and one special character.</div><button class="btn primary" style="width:100%;margin-top:8px">Change Password</button></form><div id="resetPasswordMsg" class="notice" style="display:none;margin-top:12px"></div><div class="auth-links"><button class="link-btn" onclick="interviewerLogin()">Back to Login</button></div></div></div>`;
  window.__hireTrustResetToken=token;
}
async function submitPasswordReset(){
  const msg=document.getElementById('resetPasswordMsg');
  const password=document.getElementById('newResetPassword').value;
  const confirm=document.getElementById('confirmResetPassword').value;
  try{
    if(password!==confirm)throw new Error('The passwords do not match.');
    if(!/(?=.*[^A-Za-z0-9]).{6,}/.test(password))throw new Error('Password must be at least 6 characters and contain one special character.');
    const d=await api('/api/reset-password',{method:'POST',body:JSON.stringify({token:window.__hireTrustResetToken,password})});
    if(msg){msg.style.display='block';msg.className='notice success-notice';msg.textContent=d.message;document.querySelectorAll('#newResetPassword,#confirmResetPassword').forEach(x=>x.disabled=true);}
    setTimeout(()=>interviewerLogin(),1400);
  }catch(e){if(msg){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}}
}

function signupPage(){
  clearCandidateLock();
  app.innerHTML=`<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><span>Hire<span>Trust</span></span></div><h1>Create Account</h1><p class="muted">Create a candidate or interviewer account. No OTP or email verification is required.</p><form onsubmit="event.preventDefault();doSignup()">
  <div class="field"><label>Full Name</label><input id="signupName" required placeholder="Your real name or display name"></div>
  <div class="field"><label>Email Address <span class="muted">(required if no phone)</span></label><input id="signupEmail" type="email" placeholder="you@example.com"></div>
  <div class="field"><label>Phone Number <span class="muted">(required if no email)</span></label><input id="signupPhone" type="tel" placeholder="+919876543210"></div>
  <div class="field"><label>Username / User ID</label><input id="signupId" required placeholder="CAND-1001 or INT-1001"></div>
  <div class="field"><label>Password</label>${passwordInput('signupPassword','At least 6 characters + 1 special character','new-password')}</div>
  <div class="field"><label>Date of Birth <span class="muted">(age must be 22+)</span></label><input id="signupDob" type="date" max="2004-08-23" required></div>
  <div class="field"><label>Role</label><select id="signupRole"><option value="candidate">Candidate</option><option value="interviewer">Interviewer</option></select></div>
  <div class="field"><label>Present Photo <span class="muted">(required)</span></label><input id="signupProfilePic" type="file" accept="image/jpeg,image/png" required><div class="muted" style="margin-top:6px">Upload a recent JPG/JPEG or PNG photo of yourself.</div></div>
  <label class="status-row" style="margin:10px 0"><span>Contact Syncing <span class="muted">(optional permission)</span></span><input id="signupContactSync" type="checkbox"></label>
  <div class="password-hint">Password must contain at least 6 characters and one special character.</div>
  <button class="btn primary" style="width:100%;margin-top:8px">Create Account</button></form>
  <div id="signupMsg" class="notice" style="display:none"></div>
  <div class="auth-links"><button class="link-btn" onclick="interviewerLogin()">Interviewer Login</button><button class="link-btn" onclick="candidateLogin()">Candidate Login</button></div>
 </div></div>`;
}

async function doSignup(){
  const msg=document.getElementById("signupMsg");
  try{
    const email=document.getElementById('signupEmail').value.trim();
    const phone=document.getElementById('signupPhone').value.trim();
    const isEmail=!!email && validEmail(email);
    const isPhone=!!phone && /^\+[1-9]\d{7,14}$/.test(phone);
    if(!isEmail && !isPhone){toast('Enter a valid email address or an international phone number. At least one is required.','warning');return;}
    if(email && !isEmail){toast('Please enter a valid email address.','warning');return;}
    if(phone && !isPhone){toast('Please enter a valid international phone number, e.g. +919876543210.','warning');return;}
    const age=ageFromDob(document.getElementById('signupDob').value);
    if(age===null || age<=21){toast('HireTrust is available only to people older than 21 years. Your age must be 22 or above.','warning');return;}
    if(!/(?=.*[^A-Za-z0-9]).{6,}/.test(signupPassword.value)){toast('Password must be at least 6 characters and contain one special character.','warning');return;}
    const picFile=document.getElementById('signupProfilePic').files[0];
    if(!picFile){toast('Present photo is required for account creation.','warning');return;}
    if(!['image/jpeg','image/png'].includes(picFile.type)){toast('Present photo must be JPG/JPEG or PNG.','warning');return;}
    let profilePic=null;
    if(picFile){
      if(!['image/jpeg','image/png'].includes(picFile.type)){toast('Profile picture must be JPG/JPEG or PNG.','warning');return;}
      profilePic=await prepareProfilePhoto(picFile);
    }
    const payload={name:signupName.value, email:isEmail?email:'', phone:isPhone?phone:'', userId:signupId.value, role:signupRole.value, password:signupPassword.value, dob:signupDob.value, profilePic, contactSync:document.getElementById('signupContactSync').checked};
    const d=await api("/api/signup",{method:"POST",body:JSON.stringify(payload)});
    toast(d.message||"Account created successfully. You can log in now.",'success');
  }catch(e){
    const message=e?.message==='Failed to fetch'
      ? 'HireTrust could not reach the server. Make sure npm start is still running in this project folder, then try again.'
      : e.message;
    toast(message,'danger');
  }
}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
async function prepareProfilePhoto(file){
  const maxDimension=1280;
  const dataUrl=await fileToDataUrl(file);
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=dataUrl;});
    const scale=Math.min(1,maxDimension/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    canvas.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const compressed=canvas.toDataURL('image/jpeg',0.82);
    if(compressed.length>1_700_000) return canvas.toDataURL('image/jpeg',0.68);
    return compressed;
  }catch(e){
    if(dataUrl.length>1_700_000) throw new Error('The selected photo is too large. Please choose a smaller JPG or PNG image.');
    return dataUrl;
  }
}

async function doLogin(role){
  const msg=document.getElementById("loginMsg");
  try{
    const contact=loginEmail.value.trim();
    const body={password:loginPassword.value,userId:loginId.value,role};
    if(validEmail(contact))body.email=contact; else if(/^\+[1-9]\d{7,14}$/.test(contact))body.phone=contact; else throw new Error("Enter a valid email address or international phone number.");
    const d=await api("/api/login",{method:"POST",body:JSON.stringify(body)});
    if(d.requiresTwoFactor){ state.pending2fa={challengeId:d.challengeId,user:d.user,role}; twoFactorPage(); return; }
    state.loggedIn=true;state.user=d.user;state.page="dashboard";d.user.role==='admin'?adminConsole():dashboard();toast(`Welcome, ${d.user.name}`);
  }catch(e){toast(e.message,'danger');}
}
function interviewerLogout(){state.loggedIn=false;state.user=null;state.page="login";interviewerLogin();}


async function dashboard(){
  clearInterval(state.liveClockTimer);
  state.page="dashboard";
  let sessionsData=[];try{const d=await api('/api/sessions');sessionsData=d.sessions||[];}catch(e){}
  state.dashboardSessions=sessionsData;
  const active=sessionsData.filter(s=>['Interview In Progress','Ready','Warning Issued'].includes(s.status)).length;
  const ended=sessionsData.filter(s=>s.endedAt||['Completed','Passed','Failed','Rejected','Terminated'].includes(s.status)).length;
  shell(`<div class="page-title"><div><div class="eyebrow">INTERVIEW OPERATIONS</div><h1>Interview Verification Dashboard</h1><div class="muted">Monitor interview integrity, candidate outcomes and verification activity.</div></div><div class="dashboard-search"><span>⌕</span><input id="dashboardSearch" placeholder="Search candidates, username, email, phone or session…" oninput="filterDashboardSessions()"></div><div id="dashboardPeopleResults" class="dashboard-people-results" style="display:none"></div></div>
  <section class="panel project-overview"><div><div class="eyebrow">ABOUT HIRETRUST</div><h2>AI-assisted interview verification</h2><p>HireTrust combines candidate identity verification, room checks, audio monitoring, camera presence, full-screen controls, interview scheduling and audit trails in one workspace. AI features are advisory and keep the final interview decision with the interviewer.</p></div><div class="overview-points"><span>Identity</span><span>Audio</span><span>Room</span><span>Device</span><span>AI Insights</span></div></section>
  <div class="cards"><div class="card"><div class="label">Active Interviews</div><div class="metric">${active}</div></div><div class="card"><div class="label">Completed / Ended</div><div class="metric">${ended}</div></div><div class="card live-summary-card warning-summary"><div class="label">Warnings</div><div class="metric">${sessionsData.reduce((n,x)=>n+Number(x.warnings||0),0)}</div></div><div class="card"><div class="label">Passed</div><div class="metric">${sessionsData.filter(s=>s.decision==='Passed').length}</div></div><div class="card"><div class="label">Needs Review</div><div class="metric">${sessionsData.filter(s=>s.decision==='Review'||s.status==='Completed'&&!s.decision).length}</div></div></div>
  ${aiAssistant()}
  <section class="panel"><div class="section-head"><div><h2>Candidate Interview History</h2><span class="muted">Open a candidate's evaluation directly from the interviewer workspace.</span></div><button class="btn secondary" onclick="evaluationsPage()">View all evaluations</button></div><div style="overflow:auto"><table class="table professional-table"><thead><tr><th>Candidate</th><th>Username</th><th>Email</th><th>Session</th><th>Started</th><th>Ended</th><th>Status</th><th>Result</th><th>Evaluation</th><th>Action</th></tr></thead><tbody id="dashboardSessionRows">${renderDashboardRows(sessionsData)}</tbody></table></div></section>`);
}
function evaluationMeta(review){
  const r=review||{};
  const vals=['technical','communication','problemSolving','roleKnowledge'].map(k=>Number(r[k])).filter(n=>Number.isFinite(n)&&n>0);
  return {avg:vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1):null,count:vals.length};
}
function renderDashboardRows(sessionsData){
  if(!sessionsData.length)return '<tr><td colspan="10" class="muted">No candidate sessions have been recorded yet.</td></tr>';
  return sessionsData.slice().reverse().map(s=>{
    const meta=evaluationMeta(s.interviewerReview);
    const evalHtml=meta.avg?`<button class="evaluation-inline" type="button" onclick="showEvaluation('${esc(s.id)}')"><strong>${meta.avg}/5</strong><span>View evaluation</span></button>`:`<button class="evaluation-inline empty" type="button" onclick="showEvaluation('${esc(s.id)}')"><strong>Not rated</strong><span>View / add</span></button>`;
    const candidate=encodeURIComponent(String(s.candidateName||''));
    return `<tr data-search="${esc(`${s.candidateName||''} ${s.candidateId||''} ${s.candidateEmail||''} ${s.candidatePhone||''} ${s.id||''}`).toLowerCase()}"><td>${esc(s.candidateName||'—')}</td><td>${esc(s.candidateId||'—')}</td><td>${esc(s.candidateEmail||'—')}</td><td>${esc(s.id)}</td><td>${s.startedAt?formatAppDate(s.startedAt):'—'}</td><td>${s.endedAt?formatAppDate(s.endedAt):'—'}</td><td><span class="badge ${['Completed','Passed'].includes(s.status)?'ready':(['Failed','Rejected','Terminated'].includes(s.status)?'rejected':s.status==='Warning Issued'?'warning':'pending')}">${esc(s.status||'Unknown')}</span></td><td><span class="badge ${s.decision==='Passed'?'ready':s.decision==='Failed'||s.decision==='Rejected'?'rejected':s.decision?'warning':'pending'}">${esc(s.decision||'Pending')}</span></td><td>${evalHtml}</td><td><button class="btn secondary" onclick="viewSession(decodeURIComponent('${candidate}'))">Open interview</button></td></tr>`;
  }).join('');
}
function showEvaluation(sessionId){
  const local=(state.dashboardSessions||[]).find(x=>String(x.id)===String(sessionId));
  if(local){openEvaluationModal(local);return;}
  api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=interviewer`).then(d=>{const s=(d.sessions||[]).find(x=>String(x.id)===String(sessionId));if(s)openEvaluationModal(s);else toast('Interview session not found.','danger');}).catch(e=>toast(e.message,'danger'));
}
function openEvaluationModal(s){
  const r=s.interviewerReview||{};
  const items=[['Technical knowledge',r.technical],['Communication',r.communication],['Problem solving',r.problemSolving],['Role knowledge',r.roleKnowledge]];
  const rated=items.map(x=>Number(x[1])).filter(n=>Number.isFinite(n)&&n>0);
  const avg=rated.length?(rated.reduce((a,b)=>a+b,0)/rated.length).toFixed(1):'—';
  const existing=document.getElementById('evaluationModal');if(existing)existing.remove();
  const candidate=encodeURIComponent(String(s.candidateName||''));
  const html=`<div class="evaluation-modal-overlay" id="evaluationModal" role="dialog" aria-modal="true" aria-label="Candidate evaluation"><div class="evaluation-modal"><div class="evaluation-modal-head"><div><div class="eyebrow">INTERVIEW EVALUATION</div><h2>${esc(s.candidateName||'Candidate')}</h2><div class="muted">${esc(s.candidateId||'—')} · Session ${esc(s.id||'—')}</div></div><button class="icon-btn" type="button" onclick="closeEvaluation()">×</button></div><div class="evaluation-overview"><div><span class="label">Overall rating</span><strong>${avg}<small>/5</small></strong></div><div><span class="label">Decision</span><span class="badge ${s.decision==='Passed'?'ready':s.decision==='Failed'||s.decision==='Rejected'?'rejected':s.decision?'warning':'pending'}">${esc(s.decision||'Pending')}</span></div><div><span class="label">Last updated</span><b>${r.updatedAt?esc(formatAppDate(r.updatedAt)):'Not saved yet'}</b></div></div><div class="evaluation-score-grid">${items.map(([label,val])=>`<div class="evaluation-score-card"><span>${label}</span><strong>${val?esc(String(val))+' / 5':'Not rated'}</strong></div>`).join('')}</div><section class="evaluation-notes"><div class="detail-label">Interviewer notes</div><div class="evaluation-notes-body">${r.notes?esc(r.notes):'<span class="muted">No interviewer notes have been recorded for this candidate.</span>'}</div></section><div class="evaluation-modal-meta"><span>Reviewer: <b>${esc(r.reviewerName||'Not recorded')}</b></span><span>Review status: <b>${rated.length?'Completed':'Pending'}</b></span></div><div class="evaluation-modal-actions"><button class="btn secondary" onclick="closeEvaluation()">Close</button><button class="btn primary" onclick="closeEvaluation();viewSession(decodeURIComponent('${candidate}'))">Open interview</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);document.body.classList.add('modal-open');
  document.getElementById('evaluationModal').addEventListener('click',e=>{if(e.target.id==='evaluationModal')closeEvaluation();});
}
function closeEvaluation(){const el=document.getElementById('evaluationModal');if(el)el.remove();document.body.classList.remove('modal-open');}

let dashboardSearchTimer=null;
function showCandidateDetails(session){
  const s=session||{};
  const verification=s.faceMatchStatus||'Pending';
  const status=s.status||'Not Started';
  const result=s.decision||'Pending';
  const badge=(value,kind)=>`<span class="badge ${kind}">${esc(value)}</span>`;
  const statusKind=['Failed','Rejected','Terminated'].includes(status)?'rejected':status==='Warning Issued'?'warning':'ready';
  const resultKind=result==='Passed'?'ready':['Failed','Rejected'].includes(result)?'rejected':result==='Pending'?'pending':'warning';
  const verifyKind=verification==='Verified'?'ready':'pending';
  const details=`<div class="candidate-detail-overlay" id="candidateDetailOverlay" role="dialog" aria-modal="true" aria-label="Candidate details">
    <div class="candidate-detail-modal">
      <div class="candidate-detail-head"><div class="person-cell"><div class="mini-avatar large">${esc((s.candidateName||'C')[0].toUpperCase())}</div><div><div class="eyebrow">CANDIDATE PROFILE</div><h2>${esc(s.candidateName||'Candidate')}</h2><div class="muted">${esc(s.candidateId||'No username')}</div></div></div><button class="icon-btn" type="button" aria-label="Close" onclick="closeCandidateDetails()">×</button></div>
      <div class="candidate-detail-grid">
        <section class="detail-card"><div class="detail-label">Contact</div><div class="detail-value">${esc(s.candidateEmail||'—')}</div><div class="detail-value">${esc(s.candidatePhone||'—')}</div></section>
        <section class="detail-card"><div class="detail-label">Interview status</div><div class="detail-statuses">${badge(status,statusKind)} ${badge(result,resultKind)}</div><div class="detail-meta">Session ${esc(s.id||'—')}</div></section>
        <section class="detail-card"><div class="detail-label">Verification</div><div class="detail-statuses">${badge(verification,verifyKind)}</div><div class="detail-meta">Face match: ${esc(s.faceMatchScore!=null?String(s.faceMatchScore):'—')}</div></section>
        <section class="detail-card"><div class="detail-label">Activity</div><div class="detail-value">Warnings: ${esc(String(s.warnings||0))}</div><div class="detail-meta">Updated ${s.updatedAt?esc(formatAppDate(s.updatedAt)):'—'}</div></section>
      </div>
      <div class="candidate-detail-timeline"><div class="detail-label">Interview timeline</div><div class="timeline-row"><span>Started</span><b>${s.startedAt?esc(formatAppDate(s.startedAt)):'Not started'}</b></div><div class="timeline-row"><span>Ended</span><b>${s.endedAt?esc(formatAppDate(s.endedAt)):'—'}</b></div>${s.reason?`<div class="timeline-row"><span>Notes</span><b>${esc(s.reason)}</b></div>`:''}</div>
      <div class="candidate-detail-actions"><button class="btn secondary" type="button" onclick="closeCandidateDetails()">Close</button><button class="btn primary" type="button" onclick="closeCandidateDetails();viewSession('${String(s.candidateName||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">Open interview</button></div>
    </div></div>`;
  const existing=document.getElementById('candidateDetailOverlay');if(existing)existing.remove();
  document.body.insertAdjacentHTML('beforeend',details);
  document.body.classList.add('modal-open');
  const overlay=document.getElementById('candidateDetailOverlay');
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeCandidateDetails();});
  document.addEventListener('keydown',candidateDetailEsc);
}
function candidateDetailEsc(e){if(e.key==='Escape')closeCandidateDetails();}
function closeCandidateDetails(){const el=document.getElementById('candidateDetailOverlay');if(el)el.remove();document.body.classList.remove('modal-open');document.removeEventListener('keydown',candidateDetailEsc);}

function filterDashboardSessions(){
  const input=document.getElementById('dashboardSearch');
  const box=document.getElementById('dashboardPeopleResults');
  const q=(input?.value||'').trim().toLowerCase();
  document.querySelectorAll('#dashboardSessionRows tr[data-search]').forEach(r=>{
    const match=!q || String(r.dataset.search||'').includes(q);
    r.style.display=match?'':'none';
  });
  if(!box)return;
  clearTimeout(dashboardSearchTimer);
  if(!q){box.innerHTML='';box.style.display='none';return;}

  // Build suggestions from the already-loaded dashboard data first, so search works even if the server/API is unavailable.
  const sessions=(state.dashboardSessions||[]).filter(s=>[s.candidateName,s.candidateId,s.candidateEmail,s.candidatePhone,s.interviewerName,s.id,s.status,s.decision]
    .some(v=>String(v||'').toLowerCase().includes(q))).slice().reverse();
  let html='';
  if(sessions.length){
    html+='<div class="search-result-title">Matching candidates</div>'+sessions.slice(0,8).map(s=>'<button class="search-result session-search-result" type="button" data-session-id="'+esc(s.id||'')+'"><span class="mini-avatar">'+esc((s.candidateName||'C')[0].toUpperCase())+'</span><span><b>'+esc(s.candidateName||'Candidate')+'</b><small>'+esc(s.candidateId||'')+' · '+esc(s.candidateEmail||'')+'</small></span><span class="search-result-arrow">›</span></button>').join('');
  }
  box.innerHTML=html||'<div class="muted search-empty">No matching candidates or sessions.</div>';
  box.querySelectorAll('[data-session-id]').forEach(btn=>btn.addEventListener('click',()=>{const session=(state.dashboardSessions||[]).find(s=>String(s.id)===String(btn.dataset.sessionId));if(session)showCandidateDetails(session);box.style.display='none';}));
  box.style.display='block';
}

async function scheduleInterview(){
  const msg=document.getElementById('scheduleMsg');
  const candidateEmail=document.getElementById('scheduleCandidateEmail').value.trim();
  const interviewerEmail=document.getElementById('scheduleInterviewerEmail').value.trim();
  const scheduledAt=document.getElementById('scheduleAt').value;
  if(!validEmail(candidateEmail)||!validEmail(interviewerEmail)){toast('Enter valid candidate and interviewer email addresses.','warning');return;}
  if(!scheduledAt){toast('Choose the interview date and time.','warning');return;}
  try{const localDate=new Date(scheduledAt); if(Number.isNaN(localDate.getTime())){toast('Choose a valid interview date and time.','warning');return;} const scheduledAtIso=localDate.toISOString(); const d=await api('/api/schedule',{method:'POST',body:JSON.stringify({candidateName:document.getElementById('scheduleCandidateName').value,candidateEmail,candidatePhone:document.getElementById('scheduleCandidatePhone')?.value||'',candidateId:document.getElementById('scheduleCandidateId').value,interviewerName:state.user?.name||'',interviewerEmail,interviewerPhone:document.getElementById('scheduleInterviewerPhone')?.value||'',interviewerId:document.getElementById('scheduleInterviewerId').value,scheduledAt:scheduledAtIso})});toast(d.emailNotice?.candidate?.sent&&d.emailNotice?.interviewer?.sent?'Interview scheduled. Email notifications were sent to the candidate and interviewer.':`Interview saved, but email notification could not be sent (${d.emailNotice?.candidate?.reason||'check SMTP settings'}).`,d.emailNotice?.candidate?.sent&&d.emailNotice?.interviewer?.sent?'success':'warning'); }catch(e){toast(e.message,'danger');}
}

async function candidates(){
  state.page="candidates";
  let sessionsData=[];
  try{const d=await api('/api/sessions');sessionsData=d.sessions||[];}catch(e){}
  const latest={};
  sessionsData.forEach(s=>{if(s.candidateId && (!latest[s.candidateId] || new Date(s.updatedAt||0)>new Date(latest[s.candidateId].updatedAt||0)))latest[s.candidateId]=s;});
  const rows=Object.values(latest);
  shell(`<div class="page-title"><div><div class="eyebrow">PEOPLE</div><h1>Candidates</h1><div class="muted">Candidate identity, contact information, verification readiness and latest interview status.</div></div><button class="btn secondary" onclick="navigate('schedule')">View Schedule</button></div>
  <section class="panel glass-panel"><div class="section-head"><div><h2>Candidate Directory</h2><span class="muted">Phone numbers are shown in their own column.</span></div><span class="count-chip">${rows.length} records</span></div>
  <div class="table-wrap"><table class="table professional-table"><thead><tr><th>Candidate</th><th>Username</th><th>Email</th><th>Phone</th><th>Verification</th><th>Status</th><th>Result</th></tr></thead><tbody>
  ${rows.length?rows.map(s=>`<tr><td><div class="person-cell"><div class="mini-avatar">${esc((s.candidateName||'C')[0].toUpperCase())}</div><div><b>${esc(s.candidateName||'—')}</b><div class="muted">${esc(s.candidateId||'—')}</div></div></div></td><td>${esc(s.candidateId||'—')}</td><td>${esc(s.candidateEmail||'—')}</td><td>${esc(s.candidatePhone||'—')}</td><td><span class="badge ${s.faceMatchStatus==='Verified'?'ready':'pending'}">${esc(s.faceMatchStatus||'Pending')}</span></td><td><span class="badge ${['Failed','Rejected','Terminated'].includes(s.status)?'rejected':s.status==='Warning Issued'?'warning':'ready'}">${esc(s.status||'Not Started')}</span></td><td><span class="badge ${s.decision==='Passed'?'ready':s.decision==='Failed'?'rejected':s.decision?'warning':'pending'}">${esc(s.decision||'Pending')}</span></td></tr>`).join(''):'<tr><td colspan="7" class="muted">No candidate sessions have been recorded yet.</td></tr>'}
  </tbody></table></div></section>`);
}
function sessions(){state.page="sessions";shell(`<div class="page-title"><div><h1>Interview Sessions</h1><div class="muted">Session lifecycle and verification state.</div></div></div><div class="cards"><div class="card"><div class="label">Not Started</div><div class="metric">4</div></div><div class="card"><div class="label">Identity Verification</div><div class="metric">2</div></div><div class="card"><div class="label">In Progress</div><div class="metric">12</div></div><div class="card"><div class="label">Completed</div><div class="metric">41</div></div></div><section class="panel"><h2>Status Pipeline</h2><div class="steps"><span class="step">Not Started</span><span class="step done">Identity Verification</span><span class="step done">Room Verification</span><span class="step active">Device Verification</span><span class="step">Ready</span><span class="step">Interview In Progress</span><span class="step">Warning Issued</span><span class="step">Terminated</span><span class="step">Rejected</span><span class="step">Completed</span></div></section>`);}
function audit(){state.page="audit";shell(`<div class="page-title"><div><h1>Audit Logs</h1><div class="muted">Timestamped security and verification events.</div></div></div><section class="panel"><table class="table"><thead><tr><th>Time</th><th>Candidate</th><th>Event</th><th>Severity</th></tr></thead><tbody>${["19:31:42|Sana Ahmed|Tab/window focus lost|Warning","19:27:13|Rahul Kumar|Full-screen mode exited|Warning","19:12:05|Sana Ahmed|Additional speaker detected|Critical","18:59:44|Arjun Rao|Government ID face match passed|Info","18:55:02|Rahul Kumar|Display configuration checked|Info"].map(x=>{let[a,b,c,d]=x.split("|");return `<tr><td>${a}</td><td>${b}</td><td>${c}</td><td><span class="badge ${d==="Critical"?"rejected":d==="Warning"?"warning":"ready"}">${d}</span></td></tr>`}).join("")}</tbody></table></section>`);}
async function evaluationsPage(){
  state.page='evaluations';
  let sessionsData=[];
  try{const d=await api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=interviewer`);sessionsData=d.sessions||[];}catch(e){toast(e.message,'danger');}
  const evaluated=sessionsData.filter(s=>s.interviewerReview);
  const rated=sessionsData.map(s=>evaluationMeta(s.interviewerReview).avg).filter(Boolean).map(Number);
  const avg=rated.length?(rated.reduce((a,b)=>a+b,0)/rated.length).toFixed(1):'—';
  const rows=sessionsData.slice().sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).map(s=>{
    const r=s.interviewerReview||{},m=evaluationMeta(r);
    return `<tr><td><div class="person-cell"><div class="mini-avatar">${esc((s.candidateName||'C')[0].toUpperCase())}</div><div><b>${esc(s.candidateName||'Candidate')}</b><small>${esc(s.candidateId||'—')}</small></div></div></td><td>${esc(s.id||'—')}</td><td>${m.avg?`<span class="evaluation-average">${m.avg}/5</span>`:'<span class="badge pending">Not rated</span>'}</td><td>${r.technical?esc(r.technical)+'/5':'—'}</td><td>${r.communication?esc(r.communication)+'/5':'—'}</td><td>${r.problemSolving?esc(r.problemSolving)+'/5':'—'}</td><td>${r.roleKnowledge?esc(r.roleKnowledge)+'/5':'—'}</td><td><span class="badge ${r.notes?'ready':'pending'}">${r.notes?'Notes added':'No notes'}</span></td><td>${r.updatedAt?esc(formatAppDate(r.updatedAt)):'—'}</td><td><button class="btn secondary" onclick="showEvaluation('${esc(s.id)}')">View</button></td></tr>`;
  }).join('');
  shell(`<div class="page-title"><div><div class="eyebrow">INTERVIEWER WORKSPACE</div><h1>Candidate Evaluations</h1><div class="muted">Review the evaluation and private notes saved for each interview session.</div></div><span class="count-chip">${evaluated.length} evaluated · ${sessionsData.length} total</span></div><div class="cards evaluation-summary-cards"><div class="card"><div class="label">Candidates</div><div class="metric">${sessionsData.length}</div></div><div class="card"><div class="label">Evaluated</div><div class="metric">${evaluated.length}</div></div><div class="card"><div class="label">Pending evaluation</div><div class="metric">${Math.max(0,sessionsData.length-evaluated.length)}</div></div><div class="card"><div class="label">Average rating</div><div class="metric">${avg}<small style="font-size:14px;color:#748096">${avg==='—'?'':' / 5'}</small></div></div></div><section class="panel"><div class="section-head"><div><h2>Candidate evaluation history</h2><span class="muted">Each row represents one interview session. Click View to see the full evaluation and interviewer notes.</span></div></div><div class="table-wrap"><table class="table professional-table evaluation-table"><thead><tr><th>Candidate</th><th>Session</th><th>Overall</th><th>Technical</th><th>Communication</th><th>Problem solving</th><th>Role knowledge</th><th>Notes</th><th>Updated</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="10" class="muted">No interview sessions are assigned to this interviewer yet.</td></tr>'}</tbody></table></div></section>`);
}

async function feedbackPage(){
  state.page='feedback';
  let sessions=[];try{const d=await api('/api/sessions?userId='+encodeURIComponent(state.user?.id||'')+'&role=interviewer');sessions=d.sessions||[];}catch(e){}
  const withFeedback=sessions.filter(s=>s.feedback);
  const cards=withFeedback.length?withFeedback.slice().reverse().map(s=>`<article class="feedback-card"><div class="feedback-card-head"><div><b>${esc(s.candidateName||'Candidate')}</b><div class="muted">${esc(s.candidateId||'')} • ${esc(s.candidatePhone||'—')}</div></div><span class="badge ready">${Number(s.feedback.rating||0)}/5</span></div><div class="feedback-stars-static">${'★'.repeat(Number(s.feedback.rating||0))}${'☆'.repeat(5-Number(s.feedback.rating||0))}</div><p>${esc(s.feedback.comment||'No written comment.')}</p><div class="muted">Submitted ${s.feedback.createdAt?formatAppDate(s.feedback.createdAt):'—'} • Session ${esc(s.id)}</div></article>`).join(''):`<article class="panel empty-state"><h2>No feedback yet</h2><p class="muted">When a candidate finishes an interview and submits feedback, it will appear here.</p></article>`;
  shell(`<div class="page-title"><div><div class="eyebrow">CANDIDATE EXPERIENCE</div><h1>Candidate Feedback</h1><div class="muted">Feedback submitted after completed interviews, visible only to the interviewer.</div></div><span class="count-chip">${withFeedback.length} responses</span></div><section class="panel"><div class="feedback-summary"><div><span class="label">Responses</span><strong>${withFeedback.length}</strong></div><div><span class="label">Average rating</span><strong>${withFeedback.length?(withFeedback.reduce((n,s)=>n+Number(s.feedback.rating||0),0)/withFeedback.length).toFixed(1):'—'} / 5</strong></div></div></section><section class="feedback-grid">${cards}</section>`);
}
function settings(){
  state.page="settings";
  shell(`<div class="page-title"><div><h1>Settings</h1><div class="muted">Configure interview security and server email notifications.</div></div></div>
  <section class="panel"><h2>Email Settings</h2>
    <div class="helper-note"><b>Important:</b> the candidate's email address is entered on the Schedule page. These settings are the <b>sender email account</b> HireTrust uses to send messages. For Gmail, use your real Gmail address + a <b>Google App Password</b> (not your normal Gmail password). Placeholder values such as <code>YOUR_GMAIL@gmail.com</code> will not work.</div>
    <div class="smtp-guide"><b>Gmail setup:</b> turn on 2-Step Verification in your Google Account → create an <b>App Password</b> named “HireTrust” → copy the generated 16-character password into <b>SMTP Password / App Password</b>. Keep Host <b>smtp.gmail.com</b>, Port <b>465</b>, and secure TLS enabled. Use the same real Gmail address for SMTP Username and From Email.</div>
    <div id="smtpStatus" class="notice" style="margin-top:12px">Loading email configuration…</div>
    <div class="check-grid" style="margin-top:14px">
      <div>
        <div class="field"><label>SMTP Host</label><input id="smtpHost" placeholder="smtp.gmail.com"></div>
        <div class="field"><label>SMTP Port</label><input id="smtpPort" type="number" min="1" max="65535" value="465"></div>
        <div class="field"><label>SMTP Username</label><input id="smtpUser" type="email" placeholder="your-email@gmail.com"></div>
      </div>
      <div>
        <div class="field"><label>SMTP Password / App Password</label>${passwordInput('smtpPass','16-character Google App Password','new-password')}</div>
        <div class="field"><label>From Email</label><input id="smtpFrom" type="email" placeholder="your-email@gmail.com"></div>
        <label class="status-row" style="margin-top:18px"><span>Use secure TLS (recommended)</span><input id="smtpSecure" type="checkbox" checked></label>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
      <button class="btn primary" onclick="saveEmailSettings()">Save Email Settings</button>
      <button class="btn secondary" onclick="testEmailSettings()">Send Test Email</button><button class="btn ghost" onclick="checkEmailDiagnostics()">Check Configuration</button>
    </div>
    <div id="smtpActionMsg" class="notice" style="display:none;margin-top:12px"></div>
  </section>
  <section class="panel"><h2>Interview Policy</h2>${[["Require government ID verification",true],["Require room verification",true],["Require single display",true],["Require full-screen mode",true],["Detect tab/window changes",true],["Enable speaker verification with consent",true],["Auto-terminate after second focus violation",true],["Store raw audio indefinitely",false]].map(([x,v])=>`<div class="status-row"><span>${x}</span><input type="checkbox" ${v?"checked":""}></div>`).join("")}</section>
  <section class="panel"><h2>Privacy</h2><div class="helper-note">Store only the minimum identity information necessary. Encrypt sensitive data in transit and at rest, restrict access by role, and define a deletion/retention schedule before production use.</div></section>`);
  loadEmailSettings();
}
async function loadEmailSettings(){
  try{
    const d=await api('/api/email-settings'); const x=d.settings||{};
    document.getElementById('smtpHost').value=x.host||'';
    document.getElementById('smtpPort').value=x.port||587;
    document.getElementById('smtpUser').value=x.user||'';
    document.getElementById('smtpFrom').value=x.from||'';
    document.getElementById('smtpSecure').checked=!!x.secure;
    const st=document.getElementById('smtpStatus');
    st.className=`notice ${x.passConfigured?'success-notice':'invalid-notice'}`;
    st.textContent=x.passConfigured?'SMTP credentials are configured. You can send a test email below.':'SMTP is not configured yet. Enter the SMTP credentials and save them.';
  }catch(e){const st=document.getElementById('smtpStatus');if(st)st.textContent='Could not load email settings.';}
}
async function checkEmailDiagnostics(){
  const msg=document.getElementById('smtpActionMsg');
  try{
    const host=document.getElementById('smtpHost')?.value.trim()||'';
    const port=Number(document.getElementById('smtpPort')?.value||465);
    const user=document.getElementById('smtpUser')?.value.trim()||'';
    const pass=document.getElementById('smtpPass')?.value||'';
    const from=document.getElementById('smtpFrom')?.value.trim()||'';
    const secure=!!document.getElementById('smtpSecure')?.checked;
    if(!host||!user||!from){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='Enter SMTP host, username and From email first.';return;}
    if(!validEmail(user)||!validEmail(from)){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='Enter a valid Gmail/email address for SMTP Username and From Email.';return;}
    if(/YOUR_GMAIL|YOUR_EMAIL|example\.com/i.test(user)||/YOUR_GMAIL|YOUR_EMAIL|example\.com/i.test(from)){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='Replace the placeholder Gmail address with your real Gmail address.';return;}
    if(!Number.isInteger(port)||port<1||port>65535){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='SMTP port must be between 1 and 65535.';return;}
    // Check the values currently visible in the form. Saving here prevents a stale
    // smtp-settings.json (for example, an old YOUR_GMAIL placeholder) from being
    // reported as the active configuration after the user has entered new values.
    await api('/api/email-settings',{method:'POST',body:JSON.stringify({host,port,user,pass,from,secure})});
    const d=await api('/api/email-settings/diagnostics');
    const x=d.diagnostics||{}; const missing=[];
    if(!x.nodemailerInstalled)missing.push('Nodemailer');
    if(!x.hostConfigured)missing.push('SMTP host');
    if(!x.userConfigured)missing.push('SMTP username');
    if(!x.passwordConfigured)missing.push('SMTP password/app password');
    if(!x.fromConfigured)missing.push('From email');
    if(x.placeholderCredentials)missing.push('real Gmail address (replace YOUR_GMAIL placeholder)');
    msg.style.display='block';
    msg.className=missing.length?'notice invalid-notice':'notice success-notice';
    msg.textContent=missing.length?'Fix before testing: '+missing.join(', ')+'.':'Configuration looks complete. Now click Send Test Email to verify the Gmail connection.';
    if(document.getElementById('smtpPass')) document.getElementById('smtpPass').value='';
  }catch(e){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}
}
async function saveEmailSettings(){
  const msg=document.getElementById('smtpActionMsg');
  const host=document.getElementById('smtpHost').value.trim(), port=Number(document.getElementById('smtpPort').value||587), user=document.getElementById('smtpUser').value.trim(), pass=document.getElementById('smtpPass').value, from=document.getElementById('smtpFrom').value.trim(), secure=document.getElementById('smtpSecure').checked;
  if(!host||!user||!from){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='SMTP host, username and From email are required.';return;}
  if(/YOUR_GMAIL|YOUR_EMAIL|example\.com/i.test(user)||/YOUR_GMAIL|YOUR_EMAIL|example\.com/i.test(from)){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='Replace the placeholder Gmail address with your real Gmail address.';return;}
  if(!validEmail(user)){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='SMTP Username must be a valid email address.';return;}
  if(!validEmail(from)){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='From email must be a valid email address.';return;}
  if(!Number.isInteger(port)||port<1||port>65535){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='SMTP port must be between 1 and 65535.';return;}
  try{const d=await api('/api/email-settings',{method:'POST',body:JSON.stringify({host,port,user,pass,from,secure})});msg.style.display='block';msg.className='notice success-notice';msg.textContent=d.message||'Email settings saved.';document.getElementById('smtpPass').value='';loadEmailSettings();}
  catch(e){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}
}
async function testEmailSettings(){
  const msg=document.getElementById('smtpActionMsg');
  const to=prompt('Enter the email address that should receive the SMTP test email:');
  if(!to)return;
  if(!validEmail(to)){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='Please enter a valid test recipient email address.';return;}
  try{const d=await api('/api/email-settings/test',{method:'POST',body:JSON.stringify({to})});msg.style.display='block';msg.className='notice success-notice';msg.textContent=d.message||'Test email sent.';}
  catch(e){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}
}
function timingLog(){
  state.page="timing";
  api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=interviewer`).then(d=>{
    const rows=d.sessions||[];
    shell(`<div class="page-title"><div><div class="eyebrow">ANALYTICS</div><h1>Timing Log</h1><div class="muted">Complete interview session timing history.</div></div></div>
    <section class="panel glass-panel"><div class="table-wrap"><table class="table professional-table"><thead><tr><th>Candidate</th><th>Phone</th><th>Scheduled</th><th>Started</th><th>Ended</th><th>Duration</th><th>Status</th></tr></thead><tbody>${rows.length?rows.slice().reverse().map(s=>{const a=s.startedAt?new Date(s.startedAt):null,b=s.endedAt?new Date(s.endedAt):null;const mins=a&&b?Math.max(0,Math.round((b-a)/60000)):null;return `<tr><td><b>${esc(s.candidateName||'—')}</b><div class="muted">${esc(s.candidateId||'')}</div></td><td>${esc(s.candidatePhone||'—')}</td><td>${s.scheduledAt?esc(formatAppDate(s.scheduledAt)):'—'}</td><td>${a?esc(formatAppDate(a)):'—'}</td><td>${b?esc(formatAppDate(b)):'—'}</td><td>${mins===null?'—':mins+' min'}</td><td><span class="badge ${['Failed','Rejected','Terminated'].includes(s.status)?'rejected':s.status==='Scheduled'?'pending':'ready'}">${esc(s.status||'—')}</span></td></tr>`}).join(''):'<tr><td colspan="7" class="muted">No timing records yet.</td></tr>'}</tbody></table></div></section>`);
  }).catch(()=>shell('<div class="page-title"><div><h1>Timing Log</h1><div class="muted">Unable to load timing data.</div></div></div>'));
}
function profilePage(){
  state.page="profile";
  const u=state.user||{};
  shell(`<div class="page-title"><div><div class="eyebrow">ACCOUNT</div><h1>Profile</h1><div class="muted">Your registered interviewer information.</div></div></div>
  <section class="profile-card glass-panel"><div class="profile-cover"></div><div class="profile-body"><div class="profile-avatar large">${u.profilePic?`<img src="${u.profilePic}" alt="Profile">`:esc((u.name||'I')[0].toUpperCase())}</div><div class="profile-main"><h2>${esc(u.name||'Interviewer')}</h2><span class="role-pill">Interviewer</span><div class="profile-details professional-profile"><div><b>Username</b><span>${esc(u.id||'—')}</span></div><div><b>Email</b><span>${esc(u.email||'—')}</span></div><div><b>Phone Number</b><span>${esc(u.phone||'—')}</span></div><div><b>Date of Birth</b><span>${esc(u.dob||'—')}</span></div></div></div></div></section>`);
}
async function aiPage(){
  state.page="ai";
  let sessions=[];try{const d=await api('/api/sessions');sessions=d.sessions||[];}catch(e){}
  const total=sessions.length, warnings=sessions.reduce((n,s)=>n+Number(s.warnings||0),0), failed=sessions.filter(s=>['Failed','Rejected','Terminated'].includes(s.status)||s.decision==='Failed').length;
  const score=Math.min(100,Math.round((warnings*4)+(failed*7)));
  shell(`<div class="page-title"><div><div class="eyebrow">INTELLIGENCE</div><h1>AI Insights</h1><div class="muted">AI-assisted monitoring summaries built from HireTrust verification events. Advisory only.</div></div><span class="count-chip">${total} sessions analyzed</span></div>
  <div class="cards"><div class="card"><div class="label">Integrity Signal</div><div class="metric">${Math.max(0,100-score)}%</div><div class="muted">Lower values indicate more events to review.</div></div><div class="card"><div class="label">Warnings</div><div class="metric">${warnings}</div><div class="muted">Audio, focus, device and verification events.</div></div><div class="card"><div class="label">Failed</div><div class="metric">${failed}</div><div class="muted">Final interviewer outcomes.</div></div><div class="card"><div class="label">Automation</div><div class="metric">Advisory</div><div class="muted">Human review remains required.</div></div></div>
  <section class="panel ai-panel"><div class="ai-orb">AI</div><div><h2>Monitoring assistant</h2><div class="ai-insights"><div class="ai-insight"><span class="badge ready">Live</span><div><b>Audio</b><p>Detects prolonged silence and provides a visual microphone-level indicator when audio consent is active.</p></div></div><div class="ai-insight"><span class="badge warning">Review</span><div><b>Face & identity</b><p>Surfaces selfie and ID verification material for interviewer review; it does not make an automated hiring decision.</p></div></div><div class="ai-insight"><span class="badge warning">Review</span><div><b>Attention</b><p>Gaze/focus alerts are advisory and should be reviewed in context rather than used as a sole employment criterion.</p></div></div><div class="ai-insight"><span class="badge ready">Live</span><div><b>Session integrity</b><p>Tracks full-screen exits, tab/window focus, phone companion signals and timing events.</p></div></div><div class="ai-insight"><span class="badge pending">Secure</span><div><b>Application control</b><p>A browser cannot close arbitrary background apps. A managed secure-browser/desktop agent is required for enforcement.</p></div></div><div class="ai-insight"><span class="badge ready">Human</span><div><b>Decision support</b><p>Pass/fail/reject actions stay under interviewer control.</p></div></div></div></div></section>`);
}
function aiAssistant(){
  const risk=[];
  const now=new Date();
  risk.push({title:'Identity review',text:'Use the selfie and government ID together for human verification.',level:'Review'});
  risk.push({title:'Session integrity',text:'Review any tab, full-screen, audio or device warnings before making a final decision.',level:'Advisory'});
  risk.push({title:'Decision support',text:'AI assistance is advisory only; final hiring/interview decisions remain with the interviewer.',level:'Advisory'});
  return `<section class="panel ai-panel"><div class="ai-orb">AI</div><div><div class="eyebrow">HIRETRUST AI ASSISTANT</div><h2>Interview intelligence</h2><p class="muted">Real-time advisory summaries from verification and session events.</p><div class="ai-insights">${risk.map(r=>`<div class="ai-insight"><span class="badge warning">${esc(r.level)}</span><div><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div></div>`).join('')}</div></div></section>`;
}

function twoFactorPage(isCandidate=false){
  const u=state.pending2fa?.user||{};
  app.innerHTML=`<div class="auth-shell"><div class="auth-card"><div class="auth-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><span>Hire<span>Trust</span></span></div><h1>Verify your sign-in</h1><p class="muted">We sent a 6-digit verification code to the email address on your ${isCandidate?'candidate':'interviewer/admin'} account.</p><form onsubmit="event.preventDefault();verifyTwoFactor()"><div class="field"><label>Verification Code</label><input id="twoFactorCode" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required placeholder="123456" autocomplete="one-time-code"></div><button class="btn primary" style="width:100%">Verify & Continue</button></form><div id="twoFactorMsg" class="notice" style="display:none;margin-top:12px"></div><div class="auth-links"><button class="link-btn" onclick="${isCandidate?'candidateLogin()':'interviewerLogin()'}">Back to Login</button></div></div></div>`;
}
async function verifyTwoFactor(){try{const code=document.getElementById('twoFactorCode').value.trim();const d=await api('/api/login/2fa',{method:'POST',body:JSON.stringify({challengeId:state.pending2fa?.challengeId,code})});state.pending2fa=null;state.loggedIn=true;state.user=d.user;if(d.user.role==='candidate')candidatePortal();else if(d.user.role==='admin')adminConsole();else dashboard();toast(`Welcome, ${d.user.name}`);}catch(e){const m=document.getElementById('twoFactorMsg');if(m){m.style.display='block';m.className='notice invalid-notice';m.textContent=e.message;}}}
function operationsCenter(){state.page='operations';api('/api/sessions').then(d=>{const ss=d.sessions||[];const live=ss.filter(s=>['Interview In Progress','Ready','Warning Issued'].includes(s.status));const waiting=ss.filter(s=>s.status==='Waiting Room');shell(`<div class="page-title"><div><div class="eyebrow">LIVE OPERATIONS</div><h1>Interview Control Center</h1><div class="muted">One screen for waiting candidates, live integrity signals and active sessions.</div></div><button class="btn secondary" onclick="notificationsPage()">Open Notifications</button></div><div class="cards"><div class="card"><div class="label">Live interviews</div><div class="metric">${live.length}</div></div><div class="card"><div class="label">Waiting room</div><div class="metric">${waiting.length}</div></div><div class="card"><div class="label">Warnings</div><div class="metric">${ss.reduce((n,s)=>n+Number(s.warnings||0),0)}</div></div><div class="card"><div class="label">Active integrity checks</div><div class="metric">${live.length?live.length*6:0}</div></div></div><section class="panel"><h2>Waiting candidates</h2>${waiting.length?waiting.map(s=>`<div class="operation-row"><div><b>${esc(s.candidateName||'Candidate')}</b><div class="muted">${esc(s.candidateId||'')} · ${esc(s.id)}</div></div><div class="operation-actions"><span class="badge pending">Waiting</span><button class="btn primary" onclick="admitCandidate('${esc(s.id)}')">Admit</button><button class="btn secondary" onclick="viewSession('${esc(String(s.candidateName||'').replace(/'/g,"\\'"))}')">Open</button></div></div>`).join(''):'<div class="empty-state"><h3>No one is waiting</h3><p class="muted">Candidates who check in will appear here.</p></div>'}</section><section class="panel"><h2>Active interview health</h2>${live.length?live.map(s=>`<div class="operation-row"><div><b>${esc(s.candidateName||'Candidate')}</b><div class="muted">${esc(s.id)} · Started ${esc(formatAppDate(s.startedAt))}</div></div><div class="health-badges"><span class="badge ready">Camera</span><span class="badge ready">Audio</span><span class="badge ${Number(s.warnings||0)?'warning':'ready'}">${Number(s.warnings||0)} warnings</span><span class="badge ${s.violations?.length?'warning':'ready'}">${s.violations?.length||0} violations</span><button class="btn secondary" onclick="viewSession('${esc(String(s.candidateName||'').replace(/'/g,"\\'"))}')">Monitor</button></div></div>`).join(''):'<div class="empty-state"><h3>No live interviews</h3><p class="muted">Scheduled interviews will appear when candidates enter the waiting room.</p></div>'}</section>`);}).catch(e=>{shell(`<div class="page-title"><h1>Interview Control Center</h1></div><section class="panel"><div class="notice invalid-notice">${esc(e.message)}</div></section>`);});}
async function admitCandidate(sessionId){try{await api(`/api/sessions/${encodeURIComponent(sessionId)}/admit`,{method:'POST',body:JSON.stringify({interviewerId:state.user?.id||''})});toast('Candidate admitted to the interview.','success');operationsCenter();}catch(e){toast(e.message,'danger');}}
async function analyticsPage(){state.page='analytics';try{const d=await api('/api/analytics');const m=d.metrics||{};shell(`<div class="page-title"><div><div class="eyebrow">ANALYTICS</div><h1>Interview Analytics</h1><div class="muted">Operational metrics across recorded HireTrust sessions.</div></div></div><div class="cards"><div class="card"><div class="label">Total sessions</div><div class="metric">${m.totalSessions||0}</div></div><div class="card"><div class="label">Completed</div><div class="metric">${m.completed||0}</div></div><div class="card"><div class="label">Passed</div><div class="metric">${m.passed||0}</div></div><div class="card"><div class="label">Failed / terminated</div><div class="metric">${m.failed||0}</div></div><div class="card"><div class="label">Average duration</div><div class="metric">${m.averageMinutes||0}<span style="font-size:14px"> min</span></div></div></div><section class="panel"><h2>Status distribution</h2><div class="analytics-bars">${Object.entries(m.byStatus||{}).map(([k,v])=>`<div class="analytics-bar-row"><div class="analytics-bar-label"><span>${esc(k)}</span><b>${v}</b></div><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.min(100,Math.max(4,(v/(m.totalSessions||1))*100))}%"></div></div></div>`).join('')||'<div class="muted">No session data yet.</div>'}</div></section><section class="panel"><h2>Integrity indicators</h2><div class="check-grid"><div class="detail-card"><b>Total warnings</b><div class="metric">${m.totalWarnings||0}</div></div><div class="detail-card"><b>Needs review</b><div class="metric">${m.needsReview||0}</div></div><div class="detail-card"><b>Human review</b><p class="muted">AI signals remain advisory; interviewers make final decisions.</p></div></div></section>`);}catch(e){shell(`<div class="page-title"><h1>Analytics</h1></div><section class="panel"><div class="notice invalid-notice">${esc(e.message)}</div></section>`);}}
async function questionBankPage(){state.page='questions';let qs=[];try{qs=(await api('/api/question-bank')).questions||[]}catch(e){}shell(`<div class="page-title"><div><div class="eyebrow">INTERVIEW CONTENT</div><h1>Question Bank</h1><div class="muted">Create reusable technical, HR and behavioral questions for structured interviews.</div></div></div><section class="panel"><h2>Add Question</h2><div class="grid2"><div class="field"><label>Question</label><textarea id="qbQuestion" rows="4" placeholder="e.g. Explain the difference between a list and tuple in Python."></textarea></div><div><div class="field"><label>Category</label><select id="qbCategory"><option>Technical</option><option>Python</option><option>JavaScript</option><option>SQL</option><option>AI/ML</option><option>HR</option><option>Behavioral</option><option>General</option></select></div><div class="field"><label>Difficulty</label><select id="qbDifficulty"><option>Easy</option><option selected>Medium</option><option>Hard</option></select></div><div class="field"><label>Expected topics</label><input id="qbTopics" placeholder="Key concepts to listen for"></div></div></div><button class="btn primary" onclick="saveQuestionBankItem()">Add to Question Bank</button></section><section class="panel"><div class="section-head"><h2>Saved Questions</h2><span class="count-chip">${qs.length}</span></div><div class="question-list">${qs.length?qs.map(q=>`<article class="question-card"><div><span class="badge ready">${esc(q.category)}</span> <span class="badge pending">${esc(q.difficulty)}</span><h3>${esc(q.question)}</h3><p class="muted">Expected topics: ${esc(q.expectedTopics||'Not specified')}</p></div><button class="btn danger" onclick="deleteQuestionBankItem('${esc(q.id)}')">Delete</button></article>`).join(''):'<div class="empty-state"><h3>No questions yet</h3><p class="muted">Add your first reusable interview question above.</p></div>'}</div></section>`);}
async function saveQuestionBankItem(){try{await api('/api/question-bank',{method:'POST',body:JSON.stringify({question:document.getElementById('qbQuestion').value,category:document.getElementById('qbCategory').value,difficulty:document.getElementById('qbDifficulty').value,expectedTopics:document.getElementById('qbTopics').value,createdBy:state.user?.id||''})});toast('Question added.','success');questionBankPage();}catch(e){toast(e.message,'danger');}}
async function deleteQuestionBankItem(id){if(!confirm('Delete this question from the bank?'))return;try{await api(`/api/question-bank/${encodeURIComponent(id)}`,{method:'DELETE'});questionBankPage();}catch(e){toast(e.message,'danger');}}
async function notificationsPage(){
  state.page='notifications';
  try{
    const d=await api(`/api/notifications?userId=${encodeURIComponent(state.user?.id||'')}`);
    const ns=d.notifications||[];
    const list=ns.length?ns.map(n=>`<article class="notification-card ${n.read?'read':'unread'}"><div class="notification-icon">${n.type==='waiting-room'?'⏳':n.type==='security'?'⚠':'●'}</div><div><b>${esc(n.title)}</b><p>${esc(n.message)}</p><small>${esc(formatAppDate(n.createdAt))}</small></div></article>`).join(''):`<div class="empty-state"><h3>No notifications</h3><p class="muted">You are all caught up.</p></div>`;
    shell(`<div class="page-title"><div><div class="eyebrow">WORKSPACE</div><h1>Notifications</h1><div class="muted">Interview scheduling, waiting-room and security updates.</div></div><button class="btn secondary" onclick="markAllNotificationsRead()">Mark visible as read</button></div><section class="panel"><div class="notification-list">${list}</div></section>`);
  }catch(e){toast(e.message,'danger');}
}
async function markAllNotificationsRead(){try{const d=await api(`/api/notifications?userId=${encodeURIComponent(state.user?.id||'')}`);await api('/api/notifications/read',{method:'POST',body:JSON.stringify({ids:(d.notifications||[]).map(n=>n.id)})});notificationsPage();}catch(e){toast(e.message,'danger');}}
async function securityPage(){state.page='security';const enabled=!!state.user?.twoFactorEnabled;shell(`<div class="page-title"><div><div class="eyebrow">ACCOUNT SECURITY</div><h1>Security Center</h1><div class="muted">Protect interviewer and administrator accounts and review session controls.</div></div></div><section class="panel"><div class="security-setting-row"><div><h2>Email two-factor authentication</h2><p class="muted">After password login, HireTrust sends a one-time 6-digit code to your registered email.</p></div><span class="badge ${enabled?'ready':'pending'}">${enabled?'Enabled':'Disabled'}</span></div><button class="btn ${enabled?'danger':'primary'}" onclick="toggleTwoFactor(${!enabled})">${enabled?'Disable 2FA':'Enable 2FA'}</button><div id="securityMsg" class="notice" style="margin-top:12px"></div></section><section class="panel"><h2>Session security</h2><div class="check-grid"><div class="check"><div class="icon">✓</div><div><b>Rate-limited login attempts</b><div class="muted">Repeated failed sign-ins are temporarily blocked.</div></div></div><div class="check"><div class="icon">✓</div><div><b>Single-use password reset links</b><div class="muted">Reset links expire after 15 minutes.</div></div></div><div class="check"><div class="icon">✓</div><div><b>Interview audit trail</b><div class="muted">Security events are timestamped against sessions.</div></div></div></div></section>`);}
async function toggleTwoFactor(enabled){try{const d=await api('/api/security/2fa',{method:'POST',body:JSON.stringify({userId:state.user?.id,enabled})});state.user.twoFactorEnabled=enabled;toast(d.message,'success');securityPage();}catch(e){toast(e.message,'danger');}}
async function adminConsole(){if(state.user?.role!=='admin'){toast('Admin access required.','danger');return;}state.page='admin';try{const d=await api(`/api/admin/overview?userId=${encodeURIComponent(state.user.id)}`);const m=d.metrics||{};shell(`<div class="page-title"><div><div class="eyebrow">ADMINISTRATION</div><h1>HireTrust Admin Console</h1><div class="muted">User management, system health, audit and privacy controls.</div></div></div><div class="cards"><div class="card"><div class="label">Users</div><div class="metric">${m.users||0}</div></div><div class="card"><div class="label">Candidates</div><div class="metric">${m.candidates||0}</div></div><div class="card"><div class="label">Interviewers</div><div class="metric">${m.interviewers||0}</div></div><div class="card"><div class="label">Sessions</div><div class="metric">${m.sessions||0}</div></div><div class="card"><div class="label">Active</div><div class="metric">${m.active||0}</div></div></div><section class="panel"><h2>System health</h2><div class="check-grid"><div class="check"><div class="icon">✓</div><div><b>MongoDB</b><div class="muted">Connected through the application server.</div></div></div><div class="check"><div class="icon">✓</div><div><b>Email</b><div class="muted">Configured through SMTP settings.</div></div></div><div class="check"><div class="icon">✓</div><div><b>WebRTC</b><div class="muted">Browser-based live interview transport.</div></div></div></div></section><section class="panel"><h2>Users</h2><div class="table-wrap"><table class="table"><thead><tr><th>User ID</th><th>Name</th><th>Email</th><th>Role</th><th>2FA</th><th>Created</th></tr></thead><tbody>${(d.users||[]).map(u=>`<tr><td>${esc(u.id)}</td><td>${esc(u.name)}</td><td>${esc(u.email||'—')}</td><td><span class="badge ${u.role==='admin'?'ready':'pending'}">${esc(u.role)}</span></td><td>${u.twoFactorEnabled?'✓ Enabled':'Disabled'}</td><td>${esc(formatAppDate(u.createdAt))}</td></tr>`).join('')}</tbody></table></div></section><section class="panel"><h2>Privacy retention</h2><p class="muted">Privacy-redact old interview media and connection data without deleting the session record.</p><div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap"><div class="field" style="min-width:180px"><label>Retention days</label><input id="retentionDays" type="number" min="1" max="3650" value="90"></div><button class="btn secondary" onclick="runRetention(true)">Preview</button><button class="btn danger" onclick="runRetention(false)">Apply Redaction</button></div><div id="retentionMsg" class="notice"></div></section><section class="panel"><h2>Recent admin audit</h2><div class="status-list">${(d.audit||[]).slice(0,20).map(a=>`<div class="status-row"><span>${esc(formatAppDate(a.createdAt))} — ${esc(a.action)}<small class="muted" style="display:block">${esc(a.actor)}</small></span><span class="badge ${a.severity==='Warning'?'warning':'ready'}">${esc(a.severity)}</span></div>`).join('')||'<div class="muted">No admin audit events.</div>'}</div></section>`);}catch(e){shell(`<div class="page-title"><h1>Admin Console</h1></div><section class="panel"><div class="notice invalid-notice">${esc(e.message)}</div></section>`);}}
async function runRetention(dryRun){const msg=document.getElementById('retentionMsg');try{const d=await api('/api/admin/retention',{method:'POST',body:JSON.stringify({userId:state.user?.id,days:Number(document.getElementById('retentionDays').value||90),dryRun})});if(msg){msg.textContent=d.message;msg.className='notice '+(dryRun?'':'success-notice');}}catch(e){if(msg){msg.textContent=e.message;msg.className='notice invalid-notice';}}}

function navigate(p){
  if(!state.loggedIn){interviewerLogin();return;}
  const routes={dashboard,schedule:interviewerSchedule,candidates,sessions,audit,timing:timingLog,feedback:feedbackPage,profile:profilePage,settings,ai:aiPage,operations:operationsCenter,questions:questionBankPage,analytics:analyticsPage,evaluations:evaluationsPage,notifications:notificationsPage,security:securityPage,admin:adminConsole};
  const fn=routes[p];
  routeLoader(true);
  const done=()=>setTimeout(()=>routeLoader(false),180);
  if(typeof fn==='function'){
    Promise.resolve(fn()).catch(e=>{console.error('Navigation error',p,e);toast('Could not open '+p+' page.');}).finally(done);
  } else {console.error('Missing route',p);dashboard();done();}
}


async function interviewerSchedule(){
  state.page="schedule";
  let sessionsData=[];try{const d=await api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=interviewer`);sessionsData=d.sessions||[];}catch(e){}
  shell(`<div class="page-title"><div><h1>Interview Schedule</h1><div class="muted">See which candidate is scheduled, when, and the current status.</div></div></div>
  <section class="panel"><h2>Schedule New Interview</h2>
    <div class="check-grid">
      <div><div class="field"><label>Candidate Name</label><input id="scheduleCandidateName" placeholder="Candidate name"></div><div class="field"><label>Candidate Email</label><input id="scheduleCandidateEmail" type="email" placeholder="candidate@example.com"></div><div class="field"><label>Candidate User ID</label><input id="scheduleCandidateId" placeholder="CAND-1001"></div><div class="field"><label>Candidate Phone</label><input id="scheduleCandidatePhone" type="tel" placeholder="+919876543210"></div></div>
      <div><div class="field"><label>Interview Date & Time</label><input id="scheduleAt" type="datetime-local"></div><div class="field"><label>Interviewer Email</label><input id="scheduleInterviewerEmail" type="email" value="${esc(state.user?.email||'')}"></div><div class="field"><label>Interviewer User ID</label><input id="scheduleInterviewerId" value="${esc(state.user?.id||'')}"></div><div class="field"><label>Interviewer Phone</label><input id="scheduleInterviewerPhone" type="tel" value="${esc(state.user?.phone||'')}"></div></div>
    </div><button class="btn primary" onclick="scheduleInterview()">Schedule & Email Candidate</button><div id="scheduleMsg" class="notice" style="display:none;margin-top:12px"></div>
  </section>
  <section class="panel"><h2>Upcoming & Past Interviews</h2><div class="table-wrap"><table class="table"><thead><tr><th>Candidate</th><th>User ID</th><th>Phone</th><th>Date & Time</th><th>Status</th><th>Result</th><th>Calendar</th></tr></thead><tbody>
  ${sessionsData.length?sessionsData.sort((a,b)=>new Date(a.scheduledAt||0)-new Date(b.scheduledAt||0)).map(s=>`<tr><td>${esc(s.candidateName)}</td><td>${esc(s.candidateId)}</td><td>${esc(s.candidatePhone||'—')}</td><td>${esc(formatAppDate(s.scheduledAt))}</td><td><span class="badge ${['Failed','Rejected','Terminated'].includes(s.status)?'rejected':s.status==='Scheduled'?'pending':'ready'}">${esc(s.status||'Scheduled')}</span></td><td>${esc(s.decision||(['Failed','Rejected','Terminated'].includes(s.status)?'Failed':'—'))}</td><td><a class="btn secondary" href="/api/calendar/${encodeURIComponent(s.id)}.ics">Add to Calendar</a></td></tr>`).join(''):`<tr><td colspan="6" class="muted">No interviews scheduled yet.</td></tr>`}
  </tbody></table></div></section>`);
}


async function candidatePortal(){
  clearCandidateLock();
  state.page="candidateSchedule";
  let sessionsData=[];try{const d=await api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=candidate`);sessionsData=d.sessions||[];}catch(e){}
  const upcoming=sessionsData.filter(s=>s.status==='Scheduled').sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><div><span class="candidate-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><b>HireTrust Candidate Portal</b></span><div style="opacity:.8;margin-top:5px">Welcome, ${esc(state.user?.name||'Candidate')} • ${esc(state.user?.id||'')}</div></div><button class="btn secondary" onclick="candidateLogout()">Sign Out</button></div>
  <div class="candidate-body">
    <div class="cards">
      <div class="card"><div class="label">Profile</div><div class="metric">${esc(state.user?.name||'')}</div><div class="muted">${esc(state.user?.email||state.user?.phone||'')}</div></div>
      <div class="card"><div class="label">Upcoming Interviews</div><div class="metric">${upcoming.length}</div></div>
    </div>
    <section class="panel"><h2>My Interview Schedule</h2><div class="table-wrap"><table class="table"><thead><tr><th>Interviewer</th><th>Phone</th><th>Date & Time</th><th>Session</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${sessionsData.length?sessionsData.sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt)).map(s=>{
      const failed=['Failed','Rejected','Terminated'].includes(s.status);
      const action=s.status==='Scheduled'?`<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary" onclick="candidateStartScheduled('${esc(s.id)}')">Enter Waiting Room</button><a class="btn secondary" href="/api/calendar/${encodeURIComponent(s.id)}.ics">Calendar</a></div>`:s.status==='Waiting Room'?`<span class="badge pending">Waiting for interviewer</span>`:'—';
      return `<tr><td>${esc(s.interviewerName||'Interviewer')}<br><span class="muted">${esc(s.interviewerId||'')}</span></td><td>${esc(s.interviewerPhone||'—')}</td><td>${esc(formatAppDate(s.scheduledAt))}</td><td>${esc(s.id)}</td><td><span class="badge ${failed?'rejected':s.status==='Scheduled'?'pending':'ready'}">${esc(s.status||'Scheduled')}</span></td><td>${action}</td></tr>`;
    }).join(''):`<tr><td colspan="6" class="muted">No interview sessions have been scheduled for you.</td></tr>`}
    </tbody></table></div></section>
    <section class="panel"><h2>My Profile</h2><div class="check-grid"><div><b>${esc(state.user?.name||'')}</b><div class="muted">Username: ${esc(state.user?.id||'')}</div><div class="muted">Email: ${esc(state.user?.email||'Not provided')}</div><div class="muted">Phone: ${esc(state.user?.phone||'Not provided')}</div><div class="muted">Date of Birth: ${esc(state.user?.dob||'Not provided')}</div></div><div>${state.user?.profilePic?`<img src="${state.user.profilePic}" style="width:110px;height:110px;border-radius:50%;object-fit:cover">`:'<div class="notice">No profile picture uploaded.</div>'}</div></div></section>
  </div></div>`;
}
function candidateLogout(){state.loggedIn=false;state.user=null;state.page="login";clearCandidateLock();candidateLogin();}
async function candidateStartScheduled(sessionId){
  state.sessionId=sessionId;
  state.assignedInterviewer=null;
  try{
    const d=await api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=candidate`);
    const s=(d.sessions||[]).find(x=>x.id===sessionId);
    if(s){state.assignedInterviewer={name:s.interviewerName,id:s.interviewerId,email:s.interviewerEmail,phone:s.interviewerPhone||''};state.scheduledAt=s.scheduledAt||null;}
  }catch(e){}
  candidateWaitingRoom(sessionId);
}

async function candidateWaitingRoom(sessionId){
  setCandidateLock(); state.page='candidateWaiting';
  const refresh=async()=>{try{const d=await api(`/api/sessions?userId=${encodeURIComponent(state.user?.id||'')}&role=candidate`);const s=(d.sessions||[]).find(x=>x.id===sessionId);if(s?.admittedAt){clearInterval(window.__htWaitPoll);state.scheduledAt=s.scheduledAt||state.scheduledAt;state.assignedInterviewer={name:s.interviewerName,id:s.interviewerId,email:s.interviewerEmail,phone:s.interviewerPhone||''};identityStep();}}catch(e){}};
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>HireTrust Waiting Room</b><button class="btn secondary" onclick="candidatePortal()">Leave</button></div><div class="candidate-body"><section class="panel"><div class="waiting-hero"><div class="waiting-icon">✓</div><h1>You're checked in</h1><p class="muted">Your interviewer has been notified. Stay on this page until the interviewer admits you.</p><div class="status-row"><span>Interviewer</span><b>${esc(state.assignedInterviewer?.name||'Interviewer')}</b></div><div class="status-row"><span>Session</span><b>${esc(sessionId)}</b></div><div class="status-row"><span>Status</span><span class="badge pending" id="waitingStatus">Waiting for interviewer</span></div></div></section><section class="panel"><h2>Pre-interview checklist</h2><div class="check-grid">${['Camera available','Microphone available','Stable internet recommended','Government ID ready','Quiet private room'].map(x=>`<div class="check"><div class="icon">✓</div><div><b>${x}</b><div class="muted">Ready</div></div></div>`).join('')}</div></section></div></div>`;
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/waiting-room`,{method:'POST'}).catch(()=>{}); clearInterval(window.__htWaitPoll);window.__htWaitPoll=setInterval(refresh,1500); refresh();
}

function candidateLogin(){
  setCandidateLock();state.interviewStarted=false;state.interviewLocked=false;
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><span class="candidate-brand"><img src="assets/hiretrust-logo.png" alt="HireTrust logo"><b>HireTrust Candidate Portal</b></span><div style="opacity:.8;margin-top:5px">Secure Interview Verification</div></div><div class="candidate-body"><div class="form" style="margin:0 auto"><h1>Candidate Login</h1><p class="muted">Sign in using the email or phone number, username and password you registered with.</p><form onsubmit="event.preventDefault();candidateDoLogin()"><div class="field"><label>Email or Phone Number</label><input id="email" required placeholder="candidate@example.com or +919876543210"></div><div class="field"><label>Username / User ID</label><input id="candidateId" required placeholder="CAND-1001"></div><div class="field"><label>Password</label>${passwordInput('password','••••••••')}</div><button class="btn primary" style="width:100%;margin-top:8px">Continue</button></form><div style="display:flex;justify-content:flex-end;margin-top:10px"><button type="button" class="link-btn" onclick="forgotPasswordPage('candidate')">Forgot password?</button></div><div id="candidateLoginMsg" class="notice" style="display:none"></div><div class="auth-links"><button class="link-btn" onclick="signupPage()">Create Account</button><button class="link-btn" onclick="interviewerLogin()">Interviewer Login</button></div></div></div></div>`;
}
async function candidateDoLogin(){
  const msg=document.getElementById('candidateLoginMsg');
  try{
    const contact=document.getElementById('email').value.trim();
    const body={password:password.value,userId:candidateId.value,role:'candidate'};
    if(validEmail(contact))body.email=contact; else if(/^\+[1-9]\d{7,14}$/.test(contact))body.phone=contact; else throw new Error('Enter a valid email address or international phone number.');
    const d=await api('/api/login',{method:'POST',body:JSON.stringify(body)});
    if(d.requiresTwoFactor){state.pending2fa={challengeId:d.challengeId,user:d.user,role:'candidate'};twoFactorPage(true);return;}
    state.user=d.user;state.loggedIn=true;candidatePortal();
  }catch(e){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}
}

function identityStep(){
  setCandidateLock();
  state.verificationStarted=false;
  state.audioConsent=false;
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Start Verification</b><div style="opacity:.8;margin-top:5px">Audio, camera, government ID and room verification</div></div>
  <div class="candidate-body">
    <section class="panel">
      <h2>Before you begin</h2>
      <div class="helper-note">HireTrust will check your microphone input, record interview-verification audio with your consent, capture a live selfie, collect your government ID, and ask you to capture the <b>front, right, left and back</b> of the room.</div>
      <div class="status-list" style="margin-top:14px">
        <div class="status-row"><span>Microphone / voice input</span><span class="badge pending">Required</span></div>
        <div class="status-row"><span>Live camera / selfie</span><span class="badge pending">Required</span></div>
        <div class="status-row"><span>Government ID</span><span class="badge pending">PDF or JPG/JPEG</span></div>
        <div class="status-row"><span>Room verification</span><span class="badge pending">4 views</span></div>
      </div>
      <label class="consent-row" style="display:flex;gap:10px;align-items:flex-start;margin-top:18px">
        <input id="voiceConsent" type="checkbox" style="margin-top:4px">
        <span><b>I consent to microphone/audio capture for interview verification.</b><br><span class="muted">The audio is stored with this interview session and used for security review. You can see the audio level while verification is active.</span></span>
      </label>
      <div id="verificationStartMessage" class="notice" style="margin-top:14px">Check the consent box, then click <b>Start Verification</b>.</div>
      <button class="btn primary" style="margin-top:14px" onclick="beginVerification()">Start Verification</button>
    </section>
  </div></div>`;
}
async function beginVerification(){
  const consent=document.getElementById('voiceConsent');
  if(!consent?.checked){toast('Please provide audio consent before continuing.');return;}
  state.audioConsent=true;state.verificationStarted=true;state.consentRecord={version:'1.0',accepted:true,acceptedAt:new Date().toISOString(),items:['camera monitoring','microphone monitoring','audio recording','eye/gaze monitoring','security event logging']};
  const msg=document.getElementById('verificationStartMessage');
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera and microphone access is not supported by this browser.');
    if(mediaStream)stopCamera();
    mediaStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });
    startAudioRecording(mediaStream);
    renderIdentityVerification();
  }catch(e){
    state.audioConsent=false;state.verificationStarted=false;
    if(msg){msg.textContent=e.name==='NotAllowedError'?'Camera/microphone permission was denied. Allow both permissions and try again.':`Could not start verification: ${e.message}`;msg.className='notice invalid-notice';}
  }
}
function renderIdentityVerification(){
  setCandidateLock();
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Identity Verification</b><div style="opacity:.8;margin-top:5px">Government ID + live selfie + audio check</div></div><div class="candidate-body">
  <div class="grid2">
    <div>
      <h2>Government ID</h2>
      <div class="helper-note">Only <b>PDF</b> or <b>JPG/JPEG</b> files are accepted. If another format is selected, HireTrust will reject it and explain the allowed formats.</div>
      <input type="file" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg" id="idfile" onchange="selectId()">
      <div id="idMessage" class="notice invalid-notice" style="margin-top:10px">No ID selected. PDF or JPG/JPEG only.</div>
      <div id="idStatus" class="muted" style="margin-top:8px">No ID selected</div>
      <div id="idPreview" class="verification-photo" style="margin-top:12px;width:220px;height:220px">No preview</div>
    </div>
    <div>
      <h2>Live Selfie</h2>
      <div class="video-box" id="cameraBox"><video id="cameraPreview" autoplay playsinline muted></video><span class="video-label" id="cameraStatus">● Camera active</span></div>
      <div class="audio-meter"><span>Your voice</span><div class="meter-track"><div id="verificationAudioBar" class="meter-fill"></div><div class="yellow-line"></div></div><span id="verificationAudioValue">0%</span></div>
      <div id="verificationAudioStatus" class="notice success-notice" style="margin-top:10px">Microphone active. Speak a few words so the system can confirm audio input.</div>
    </div>
  </div>
  <div class="helper-note" style="margin-top:18px"><b>Face verification:</b> your live selfie and submitted government ID are saved with the session for identity review. Any similarity assessment is an identity-verification aid and requires interviewer review; HireTrust does not automatically make an employment decision from facial similarity.</div>
  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn danger" onclick="cancelVerification()">Cancel</button><button class="btn primary" onclick="verifyIdentityWithCamera()">Continue to Room Verification</button></div>
  </div></div>`;
  const video=document.getElementById('cameraPreview');
  if(video&&mediaStream){video.srcObject=mediaStream;video.style.display='block';}
  startLocalAudioMeter(mediaStream,'verificationAudioBar','verificationAudioValue');
  startVerificationVoiceCheck(mediaStream);
}
function startVerificationVoiceCheck(stream){
  if(!stream?.getAudioTracks().length)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const ctx=new AC(),source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();
    analyser.fftSize=1024;source.connect(analyser);const data=new Uint8Array(analyser.fftSize);
    let quiet=0;
    const tick=()=>{
      if(!state.verificationStarted)return;
      analyser.getByteTimeDomainData(data);let sum=0;
      for(const v of data){const n=(v-128)/128;sum+=n*n;}
      const rms=Math.sqrt(sum/data.length);
      const st=document.getElementById('verificationAudioStatus');
      if(rms<0.006){quiet++;if(st){st.textContent=`No audio detected (${quiet}s). Please speak clearly and check your microphone.`;st.className='notice invalid-notice';}}
      else {quiet=0;if(st){st.textContent='Audio detected. Voice recording is active.';st.className='notice success-notice';}}
      verificationAudioMeterFrame=requestAnimationFrame(tick);
    };tick();
  }catch(e){console.warn('verification audio check',e);}
}
function stopVerificationAudio(){
  state.verificationStarted=false;
  if(verificationAudioMeterFrame)cancelAnimationFrame(verificationAudioMeterFrame);
  verificationAudioMeterFrame=null;
  if(state.audioRecorder){try{state.audioRecorder.stop();}catch(e){}state.audioRecorder=null;}
  if(verificationAudioStream){verificationAudioStream.getTracks().forEach(t=>t.stop());verificationAudioStream=null;}
}
function cancelVerification(){
  stopVerificationAudio();stopCamera();state.audioConsent=false;state.sessionId=null;candidatePortal();
}

function selectId(){
  const f=document.getElementById('idfile'),out=document.getElementById('idStatus'),msg=document.getElementById('idMessage'),preview=document.getElementById('idPreview');
  if(!f||!f.files.length)return;
  const file=f.files[0];
  const ok=['application/pdf','image/jpeg'].includes(file.type) && /\.(pdf|jpe?g)$/i.test(file.name);
  if(!ok){
    f.value='';state.idFileName='';state.idDocumentData=null;
    if(out)out.textContent='No ID selected';
    if(preview)preview.textContent='No preview';
    if(msg){msg.textContent='Invalid file. Only PDF or JPG/JPEG files are accepted. PNG, WEBP and other formats are not allowed.';msg.className='notice invalid-notice';}
    toast('Invalid government ID format. Please upload PDF or JPG/JPEG only.');
    return;
  }
  if(file.size>1_000_000){
    f.value='';state.idFileName='';state.idDocumentData=null;
    if(msg){msg.textContent='Government ID is too large. Please use a file under 1 MB.';msg.className='notice invalid-notice';}
    toast('Government ID is too large. Please use a file under 1 MB.');
    return;
  }
  state.idFileName=file.name;
  const reader=new FileReader();
  reader.onload=()=>{
    state.idDocumentData=reader.result;
    if(out)out.textContent=`Selected: ${file.name}`;
    if(msg){msg.textContent='Valid government ID selected.';msg.className='notice success-notice';}
    if(preview){
      if(file.type==='image/jpeg')preview.innerHTML=`<img src="${reader.result}" alt="Government ID preview">`;
      else preview.innerHTML=`<iframe src="${reader.result}" title="Government ID PDF" style="width:100%;height:100%;border:0"></iframe>`;
    }
  };
  reader.readAsDataURL(file);
}
async function startCamera(){const msg=document.getElementById("cameraMessage"),status=document.getElementById("cameraStatus"),video=document.getElementById("cameraPreview"),placeholder=document.getElementById("cameraPlaceholder");if(!navigator.mediaDevices?.getUserMedia){msg.textContent="Camera access is not supported by this browser.";status.textContent="Camera unsupported";return;}try{if(mediaStream)stopCamera();mediaStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=mediaStream;video.style.display="block";placeholder.style.display="none";status.textContent="● Camera active";msg.textContent="Camera connected successfully.";msg.className="notice success-notice";}catch(err){let reason="Camera permission was denied or unavailable.";if(err.name==="NotAllowedError")reason="Camera permission was denied. Allow camera access in the browser and try again.";if(err.name==="NotFoundError")reason="No camera was found.";if(err.name==="NotReadableError")reason="The camera is already being used by another application.";if(err.name==="SecurityError")reason="Camera access requires HTTPS or localhost.";msg.textContent=reason;status.textContent="Camera unavailable";}}
function stopCamera(){if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;}const video=document.getElementById("cameraPreview"),placeholder=document.getElementById("cameraPlaceholder"),status=document.getElementById("cameraStatus");if(video){video.srcObject=null;video.style.display="none";}if(placeholder)placeholder.style.display="block";if(status)status.textContent="Camera stopped";}
async function verifyIdentityWithCamera(){
  const f=document.getElementById('idfile');
  if(!f?.files.length){toast('Please select your government ID first.');return;}
  const file=f.files[0];
  if(!['application/pdf','image/jpeg'].includes(file.type)||!/\.(pdf|jpe?g)$/i.test(file.name)){toast('Only PDF or JPG/JPEG government ID files are accepted.');return;}
  const video=document.getElementById('cameraPreview');
  if(!mediaStream||!video||video.readyState<2){toast('Camera is not ready. Please wait for the live preview.');return;}
  if(!state.audioConsent){toast('Audio consent is required before continuing.');return;}
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').drawImage(video,0,0,640,480);
  state.selfiePhoto=canvas.toDataURL('image/jpeg',0.82);
  state.faceMatchStatus='Interviewer review required';
  state.faceMatchScore=null;
  await saveSession('Identity Verification');
  toast('Selfie and government ID captured. Continue to room verification.');
  // Keep the audio recorder alive during the four room captures, but replace the camera track.
  if(mediaStream){mediaStream.getVideoTracks().forEach(t=>t.stop());mediaStream=null;}
  roomStep();
}
async function startRoomCamera(){
  const video=document.getElementById("roomCameraPreview"),placeholder=document.getElementById("roomCameraPlaceholder"),msg=document.getElementById("roomMessage");
  try{
    if(mediaStream)stopCamera();
    mediaStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},audio:false});
    if(video){video.srcObject=mediaStream;video.style.display="block";}
    if(placeholder)placeholder.style.display="none";
    if(msg){msg.textContent="Camera ready. Capture Front, Right, Left and Back separately.";msg.className="notice success-notice";}
  }catch(e){if(msg)msg.textContent="Could not start room camera. Allow camera access and try again.";}
}
function roomImageSignature(canvas){
  const w=32,h=24,tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;
  const tc=tmp.getContext("2d");tc.drawImage(canvas,0,0,w,h);
  const px=tc.getImageData(0,0,w,h).data, sig=[];
  for(let i=0;i<px.length;i+=4){sig.push(((px[i]*0.299)+(px[i+1]*0.587)+(px[i+2]*0.114))/255);}
  return sig;
}
function roomSignatureDistance(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return 1;
  let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);
  return sum/a.length;
}
function captureRoomView(view){
  const video=document.getElementById("roomCameraPreview"),msg=document.getElementById("roomMessage");
  if(!mediaStream||!video||video.readyState<2){if(msg)msg.textContent="Start the room camera first.";return;}
  const canvas=document.createElement("canvas");canvas.width=640;canvas.height=360;canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
  const signature=roomImageSignature(canvas);
  const duplicate=state.roomHashes.some(prev=>roomSignatureDistance(prev,signature)<0.075);
  if(duplicate){if(msg){msg.textContent=`${view} view is too similar to a previous capture. Turn the camera to a clearly different side and capture again.`;msg.className='notice invalid-notice';}toast('Duplicate room image detected. Capture a different side.');return;}
  state.roomHashes.push(signature);state.roomViews[view]=canvas.toDataURL("image/jpeg",0.78);
  const preview=document.getElementById(`preview-${view}`),stateEl=document.getElementById(`state-${view}`);
  if(preview)preview.innerHTML=`<img src="${state.roomViews[view]}" alt="${view} room view">`;
  if(stateEl){stateEl.textContent="Captured & monitored";stateEl.className="room-state captured";}
  if(Object.keys(state.roomViews).length===4){
    const btn=document.getElementById("roomContinue");if(btn)btn.disabled=false;
    if(msg){msg.textContent="All four room views captured. The interviewer can review Front, Right, Left and Back separately.";msg.className="notice success-notice";}
  }else if(msg)msg.textContent=`${view} view captured. ${4-Object.keys(state.roomViews).length} view(s) remaining.`;
  saveSession();
}
function roomStep(){
  setCandidateLock();
  state.roomViews={};state.roomHashes=[];
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Room Verification</b><div style="opacity:.8;margin-top:5px">Capture four separate views before the interview</div></div><div class="candidate-body">
  <div class="helper-note">Start the room camera and capture the room in this order: <b>Front → Right → Left → Back</b>. The interviewer will see all four images.</div>
  <div class="video-box room-video" style="margin-top:16px"><video id="roomCameraPreview" autoplay playsinline muted></video><div id="roomCameraPlaceholder">Room camera is not started</div></div>
  <div class="room-monitor-grid" style="margin-top:16px">${["Front","Right","Left","Back"].map(v=>`<div class="room-monitor-card"><div class="room-preview" id="preview-${v}"><span>No ${v} capture</span></div><b>${v} View</b><span class="room-state" id="state-${v}">Waiting</span><button class="btn secondary" onclick="captureRoomView('${v}')">Capture ${v}</button></div>`).join('')}</div>
  <div id="roomMessage" class="notice" style="margin-top:14px">Click <b>Start Room Camera</b>.</div>
  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px"><button class="btn secondary" onclick="startRoomCamera()">Start Room Camera</button><button id="roomContinue" class="btn primary" disabled onclick="stopRoomCameraAndContinue()">Continue to Device Verification</button></div>
  </div></div>`;
}
function stopRoomCameraAndContinue(){if(mediaStream)stopCamera();deviceStep();}

async function saveSession(statusOverride){if(!state.user)return;try{state.sessionId=state.sessionId||`PG-${Math.floor(Math.random()*90000+10000)}`;await api('/api/sessions',{method:'POST',body:JSON.stringify({sessionId:state.sessionId,candidateId:state.user.id,candidateName:state.user.name,candidateEmail:state.user.email,candidatePhone:state.user.phone||'',interviewerEmail:state.assignedInterviewer?.email||'',interviewerPhone:state.assignedInterviewer?.phone||'',roomViews:state.roomViews,status:statusOverride||'Room Verification',decision:state.decision||null,warnings:state.warnings,violations:state.violations||[],audioConsent:state.audioConsent,interviewerName:state.assignedInterviewer?.name||state.user?.interviewerName||'',interviewerId:state.assignedInterviewer?.id||'',startedAt:state.sessionStartedAt,endedAt:state.sessionEndedAt||null,reason:state.sessionReason||'',scheduledAt:state.scheduledAt||null,facePhoto:state.selfiePhoto||null,faceMatchScore:state.faceMatchScore,faceMatchStatus:state.faceMatchStatus,idFileName:state.idFileName,idDocument:state.idDocumentData||null,consentRecord:state.consentRecord||null,createdBy:state.user?.id||''})});}catch(e){console.warn(e);}}
function deviceStep(){setCandidateLock();app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Device Verification</b></div><div class="candidate-body"><div class="status-list" id="deviceList"><div class="status-row"><span>Camera permission</span><span class="badge ready">Ready</span></div><div class="status-row"><span>Microphone permission</span><span class="badge ready">Ready</span></div><div class="status-row"><span>Display configuration</span><span class="badge ready">1 Display</span></div><div class="status-row"><span>Full-screen readiness</span><span class="badge ready">Ready</span></div><div class="status-row"><span>Phone/network check</span><span id="phoneStatus" class="badge pending">Checking</span></div></div><div class="helper-note"><b>Phone/network verification:</b> A normal website cannot measure the physical distance to every phone on Wi-Fi or reliably tell whether a Wi-Fi connection is a mobile hotspot. For stronger device checks, the candidate may open the session's companion phone page on each phone that is present. The system can then report companion devices and their network information to the interviewer. It does not claim a 50-meter distance from Wi-Fi alone.</div><div class="helper-note"><b>Background applications:</b> A normal browser cannot safely close arbitrary applications. A secure browser or signed desktop agent is required for enforced application blocking.</div><button class="btn primary" onclick="readyStep()">Complete Device Check</button></div></div>`;startPhonePresenceMonitor();}
function readyStep(){setCandidateLock();app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Ready for Interview</b></div><div class="candidate-body"><div class="check-grid">${["Identity verified","Room verified","Single display check","Camera ready","Microphone ready","Security monitoring enabled"].map(x=>`<div class="check"><div class="icon">✓</div><div><b>${x}</b><div class="muted">Passed</div></div></div>`).join('')}</div><div class="helper-note">When you click <b>Start Interview</b>, HireTrust requests browser full-screen in the same user action. The interview starts only if full-screen is granted. Standard browsers cannot enter full-screen silently without a user gesture.</div><div style="display:flex;gap:10px;align-items:center;justify-content:flex-end"><span id="fsReadyStatus" class="badge pending">Full screen will activate on start</span><button class="btn success" onclick="startInterview()">Start Interview</button></div></div></div>`;}
async function startInterview(){
  if(!state.audioConsent){toast('Audio consent is required before the interview.');return;}
  try{await document.documentElement.requestFullscreen();}catch(e){toast('Full-screen permission is required. Please allow full-screen and start again.');return;}
  if(!document.fullscreenElement){toast('Interview cannot start unless full-screen mode is active.');return;}
  state.interviewStarted=true;state.interviewLocked=true;state.warnings=0;state.violations=[];state.violationCount=0;state.sessionStartedAt=new Date().toISOString();state.sessionEndedAt=null;state.sessionReason='';setCandidateLock();history.pushState({candidateInterview:true},'', '#interview');
  app.innerHTML=`<div class="candidate-shell" style="max-width:1200px"><div class="candidate-header"><b>Interview In Progress — Full Screen Required</b><span style="float:right">Session: ${esc(state.sessionId)}</span></div><div class="candidate-body"><div class="security-banner">🔒 Do not switch tabs, windows, applications or exit full-screen. Any visibility change or full-screen exit immediately ends the interview.</div><div class="interview-ai"><button class="ai-chat-toggle" onclick="toggleInterviewAI()">✦ Interview AI Assistant</button><div id="interviewAiPanel" class="ai-chat-panel" style="display:none"><div class="ai-chat-head"><b>HireTrust Interview Assistant</b><span>Interview only</span></div><div id="aiChatMessages" class="ai-chat-messages"><div class="ai-msg bot">I can help with interview instructions, timing, verification steps and technical issues. I cannot answer interview questions for you.</div></div><div class="ai-chat-input"><input id="aiChatInput" placeholder="Ask about the interview…" onkeydown="if(event.key==='Enter')sendInterviewAI()"><button class="btn primary" onclick="sendInterviewAI()">Send</button></div></div></div><div class="call-grid"><section class="panel call-panel"><div class="call-title"><div><b id="interviewerDisplayName">Interviewer</b><div class="muted">User ID: <span id="interviewerDisplayId">—</span></div></div><span class="badge ready">Interviewer</span></div><div class="video-box call-video"><video id="interviewerRemoteVideo" autoplay playsinline></video><div id="interviewerRemotePlaceholder">Waiting for interviewer camera…</div></div><div class="audio-meter"><span>Interviewer audio</span><div class="meter-track"><div id="interviewerAudioBar" class="meter-fill"></div><div class="yellow-line"></div></div><span id="interviewerAudioValue">0%</span><span id="interviewerAudioStatus" class="badge pending">Connecting</span></div><button class="btn secondary audio-enable-btn" type="button" onclick="enableRemoteInterviewAudio('interviewerRemoteVideo')">🔊 Enable interviewer audio</button></section><section class="panel call-panel"><div class="call-title"><div><b>${esc(state.user?.name||'Candidate')}</b><div class="muted">User ID: ${esc(state.user?.id||'—')}</div></div><span class="badge ready">You</span></div><div class="video-box call-video"><video id="interviewCameraPreview" autoplay playsinline muted></video><span class="video-label">● Monitoring</span></div><div class="audio-meter"><span>Your audio</span><div class="meter-track"><div id="candidateAudioBar" class="meter-fill"></div><div class="yellow-line"></div></div><span id="candidateAudioValue">0%</span><span id="candidateAudioStatus" class="badge pending">Connecting</span></div></section></div><div class="live-lower-grid"><div>${chatPanelHtml('Interview Chat')}<div class="grid2"><div><div class="notice success-notice">Camera and microphone monitoring are active. Interview audio is being recorded because you provided consent.</div><button class="btn danger" onclick="completeInterview()">End Interview</button></div><div class="panel" style="margin:0"><h2>Live Verification</h2><div class="status-list"><div class="status-row"><span>Face presence</span><span class="badge ready">Present</span></div><div class="status-row"><span>Microphone</span><span class="badge ready" id="micLiveStatus">Active</span></div><div class="status-row"><span>Display count</span><span class="badge ready">1</span></div><div class="status-row"><span>Full screen</span><span class="badge ready" id="fullScreenLive">Active</span></div><div class="status-row"><span>Tab/window activity</span><span class="badge ready">0 violations</span></div><div class="status-row"><span>Eye/gaze monitoring</span><span class="badge pending" id="eyeStatus">Loading</span></div><div class="status-row"><span>Phone/network companions</span><span class="badge pending" id="phoneStatus">Checking</span></div><div class="status-row"><span>Face verification</span><span class="badge warning">Interviewer review required</span></div></div><div class="helper-note">Face-photo comparison is an identity-verification aid. A low similarity result is flagged for interviewer review rather than automatically deciding an employment outcome.</div></div></div></div></div>`;
  await startInterviewMedia();await saveSession('Interview In Progress');try{await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/consent`,{method:'POST',body:JSON.stringify(state.consentRecord||{version:'1.0',accepted:true,items:[]})});}catch(e){}startInterviewGuards();startVoiceMonitor();startEyeMonitoring();startPhonePresenceMonitor();startConnectionTelemetry();startChatPolling();
}
async function startInterviewMedia(){try{stopVerificationAudio();if(mediaStream)stopCamera();mediaStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});const video=document.getElementById('interviewCameraPreview');if(video){video.srcObject=mediaStream;video.style.display='block';}startAudioRecording(mediaStream);startLocalAudioMeter(mediaStream,'candidateAudioBar','candidateAudioValue','candidateAudioStatus');await setupCandidatePeer();startCandidateInterviewerInfoPolling();}catch(e){toast('Camera and microphone are required for the interview. The session will end.');setTimeout(()=>terminateInterview('Camera or microphone permission was unavailable.'),300);}}
async function startEyeMonitoring(){
  const video=document.getElementById('interviewCameraPreview');
  if(!video || !state.interviewStarted)return;
  const status=document.getElementById('eyeStatus');
  if(status){status.textContent='Loading eye monitoring';status.className='badge pending';}
  try{
    const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
    const {FaceLandmarker,FilesetResolver}=vision;
    const fileset=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    const landmarker=await FaceLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},runningMode:'VIDEO',numFaces:1});
    state.eyeMonitor={landmarker,lastVideoTime:-1};
    if(status){status.textContent='Monitoring';status.className='badge ready';}
    const loop=async()=>{
      if(!state.interviewStarted||!state.eyeMonitor)return;
      try{
        if(video.readyState>=2 && video.currentTime!==state.eyeMonitor.lastVideoTime){
          state.eyeMonitor.lastVideoTime=video.currentTime;
          const r=landmarker.detectForVideo(video,performance.now());
          const lm=r.faceLandmarks?.[0];
          if(lm){
            // Iris-based gaze estimate. Values near the eye centers are considered on-screen.
            const gaze=eyeGazeEstimate(lm);
            const away=gaze.horizontal==='left'||gaze.horizontal==='right'||gaze.vertical==='up';
            if(away){
              if(!state.eyeAwaySince)state.eyeAwaySince=Date.now();
              const seconds=(Date.now()-state.eyeAwaySince)/1000;
              if(status){status.textContent=`Looking ${gaze.horizontal==='center'?'away':gaze.horizontal}`;status.className=seconds>=2.5?'badge warning':'badge pending';}
              if(seconds>=2.5 && Date.now()-state.lastEyeAlertAt>15000){
                state.lastEyeAlertAt=Date.now();
                state.eyeAwayCount++;state.eyeLastDirection=`${gaze.horizontal}/${gaze.vertical}`;
                state.warnings++;state.violations=state.violations||[];
                state.violations.push({time:new Date().toISOString(),reason:'Eye/gaze attention alert: candidate looking away from screen'});
                await sendMonitorEvent('Eye/gaze attention alert',{direction:gaze.horizontal,vertical:gaze.vertical,durationSeconds:Number(seconds.toFixed(1)),alertCount:state.eyeAwayCount},'Warning');
                toast('Warning: please keep your eyes on the interview screen.');
                saveSession('Warning Issued');
              }
            }else{
              state.eyeAwaySince=0;if(status){status.textContent='Looking at screen';status.className='badge ready';}
            }
          }
        }
      }catch(e){console.warn('eye monitor',e)}
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }catch(e){
    console.warn('Eye monitoring unavailable',e);
    if(status){status.textContent='Unavailable';status.className='badge warning';}
    await sendMonitorEvent('Eye monitoring unavailable',{reason:'Face landmark model could not be loaded'},'Info');
  }
}
function eyeGazeEstimate(lm){
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  // FaceLandmarker iris indices: 468 left iris center, 473 right iris center.
  const leftIris=lm[468],rightIris=lm[473];
  const leftOuter=lm[33],leftInner=lm[133],rightInner=lm[362],rightOuter=lm[263];
  const leftTop=lm[159],leftBottom=lm[145],rightTop=lm[386],rightBottom=lm[374];
  const lx=leftIris? (leftIris.x-leftOuter.x)/Math.max(.0001,(leftInner.x-leftOuter.x)):0.5;
  const rx=rightIris? (rightIris.x-rightInner.x)/Math.max(.0001,(rightOuter.x-rightInner.x)):0.5;
  const ly=leftIris? (leftIris.y-leftTop.y)/Math.max(.0001,(leftBottom.y-leftTop.y)):0.5;
  const ry=rightIris? (rightIris.y-rightTop.y)/Math.max(.0001,(rightBottom.y-rightTop.y)):0.5;
  const x=(lx+rx)/2,y=(ly+ry)/2;
  return {horizontal:x<0.32?'left':x>0.68?'right':'center',vertical:y<0.28?'up':y>0.78?'down':'center'};
}
function toggleInterviewAI(){const p=document.getElementById('interviewAiPanel');if(p)p.style.display=p.style.display==='none'?'block':'none';}
function sendInterviewAI(){const input=document.getElementById('aiChatInput'),box=document.getElementById('aiChatMessages');if(!input||!box)return;const q=input.value.trim();if(!q)return;box.insertAdjacentHTML('beforeend',`<div class="ai-msg user">${esc(q)}</div>`);input.value='';const t=q.toLowerCase();let a='Please contact the interviewer for anything outside the interview process.';if(/start|begin|when/.test(t))a='Your interview starts after verification is complete. Follow the on-screen instructions and remain in full-screen mode.';else if(/camera|selfie/.test(t))a='Keep your face visible, allow camera access, and make sure your camera preview is clear.';else if(/microphone|audio|voice/.test(t))a='Keep your microphone enabled and speak clearly. A live audio level is shown during verification and the interview.';else if(/room|front|back|left|right/.test(t))a='Capture four clearly different room views: Front, Right, Left and Back.';else if(/fullscreen|tab|window/.test(t))a='Do not switch tabs/windows or exit full-screen. A visibility or full-screen violation can end the session.';else if(/schedule|time/.test(t))a=`Your scheduled interview time is ${state.scheduledAt?formatAppDate(state.scheduledAt):'shown in your schedule'}.`;else if(/technical|error|problem/.test(t))a='If a camera or microphone problem occurs, check browser permissions and use Chrome or Edge on localhost/HTTPS.';setTimeout(()=>{box.insertAdjacentHTML('beforeend',`<div class="ai-msg bot">${esc(a)}</div>`);box.scrollTop=box.scrollHeight;},150);}

function stopEyeMonitoring(){if(state.eyeMonitor?.landmarker){try{state.eyeMonitor.landmarker.close?.()}catch(e){}}state.eyeMonitor=null;state.eyeAwaySince=0;}

function startInterviewGuards(){document.addEventListener('visibilitychange',handleVisibility);document.addEventListener('fullscreenchange',handleFullscreenChange);window.addEventListener('blur',handleWindowBlur);}
function removeInterviewGuards(){document.removeEventListener('visibilitychange',handleVisibility);document.removeEventListener('fullscreenchange',handleFullscreenChange);window.removeEventListener('blur',handleWindowBlur);stopPhonePresenceMonitor();stopEyeMonitoring();}
function handleVisibility(){if(document.hidden&&state.interviewStarted)violationAndTerminate('Tab/window switch detected');}
function handleWindowBlur(){if(state.interviewStarted&&!document.hidden)violationAndTerminate('Interview window lost focus');}
function handleFullscreenChange(){if(state.interviewStarted&&!document.fullscreenElement){violationAndTerminate('Full-screen mode exited');}else{const el=document.getElementById('fullScreenLive');if(el){el.textContent='Active';el.className='badge ready';}}}
function violationAndTerminate(reason){if(!state.interviewStarted)return;state.violationCount++;state.warnings++;state.violations=state.violations||[];state.violations.push({time:new Date().toISOString(),reason});toast(`Session terminated: ${reason}`);terminateInterview(reason);}
function simulateWarning(){violationAndTerminate('Focus/tab violation');}
function completeInterview(){terminateInterview('Interview completed by candidate.');}
function stopConnectionTelemetry(){clearInterval(state.connectionTimer);state.connectionTimer=null;}
function startConnectionTelemetry(){stopConnectionTelemetry();const send=async()=>{if(!state.interviewStarted||!state.sessionId)return;const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;try{await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/connection`,{method:'POST',body:JSON.stringify({online:navigator.onLine,rtt:c?.rtt||0,downlink:c?.downlink||0,type:c?.effectiveType||c?.type||'unknown'})});}catch(e){}};send();state.connectionTimer=setInterval(send,10000);}
function stopInterviewMedia(){stopConnectionTelemetry();stopChatPolling();stopAudioMeters();
  if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;}
  if(state.audioRecorder&&state.audioRecorder.state!=='inactive')state.audioRecorder.stop();
  state.audioRecorder=null;clearInterval(state.voiceTimer);state.voiceTimer=null;clearInterval(state.signalTimer);state.signalTimer=null;
  if(state.peer){try{state.peer.close();}catch(e){}state.peer=null;}
  if(state.interviewerCameraStream){state.interviewerCameraStream.getTracks().forEach(t=>t.stop());state.interviewerCameraStream=null;}
}
function startAudioRecording(stream){if(!window.MediaRecorder||!stream.getAudioTracks().length)return;try{const audioOnly=new MediaStream(stream.getAudioTracks());const opts=MediaRecorder.isTypeSupported('audio/webm')?{mimeType:'audio/webm'}:{};state.audioRecorder=new MediaRecorder(audioOnly,opts);state.audioRecorder.ondataavailable=e=>{if(e.data&&e.data.size)storeAudioChunk(e.data);};state.audioRecorder.start(10000);}catch(e){console.warn('Audio recording unavailable',e);}}
async function storeAudioChunk(blob){if(!state.sessionId||!state.audioConsent)return;try{const buf=await blob.arrayBuffer();let binary='';const bytes=new Uint8Array(buf);const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/audio`,{method:'POST',body:JSON.stringify({mimeType:blob.type||'audio/webm',data:btoa(binary)})});}catch(e){console.warn('Audio chunk storage failed',e);}}
function stopChatPolling(){clearInterval(state.chatTimer);state.chatTimer=null;}
function chatPanelHtml(title='Interview Chat'){
  return `<section class="panel live-chat-panel"><div class="section-head"><div><h2 style="margin:0">💬 ${esc(title)}</h2><p class="muted" style="margin:4px 0 0">Private communication for this interview session.</p></div><span class="badge ready" id="chatConnectionStatus">Connected</span></div><div id="interviewChatMessages" class="interview-chat-messages"><div class="muted chat-empty">No messages yet. Use this chat for interview instructions or technical communication.</div></div><div class="interview-chat-compose"><input id="interviewChatInput" maxlength="1000" autocomplete="off" placeholder="Type a message…" onkeydown="if(event.key==='Enter'){event.preventDefault();sendInterviewChat();}"><button class="btn primary" type="button" onclick="sendInterviewChat()">Send</button></div></section>`;
}
function renderInterviewChat(messages){
  const box=document.getElementById('interviewChatMessages'); if(!box)return;
  const list=Array.isArray(messages)?messages:[];
  if(!list.length){box.innerHTML='<div class="muted chat-empty">No messages yet. Use this chat for interview instructions or technical communication.</div>';return;}
  box.innerHTML=list.map(m=>{const mine=String(m.senderId||'').toUpperCase()===String(state.user?.id||'').toUpperCase();const role=String(m.senderRole||'').toLowerCase()==='candidate'?'Candidate':'Interviewer';return `<div class="chat-message ${mine?'mine':'theirs'}"><div class="chat-message-meta"><b>${esc(m.senderName||role)}</b><span>${esc(m.createdAt?formatAppDate(m.createdAt):'')}</span></div><div class="chat-message-bubble">${esc(m.message||'')}</div></div>`;}).join('');
  box.scrollTop=box.scrollHeight;
}
async function loadInterviewChat(){
  const sid=state.sessionId||state.interviewerSessionId;if(!sid)return;
  try{
    const d=await api(`/api/sessions/${encodeURIComponent(sid)}/chat`);
    renderInterviewChat(d.messages||[]);
    const msgs=Array.isArray(d.messages)?d.messages:[]; msgs.forEach(m=>state.chatSeen.add(m.id));
    const st=document.getElementById('chatConnectionStatus');if(st){st.textContent='Live';st.className='badge ready';}
  }catch(e){const st=document.getElementById('chatConnectionStatus');if(st){st.textContent='Offline';st.className='badge warning';}}
}
function startChatPolling(){
  stopChatPolling(); loadInterviewChat();
  state.chatTimer=setInterval(loadInterviewChat,1500);
}
async function sendInterviewChat(){
  const input=document.getElementById('interviewChatInput');const sid=state.sessionId||state.interviewerSessionId;if(!input||!sid)return;
  const message=input.value.trim();if(!message)return;
  input.disabled=true;
  try{
    await api(`/api/sessions/${encodeURIComponent(sid)}/chat`,{method:'POST',body:JSON.stringify({senderId:state.user?.id||'',senderName:state.user?.name||'User',senderRole:state.user?.role||'',message})});
    input.value=''; await loadInterviewChat(); input.focus();
  }catch(e){toast(`Chat message could not be sent: ${e.message}`);}
  finally{input.disabled=false;}
}
function enableRemoteInterviewAudio(videoId){const v=document.getElementById(videoId);if(!v)return;v.muted=false;v.volume=1;const p=v.play?.();if(p&&typeof p.catch==='function')p.catch(()=>{});toast('Interview audio enabled.');}
function setAudioStatus(id,text,kind='ready'){const el=document.getElementById(id);if(el){el.textContent=text;el.className=`badge ${kind}`;}}
function stopAudioMeters(){Object.values(state.audioMeters||{}).forEach(x=>{try{cancelAnimationFrame(x.frame);}catch(e){}try{x.ctx?.close?.();}catch(e){}});state.audioMeters={};}

function startLocalAudioMeter(stream,barId='candidateAudioBar',valueId='candidateAudioValue',statusId='candidateAudioStatus'){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC||!stream)return;
    const old=state.audioMeters[barId];if(old){try{cancelAnimationFrame(old.frame);}catch(e){}try{old.ctx.close();}catch(e){}}
    const ctx=new AC();const source=ctx.createMediaStreamSource(stream);const analyser=ctx.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
    const data=new Uint8Array(analyser.fftSize);const bar=document.getElementById(barId),val=document.getElementById(valueId);
    const tick=()=>{
      if(!state.audioMeters[barId])return;
      analyser.getByteTimeDomainData(data);let sum=0;for(const v of data){const n=(v-128)/128;sum+=n*n;}
      const rms=Math.sqrt(sum/data.length);const pct=Math.min(100,Math.round(rms*500));
      if(bar){bar.style.setProperty('--level',pct);bar.classList.toggle('hot',pct>70);}
      if(val)val.textContent=pct+'%';
      const track=document.getElementById(statusId);
      if(track){
        if(rms>=0.018){track.textContent='Speaking';track.className='badge ready';}
        else if(rms>=0.006){track.textContent='Audio detected';track.className='badge ready';}
        else{track.textContent='Connected';track.className='badge pending';}
      }
      state.audioMeters[barId].frame=requestAnimationFrame(tick);
    };
    state.audioMeters[barId]={ctx,frame:0};tick();
  }catch(e){console.warn('meter',e);setAudioStatus(statusId,'Unavailable','warning');}
}
function startRemoteAudioMeter(stream,barId,valueId,statusId){
  if(!stream)return;
  const track=stream.getAudioTracks?.()[0];
  if(!track){setAudioStatus(statusId,'No audio track','warning');return;}
  setAudioStatus(statusId,track.enabled?'Connected':'Muted',track.enabled?'pending':'warning');
  startLocalAudioMeter(stream,barId,valueId,statusId);
  track.onmute=()=>setAudioStatus(statusId,'Muted','warning');
  track.onunmute=()=>setAudioStatus(statusId,'Connected','pending');
  track.onended=()=>setAudioStatus(statusId,'Audio ended','warning');
}
function startVoiceMonitor(){
  if(!mediaStream)return;
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();const source=ctx.createMediaStreamSource(mediaStream);const analyser=ctx.createAnalyser();analyser.fftSize=1024;source.connect(analyser);const data=new Uint8Array(analyser.fftSize);
    state.voiceTimer=setInterval(()=>{
      if(!state.interviewStarted)return;
      analyser.getByteTimeDomainData(data);let sum=0;for(const v of data){const n=(v-128)/128;sum+=n*n;}const rms=Math.sqrt(sum/data.length);
      const ms=document.getElementById('micLiveStatus'),as=document.getElementById('audioAlertStatus');
      if(rms<0.006){state.silentSeconds++;if(ms){ms.textContent='No audio';ms.className='badge warning';}if(as){as.textContent=`Silence ${state.silentSeconds}s`;as.className='badge warning';}
        if(state.silentSeconds>=5&&Date.now()-state.lastVoiceAlertAt>15000){state.lastVoiceAlertAt=Date.now();state.warnings++;state.violations=state.violations||[];state.violations.push({time:new Date().toISOString(),reason:'Prolonged silence / no audio detected from candidate microphone'});sendMonitorEvent('Candidate microphone silence',{durationSeconds:state.silentSeconds},'Warning');toast('Warning: no candidate audio detected. Please check the microphone and speak clearly.');saveSession('Warning Issued');}
      }else{state.silentSeconds=0;if(ms){ms.textContent=rms>=0.018?'Speaking':'Active';ms.className='badge ready';}if(as){as.textContent=rms>=0.018?'Candidate speaking':'Listening';as.className='badge ready';}}
    },1000);
  }catch(e){console.warn(e);}
}
async function sendSignal(type,payload){if(!state.sessionId&&!state.interviewerSessionId)return;const sid=state.sessionId||state.interviewerSessionId;try{await api(`/api/webrtc/${encodeURIComponent(sid)}`,{method:'POST',body:JSON.stringify({from:state.signalRole,type,payload})});}catch(e){console.warn('signaling',e);}}
async function getSignals(){const sid=state.sessionId||state.interviewerSessionId;if(!sid)return[];try{return (await api(`/api/webrtc/${encodeURIComponent(sid)}`)).signals||[];}catch(e){return[];}}
function addPeerTrack(targetId,stream){const v=document.getElementById(targetId);if(v){v.srcObject=stream;v.style.display='block';const p=document.getElementById(targetId==='interviewerRemoteVideo'?'interviewerRemotePlaceholder':'interviewerVideoPlaceholder');if(p)p.style.display='none';}}
async function setupCandidatePeer(){
  if(!window.RTCPeerConnection||!state.sessionId)return;
  state.signalRole='candidate';state.receivedSignals=new Set();
  state.peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  mediaStream.getTracks().forEach(t=>state.peer.addTrack(t,mediaStream));
  state.peer.ontrack=e=>{addPeerTrack('interviewerRemoteVideo',e.streams[0]);if(e.streams[0])startRemoteAudioMeter(e.streams[0],'interviewerAudioBar','interviewerAudioValue','interviewerAudioStatus');};
  state.peer.onicecandidate=e=>{if(e.candidate)sendSignal('ice-candidate',e.candidate);};
  const offer=await state.peer.createOffer();await state.peer.setLocalDescription(offer);await sendSignal('offer',state.peer.localDescription);
  state.signalTimer=setInterval(async()=>{for(const m of await getSignals()){if(state.receivedSignals.has(m.id)||m.from==='candidate')continue;state.receivedSignals.add(m.id);if(m.type==='answer'){try{await state.peer.setRemoteDescription(new RTCSessionDescription(m.payload));}catch(e){}}else if(m.type==='ice-candidate'){try{await state.peer.addIceCandidate(m.payload);}catch(e){}}}},1000);
}
async function startCandidateInterviewerInfoPolling(){const poll=setInterval(async()=>{if(!state.interviewStarted){clearInterval(poll);return;}try{const d=await api('/api/sessions');const s=(d.sessions||[]).find(x=>x.id===state.sessionId);if(s&&s.interviewerName){const n=document.getElementById('interviewerDisplayName'),i=document.getElementById('interviewerDisplayId');if(n)n.textContent=s.interviewerName;if(i)i.textContent=s.interviewerId||'';}}catch(e){}},1500);}
async function terminateInterview(reason){
  if(!state.interviewStarted&&!state.sessionStartedAt)return;
  const candidateCompleted=reason.includes('completed by candidate');
  state.interviewStarted=false;state.interviewLocked=true;state.sessionEndedAt=new Date().toISOString();state.sessionReason=reason;
  const finalStatus=candidateCompleted?'Completed':reason.includes('Pass')?'Passed':reason.includes('Reject')?'Failed':'Failed';
  removeInterviewGuards();stopInterviewMedia();await saveSession(finalStatus);toast('Interview session closed.');
  if(document.fullscreenElement){try{await document.exitFullscreen();}catch(e){}}
  setTimeout(()=>{if(candidateCompleted){candidateFeedbackPage(finalStatus);}else{setCandidateLock();app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Interview Session Closed</b></div><div class="candidate-body"><h2>Session closed</h2><p class="muted">${esc(reason)}</p><span class="badge rejected">FAILED</span><div class="helper-note">This session was terminated and recorded as Failed. You cannot return to the interview.</div></div></div>`;}},400);
} 
async function candidateFeedbackPage(status){
  setCandidateLock();
  app.innerHTML=`<div class="candidate-shell"><div class="candidate-header"><b>Interview Feedback</b><div style="opacity:.8;margin-top:5px">Your interview has ended. Please share your experience.</div></div><div class="candidate-body"><section class="panel"><h2>How was your interview?</h2><p class="muted">Your feedback will be shared with the interviewer and attached to this interview session.</p><div class="feedback-stars" id="feedbackStars">${[1,2,3,4,5].map(n=>`<button type="button" class="star-btn" data-rating="${n}" onclick="selectFeedbackRating(${n})">★</button>`).join('')}</div><div class="field"><label>Comments</label><textarea id="feedbackComment" rows="6" maxlength="1000" placeholder="Tell us about your interview experience…"></textarea></div><div id="feedbackMsg" class="notice" style="display:none"></div><button class="btn primary" onclick="submitCandidateFeedback('${esc(status)}')">Submit Feedback</button></section></div></div>`;
}
function selectFeedbackRating(n){state.feedbackRating=n;document.querySelectorAll('.star-btn').forEach(b=>b.classList.toggle('selected',Number(b.dataset.rating)<=n));}
async function submitCandidateFeedback(status){
  const msg=document.getElementById('feedbackMsg');
  if(!state.feedbackRating){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent='Please select a rating.';return;}
  try{await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/feedback`,{method:'POST',body:JSON.stringify({rating:state.feedbackRating,comment:document.getElementById('feedbackComment').value.trim(),submittedBy:state.user?.id||'',status})});msg.style.display='block';msg.className='notice success-notice';msg.textContent='Thank you. Your feedback has been sent to the interviewer.';setTimeout(()=>candidatePortal(),900);}catch(e){msg.style.display='block';msg.className='notice invalid-notice';msg.textContent=e.message;}
}

async function viewSession(name){
  clearInterval(state.liveClockTimer);
  state.interviewerSession=name;state.decision=null;state.page="sessions";state.interviewerEvents=[{time:new Date().toLocaleTimeString(),type:"Session opened",severity:"Info"}];
  let match=null,roomViews={},questionBank=[];
  try{const [d,qb]=await Promise.all([api("/api/sessions"),api('/api/question-bank')]);questionBank=qb.questions||[];const matches=d.sessions.filter(s=>s.candidateName===name).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));match=matches[0];if(match)roomViews=match.roomViews||{};}catch(e){}
  state.interviewerSessionId=match?.id||null;state.roomViews=roomViews;
  if(match&&state.user){try{await api('/api/sessions',{method:'POST',body:JSON.stringify({...match,interviewerName:state.user.name,interviewerId:state.user.id})});}catch(e){}}
  shell(`<div class="page-title live-interview-title"><div><div class="eyebrow">LIVE INTERVIEW</div><h1>${esc(name)} — Live Interview</h1><div class="muted">Candidate: <b>${esc(match?.candidateName||name)}</b> • User ID: <b>${esc(match?.candidateId||'—')}</b> • Session: ${esc(match?.id||'—')}</div></div><div class="live-interview-actions"><button class="btn secondary" onclick="sessions()">← Back to Sessions</button>${match?.status==='Waiting Room'?`<button class="btn success" onclick="admitCandidate('${esc(match.id)}')">Admit Candidate</button>`:''}<button class="btn warning" onclick="interviewerWarn()">Warn Candidate</button><button class="btn danger" onclick="interviewerTerminate()">Terminate</button></div></div>
  <div class="cards live-summary"><div class="card live-summary-card status-summary"><div class="label">Interview Status</div><div class="metric" id="liveStatus">${esc(match?.status||'LIVE')}</div></div><div class="card live-summary-card warning-summary"><div class="label">Warnings</div><div class="metric" id="warningCount">${Number(match?.warnings||0)}</div></div><div class="card live-summary-card"><div class="label">Candidate</div><div class="metric" style="font-size:18px">${esc(match?.candidateName||name)}</div></div><div class="card live-summary-card"><div class="label">User ID</div><div class="metric" style="font-size:18px">${esc(match?.candidateId||'—')}</div></div><div class="card live-summary-card elapsed-summary"><div class="label">Elapsed Time</div><div class="metric" id="interviewElapsed" style="font-size:22px">${formatElapsed(match?.startedAt)}</div></div></div>
  <div class="live-command-strip"><div><span class="live-dot"></span><b>Secure interview channel</b><span class="muted">Camera, microphone and integrity signals are monitored in real time.</span></div><div class="live-command-status"><span class="badge ready">WebRTC</span><span class="badge ready">Monitoring active</span></div></div>
  <div class="call-grid live-video-grid">
    <section class="panel call-panel live-video-card candidate-video-card"><div class="call-title"><div><b>${esc(match?.candidateName||name)}</b><div class="muted">User ID: ${esc(match?.candidateId||'—')}</div></div><span class="badge ready">Candidate</span></div><div class="video-box call-video"><video id="interviewerCandidateVideo" autoplay playsinline></video><div id="interviewerVideoPlaceholder">Waiting for candidate camera…</div></div><div class="audio-meter"><span>Candidate audio</span><div class="meter-track"><div id="candidateAudioBar" class="meter-fill"></div><div class="yellow-line"></div></div><span id="candidateAudioValue">0%</span><span id="candidateAudioStatus" class="badge pending">Connecting</span></div><button class="btn secondary audio-enable-btn" type="button" onclick="enableRemoteInterviewAudio('interviewerCandidateVideo')">🔊 Enable candidate audio</button></section>
    <section class="panel call-panel live-video-card self-video-card"><div class="call-title"><div><b>${esc(state.user?.name||'Interviewer')}</b><div class="muted">User ID: ${esc(state.user?.id||'—')}</div></div><span class="badge ready">You</span></div><div class="video-box call-video"><video id="interviewerSelfVideo" autoplay playsinline muted></video><div id="interviewerSelfPlaceholder">Your camera is off</div></div><div class="audio-meter"><span>Your audio</span><div class="meter-track"><div id="interviewerSelfAudioBar" class="meter-fill"></div><div class="yellow-line"></div></div><span id="interviewerSelfAudioValue">0%</span><span id="interviewerSelfAudioStatus" class="badge pending">Connecting</span></div><button class="btn primary video-action" onclick="startInterviewerCamera()">Enable My Camera</button></section>
  </div>
  <div class="live-lower-grid interviewer-live-lower-grid"><div>${chatPanelHtml('Interview Chat')}
  <section class="panel candidate-verification-panel"><h2>Candidate Verification</h2>
  <div class="check-grid">
    <div><h3>Live Selfie</h3><div class="verification-photo">${match?.facePhoto?`<img src="${match.facePhoto}" alt="Candidate verification photo">`:'<span>No verification photo received.</span>'}</div></div>
    <div><h3>Government ID</h3><div class="verification-photo">${match?.idDocument? (String(match.idDocument).startsWith('data:application/pdf')?`<iframe src="${match.idDocument}" title="Government ID" style="width:100%;height:100%;border:0"></iframe>`:`<img src="${match.idDocument}" alt="Government ID">`):`<span>${esc(match?.idFileName||'No government ID received')}</span>`}</div></div>
  </div>
  <div class="helper-note" style="margin-top:14px"><b>Face comparison:</b> ${esc(match?.faceMatchStatus||'Not checked')}${match?.faceMatchScore!=null?` — ${esc(match.faceMatchScore)}%`:''}. The selfie and submitted ID are available for interviewer identity review. HireTrust does not automatically reject an employment candidate from facial similarity.</div>
</section></div></div>
  <div class="grid2"><div><section class="panel"><h2>Recent Security Events</h2><div id="interviewerEvents" class="status-list"></div></section><section class="panel"><h2>Room Monitoring — Separate Captures</h2><div class="room-monitor-grid interviewer-room-grid">${["Front","Back","Left","Right"].map(v=>`<div class="room-monitor-card"><div class="room-preview">${state.roomViews[v]?`<img src="${state.roomViews[v]}" alt="${v} room view">`:`<span>No ${v} image received</span>`}</div><b>${v} View</b><span class="room-state ${state.roomViews[v]?"captured":""}">${state.roomViews[v]?"Captured & monitored":"Waiting"}</span></div>`).join("")}</div></section></div>
  <div><section class="panel"><h2>Real-Time Verification</h2><div id="verificationRows" class="status-list"><div class="status-row"><span>Identity verification</span><span class="badge ready">Verified</span></div><div class="status-row"><span>Face presence</span><span class="badge ready">Present</span></div><div class="status-row"><span>Camera</span><span class="badge ready" id="remoteCameraStatus">Waiting</span></div><div class="status-row"><span>Browser network</span><span class="badge pending" id="interviewerNetworkStatus">Checking</span></div><div class="status-row"><span>Microphone</span><span class="badge ready">Active</span></div><div class="status-row"><span>Audio monitoring</span><span class="badge ready" id="voiceStatus">Listening</span></div><div class="status-row"><span>Eye/gaze monitoring</span><span class="badge pending" id="interviewerEyeStatus">Waiting</span></div><div class="status-row"><span>Phone/network companions</span><span class="badge pending" id="interviewerPhoneStatus">Checking</span></div><div class="status-row"><span>Network distance</span><span class="badge pending" id="interviewerDistanceStatus">Not measurable</span></div><div class="status-row"><span>Display configuration</span><span class="badge ready">1 Display</span></div><div class="status-row"><span>Full-screen</span><span class="badge ready">Active</span></div><div class="status-row"><span>Tab/window activity</span><span class="badge ready" id="focusStatus">No violations</span></div></div></section><section class="panel"><h2>Interviewer Decision</h2><div id="decisionArea"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="setInterviewDecision('Passed')">Pass</button><button class="btn danger" onclick="setInterviewDecision('Rejected')">Reject / Failed</button><button class="btn warning" onclick="setInterviewDecision('Review')">Needs Review</button></div></div></section><section class="panel"><div class="section-head"><div><h2>Structured Interview Plan</h2><p class="muted">Choose reusable questions for this session. The interviewer remains in control of which questions are asked.</p></div><span class="badge pending">${(match?.questionPlan||[]).length} planned</span></div><div class="question-plan">${questionBank.slice(0,12).map(q=>`<label class="question-plan-item"><input type="checkbox" value="${esc(q.id)}" ${(match?.questionPlan||[]).includes(q.id)?'checked':''}><span><b>${esc(q.question)}</b><small>${esc(q.category)} · ${esc(q.difficulty)}</small></span></label>`).join('')||'<div class="muted">Create questions in Question Bank first.</div>'}</div><button class="btn primary" onclick="saveQuestionPlan()">Save Interview Plan</button></section>
  <section class="panel review-panel"><div class="review-heading"><div><h2>Interview Evaluation & Notes</h2><p class="muted">Save structured interviewer feedback to this session.</p></div><button class="btn secondary" onclick="downloadInterviewReport()">Download / Print Report</button></div><div class="evaluation-grid"><div class="field"><label>Technical knowledge (1–5)</label><select id="evalTechnical"><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${String(match?.interviewerReview?.technical||'')===String(n)?'selected':''}>${n} / 5</option>`).join('')}</select></div><div class="field"><label>Communication (1–5)</label><select id="evalCommunication"><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${String(match?.interviewerReview?.communication||'')===String(n)?'selected':''}>${n} / 5</option>`).join('')}</select></div><div class="field"><label>Problem solving (1–5)</label><select id="evalProblemSolving"><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${String(match?.interviewerReview?.problemSolving||'')===String(n)?'selected':''}>${n} / 5</option>`).join('')}</select></div><div class="field"><label>Role knowledge (1–5)</label><select id="evalRoleKnowledge"><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${String(match?.interviewerReview?.roleKnowledge||'')===String(n)?'selected':''}>${n} / 5</option>`).join('')}</select></div></div><div class="field"><label>Interviewer notes (private to interviewer)</label><textarea id="interviewerNotes" rows="4" maxlength="5000" placeholder="Key strengths, areas to follow up, and interview observations…">${esc(match?.interviewerReview?.notes||'')}</textarea></div><div class="field"><label>Question bank quick insert</label><select id="questionBankQuick" onchange="insertInterviewQuestion()"><option value="">Choose a sample question to insert into notes…</option><option>Explain the difference between a list and a tuple in Python.</option><option>Describe how you would debug a slow SQL query.</option><option>Tell me about a difficult problem you solved and your approach.</option><option>How would you design a REST API for a simple task manager?</option></select></div><div id="reviewSaveStatus" class="notice" aria-live="polite"></div><button class="btn primary" onclick="saveInterviewReview()">Save Evaluation & Notes</button><div class="helper-note">Ratings and notes support interviewer review only; they do not automatically determine an employment outcome.</div></section></div></div>`);
  renderInterviewerEvents();startInterviewerRealtime();startChatPolling();startInterviewElapsedClock(match?.startedAt);
}
function formatElapsed(startedAt){
  if(!startedAt)return '—';const seconds=Math.max(0,Math.floor((Date.now()-new Date(startedAt).getTime())/1000));
  const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
  return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
}
function startInterviewElapsedClock(startedAt){
  clearInterval(state.liveClockTimer);const el=document.getElementById('interviewElapsed');if(!el||!startedAt)return;
  const update=()=>{const node=document.getElementById('interviewElapsed');if(!node){clearInterval(state.liveClockTimer);return;}node.textContent=formatElapsed(startedAt);};update();state.liveClockTimer=setInterval(update,1000);
}
function insertInterviewQuestion(){
  const q=document.getElementById('questionBankQuick')?.value,notes=document.getElementById('interviewerNotes');if(!q||!notes)return;
  notes.value=(notes.value?notes.value+'\n\n':'')+'Question: '+q+'\nCandidate response / observations: ';
  notes.focus();document.getElementById('questionBankQuick').value='';
}
async function saveQuestionPlan(){try{const ids=[...document.querySelectorAll('.question-plan-item input:checked')].map(x=>x.value);const d=await api('/api/sessions');const match=(d.sessions||[]).find(x=>x.id===state.interviewerSessionId);if(!match)throw new Error('Interview session could not be found.');await api('/api/sessions',{method:'POST',body:JSON.stringify({...match,questionPlan:ids})});toast(`${ids.length} question(s) added to the interview plan.`,'success');}catch(e){toast(e.message,'danger');}}
async function saveInterviewReview(){
  const status=document.getElementById('reviewSaveStatus');
  try{
    const d=await api('/api/sessions');const match=(d.sessions||[]).find(x=>x.id===state.interviewerSessionId);
    if(!match)throw new Error('Interview session could not be found.');
    const review={technical:document.getElementById('evalTechnical')?.value||'',communication:document.getElementById('evalCommunication')?.value||'',problemSolving:document.getElementById('evalProblemSolving')?.value||'',roleKnowledge:document.getElementById('evalRoleKnowledge')?.value||'',notes:document.getElementById('interviewerNotes')?.value||'',updatedAt:new Date().toISOString(),reviewerId:state.user?.id||'',reviewerName:state.user?.name||''};
    await api('/api/sessions',{method:'POST',body:JSON.stringify({...match,interviewerReview:review})});
    if(status){status.textContent='Evaluation and notes saved to this interview.';status.className='notice success-notice';}toast('Evaluation saved successfully.');
  }catch(e){if(status){status.textContent=e.message||'Could not save evaluation.';status.className='notice invalid-notice';}toast(e.message||'Could not save evaluation.');}
}
async function downloadInterviewReport(){
  let reportWindow=null;
  try{
    reportWindow=window.open('','_blank');if(!reportWindow)throw new Error('Your browser blocked the report popup. Allow popups for HireTrust and try again.');
    const d=await api('/api/sessions');const s=(d.sessions||[]).find(x=>x.id===state.interviewerSessionId);if(!s)throw new Error('Interview session not found.');
    const ev=[...(Array.isArray(s.monitorEvents)?s.monitorEvents:[]),...(Array.isArray(s.violations)?s.violations.map(v=>({time:v.time,type:v.reason,severity:'Warning'})):[])].sort((a,b)=>new Date(a.time||a.createdAt||0)-new Date(b.time||b.createdAt||0));
    const r=s.interviewerReview||{};const rows=ev.map(e=>`<tr><td>${esc(e.time?formatAppDate(e.time):'—')}</td><td>${esc(e.type||e.reason||'Monitoring event')}</td><td>${esc(e.severity||'Info')}</td></tr>`).join('');
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>HireTrust Interview Report - ${esc(s.id)}</title><style>body{font:14px Arial,sans-serif;color:#172033;margin:36px}h1{color:#263e84;margin-bottom:4px}.muted{color:#68748a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{border:1px solid #dfe5ef;padding:14px;border-radius:8px;margin:12px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #e6eaf0;padding:8px}button{padding:10px 14px;background:#4055c7;color:#fff;border:0;border-radius:7px}@media print{button{display:none}body{margin:16mm}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>HIRETRUST</h1><h2>Interview Verification Report</h2><p class="muted">Generated ${esc(formatAppDate(new Date().toISOString()))}</p><div class="grid"><div class="box"><b>Candidate</b><p>${esc(s.candidateName||'—')}<br>${esc(s.candidateId||'')}<br>${esc(s.candidateEmail||'')}</p></div><div class="box"><b>Interview</b><p>Session: ${esc(s.id||'—')}<br>Status: ${esc(s.status||'—')}<br>Decision: ${esc(s.decision||'Pending')}<br>Scheduled: ${esc(s.scheduledAt?formatAppDate(s.scheduledAt):'—')}<br>Started: ${esc(s.startedAt?formatAppDate(s.startedAt):'—')}<br>Ended: ${esc(s.endedAt?formatAppDate(s.endedAt):'—')}</p></div></div><div class="box"><b>Integrity summary</b><p>Warnings: ${Number(s.warnings||0)} | Eye/gaze alerts: ${(s.monitorEvents||[]).filter(e=>String(e.type||'').toLowerCase().includes('eye/gaze')).length} | Tab/window violations: ${(s.violations||[]).filter(v=>/tab|window|visibility|focus/i.test(v.reason||'')).length}</p><p>Identity status: ${esc(s.faceMatchStatus||'Not checked')} ${s.faceMatchScore!=null?'('+esc(s.faceMatchScore)+'%)':''}</p><p class="muted">Monitoring signals are advisory and should be interpreted in context. This report is not an automated hiring decision.</p></div><div class="box"><b>Evaluation</b><p>Technical knowledge: ${esc(r.technical||'Not rated')}/5 | Communication: ${esc(r.communication||'Not rated')}/5 | Problem solving: ${esc(r.problemSolving||'Not rated')}/5 | Role knowledge: ${esc(r.roleKnowledge||'Not rated')}/5</p><b>Interviewer notes</b><p style="white-space:pre-wrap">${esc(r.notes||'No notes recorded.')}</p></div><h3>Security timeline</h3><table><thead><tr><th>Time</th><th>Event</th><th>Severity</th></tr></thead><tbody>${rows||'<tr><td colspan="3">No security events recorded.</td></tr>'}</tbody></table><script>window.addEventListener('load',()=>{});</script></body></html>`;
    reportWindow.document.open();reportWindow.document.write(html);reportWindow.document.close();
  }catch(e){if(reportWindow&&!reportWindow.closed){reportWindow.document.body.innerHTML='<p>Unable to create report. Return to HireTrust and try again.</p>';}toast(e.message||'Could not create report.');}
}
async function startInterviewerCamera(){
  try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});state.interviewerCameraStream=stream;const v=document.getElementById('interviewerSelfVideo');if(v){v.srcObject=stream;v.style.display='block';}const p=document.getElementById('interviewerSelfPlaceholder');if(p)p.style.display='none';startLocalAudioMeter(stream,'interviewerSelfAudioBar','interviewerSelfAudioValue','interviewerSelfAudioStatus');await startInterviewerWebRTC(true);}catch(e){toast('Could not access interviewer camera/microphone. Check browser permissions.');}
}
async function startInterviewerWebRTC(restart=false){
  if(!state.interviewerSessionId||!window.RTCPeerConnection)return;
  state.signalRole='interviewer';state.receivedSignals=new Set();
  if(state.peer){try{state.peer.close();}catch(e){}}
  state.peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  if(state.interviewerCameraStream)state.interviewerCameraStream.getTracks().forEach(t=>state.peer.addTrack(t,state.interviewerCameraStream));
  state.peer.ontrack=e=>{addPeerTrack('interviewerCandidateVideo',e.streams[0]);if(e.streams[0])startRemoteAudioMeter(e.streams[0],'candidateAudioBar','candidateAudioValue','candidateAudioStatus');const st=document.getElementById('remoteCameraStatus');if(st){st.textContent='Live';st.className='badge ready';}};
  state.peer.onicecandidate=e=>{if(e.candidate)sendSignal('ice-candidate',e.candidate);};
  clearInterval(state.signalTimer);
  state.signalTimer=setInterval(async()=>{for(const m of await getSignals()){if(state.receivedSignals.has(m.id)||m.from==='interviewer')continue;state.receivedSignals.add(m.id);if(m.type==='offer'){try{await state.peer.setRemoteDescription(new RTCSessionDescription(m.payload));const answer=await state.peer.createAnswer();await state.peer.setLocalDescription(answer);await sendSignal('answer',state.peer.localDescription);}catch(e){console.warn(e);}}else if(m.type==='ice-candidate'){try{await state.peer.addIceCandidate(m.payload);}catch(e){}}}},1000);
}
async function connectCandidateCamera(){const video=document.getElementById("interviewerCandidateVideo"),placeholder=document.getElementById("interviewerVideoPlaceholder"),msg=document.getElementById("streamMessage");if(!video)return;try{if(state.candidateStream)disconnectCandidateCamera();state.candidateStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=state.candidateStream;video.style.display="block";placeholder.style.display="none";msg.textContent="Candidate camera stream connected for this demo.";state.interviewerEvents.unshift({time:new Date().toLocaleTimeString(),type:"Candidate camera stream connected",severity:"Info"});renderInterviewerEvents();}catch(e){msg.textContent="Could not access a camera. Check browser permissions.";}}
function disconnectCandidateCamera(){if(state.candidateStream){state.candidateStream.getTracks().forEach(t=>t.stop());state.candidateStream=null;}const video=document.getElementById("interviewerCandidateVideo"),placeholder=document.getElementById("interviewerVideoPlaceholder");if(video){video.srcObject=null;video.style.display="none";}if(placeholder)placeholder.style.display="block";}
function interviewerWarn(){state.warnings++;state.interviewerEvents.unshift({time:new Date().toLocaleTimeString(),type:"Warning issued by interviewer",severity:"Warning"});const n=document.getElementById("warningCount");if(n)n.textContent=state.warnings;const f=document.getElementById("focusStatus");if(f){f.textContent=`${state.warnings} warning(s)`;f.className="badge warning";}renderInterviewerEvents();toast(`Warning ${state.warnings} sent to ${state.interviewerSession}.`);}
async function sendResultEmail(sessionId,result){try{return await api(`/api/sessions/${encodeURIComponent(sessionId)}/result-email`,{method:'POST',body:JSON.stringify({result})});}catch(e){console.warn('result email',e);return null;}}
async function interviewerTerminate(){clearInterval(state.liveClockTimer);state.interviewerEvents.unshift({time:new Date().toLocaleTimeString(),type:"Interview terminated by interviewer",severity:"Critical"});clearInterval(state.interviewerTimer);disconnectCandidateCamera();const st=document.getElementById("liveStatus");if(st){st.textContent="FAILED";st.style.color="#a42c3a";}try{const d=await api('/api/sessions');const match=d.sessions.filter(s=>s.id===state.interviewerSessionId).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))[0];if(match){const endedAt=new Date().toISOString();await api('/api/sessions',{method:'POST',body:JSON.stringify({...match,status:'Failed',decision:'Failed',endedAt,reason:'Terminated by interviewer',warnings:state.warnings})});await sendResultEmail(match.id,'Failed');}}catch(e){}renderInterviewerEvents();toast("Interview terminated and marked Failed.");setTimeout(()=>dashboard(),900);}
async function setInterviewDecision(decision){state.decision=decision;state.interviewerEvents.unshift({time:new Date().toLocaleTimeString(),type:`Interview decision: ${decision}`,severity:decision==='Rejected'?'Critical':'Info'});try{const d=await api('/api/sessions');const match=d.sessions.filter(s=>s.id===state.interviewerSessionId).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))[0];if(match){const final=decision==='Passed'?'Passed':decision==='Rejected'?'Failed':'Review';await api('/api/sessions',{method:'POST',body:JSON.stringify({...match,decision:final,status:final==='Passed'?'Passed':final==='Failed'?'Failed':'Completed',endedAt:match.endedAt||new Date().toISOString()})});if(final==='Passed'||final==='Failed')await sendResultEmail(match.id,final);}}catch(e){console.warn(e)}const area=document.getElementById('decisionArea');if(area)area.innerHTML=`<div class="notice"><b>Decision recorded: ${esc(decision)}</b><div class="muted" style="margin-top:5px">This action has been saved to the interview session.</div></div>`;renderInterviewerEvents();toast(`Decision recorded: ${decision}`);if(decision!=='Review')setTimeout(()=>dashboard(),700);}
function renderInterviewerEvents(){const box=document.getElementById("interviewerEvents");if(!box)return;const persisted=(state.persistedMonitorEvents||[]).map(e=>({time:e.time?new Date(e.time).toLocaleTimeString():e.createdAt?new Date(e.createdAt).toLocaleTimeString():'—',type:e.type||e.reason||'Monitoring event',severity:e.severity||'Info'}));const all=[...state.interviewerEvents,...persisted].slice().sort((a,b)=>{const ta=Date.parse(a.time)||0,tb=Date.parse(b.time)||0;return tb-ta;}).slice(0,12);box.innerHTML=all.length?all.map(e=>{const cls=e.severity==="Critical"?"rejected":e.severity==="Warning"?"warning":"ready";return `<div class="status-row"><span>${esc(e.time)} — ${esc(e.type)}</span><span class="badge ${cls}">${esc(e.severity)}</span></div>`;}).join(""):'<div class="muted">No monitoring events recorded yet.</div>'; }
function startInterviewerRealtime(){
  clearInterval(state.interviewerTimer);
  state.interviewerTimer=setInterval(async()=>{
    if(!document.getElementById('verificationRows')){clearInterval(state.interviewerTimer);return;}
    try{
      const d=await api('/api/sessions');
      const s=(d.sessions||[]).find(x=>x.id===state.interviewerSessionId);
      if(!s)return;state.persistedMonitorEvents=[...(Array.isArray(s.monitorEvents)?s.monitorEvents:[]),...(Array.isArray(s.violations)?s.violations.map(v=>({time:v.time,type:v.reason,severity:'Warning'})):[])];renderInterviewerEvents();
      const live=document.getElementById('liveStatus');if(live)live.textContent=s.status||'LIVE';const net=document.getElementById('interviewerNetworkStatus');if(net){net.textContent=navigator.onLine?'Browser online':'Browser offline';net.className=navigator.onLine?'badge ready':'badge warning';}
      const wc=document.getElementById('warningCount');if(wc)wc.textContent=Number(s.warnings||0);
      const focus=document.getElementById('focusStatus');
      const violations=Array.isArray(s.violations)?s.violations:[];
      if(focus){focus.textContent=violations.length?`${violations.length} violation(s)`:'No violations';focus.className=violations.length?'badge warning':'badge ready';}
      const eye=document.getElementById('interviewerEyeStatus'); const eyeAlerts=(s.monitorEvents||[]).filter(e=>String(e.type||'').toLowerCase().includes('eye/gaze')); const eyeAlert=violations.some(v=>String(v.reason||'').toLowerCase().includes('eye/gaze')); if(eye){eye.textContent=eyeAlert?`Alert (${eyeAlerts.length})`:'Monitoring';eye.title=eyeAlerts.length?`Latest: ${String(eyeAlerts[eyeAlerts.length-1]?.details?.direction||'attention alert')}`:'No gaze alerts recorded';eye.className=eyeAlert?'badge warning':'badge ready';} const distance=document.getElementById('interviewerDistanceStatus');if(distance){distance.textContent='Not measurable';distance.className='badge pending';distance.title='A normal browser cannot determine physical distance to Wi-Fi devices.';} const phone=document.getElementById('interviewerPhoneStatus'); if(phone){phone.textContent=(s.phoneDevices||[]).length?`${s.phoneDevices.length} phone(s) detected`:'No phone verified';phone.className=(s.phoneDevices||[]).length?'badge warning':'badge ready';} const voice=document.getElementById('voiceStatus');
      const hasSilence=violations.some(v=>String(v.reason||'').toLowerCase().includes('silence')||String(v.reason||'').toLowerCase().includes('audio'));
      if(voice){voice.textContent=hasSilence?'Audio warning':'Listening';voice.className=hasSilence?'badge warning':'badge ready';}
      if(s.status==='Terminated'||s.status==='Completed'||s.status==='Passed'||s.status==='Failed'||s.status==='Rejected'){
        if(live)live.textContent=s.status;
      }
    }catch(e){}
  },1500);
}
// Start with the requested password-reset page when a reset token is present; otherwise open the interviewer login.
const resetToken=new URLSearchParams(window.location.search).get('token');
if(window.location.pathname==='/reset-password' || resetToken) resetPasswordPage(resetToken); else interviewerLogin();
