const path = require('path');

// Load .env before reading MONGODB_URI or other environment variables.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Use reliable public DNS resolvers for MongoDB Atlas SRV resolution.
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch {}
let MongoClient = null;
try { ({ MongoClient } = require('mongodb')); } catch {}

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
function makeId(){ return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
const SMTP_SETTINGS_FILE = path.join(ROOT, 'smtp-settings.json');
const SMTP_KEY_FILE = path.join(ROOT, '.smtp-settings-key');
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'hiretrust';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
let mongoClient = null;
let mongoCollection = null;
let dbState = { users: [], sessions: [], passwordResetTokens: [], questionBank: [], notifications: [], loginChallenges: [] };
function getSmtpKey() {
  if (!fs.existsSync(SMTP_KEY_FILE)) fs.writeFileSync(SMTP_KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(SMTP_KEY_FILE, 'utf8').trim()).digest();
}
function encryptSecret(value) {
  const iv=crypto.randomBytes(12), key=getSmtpKey();
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const enc=Buffer.concat([cipher.update(String(value||''),'utf8'),cipher.final()]);
  return {iv:iv.toString('hex'),data:enc.toString('hex'),tag:cipher.getAuthTag().toString('hex')};
}
function decryptSecret(obj) {
  if(!obj || !obj.data)return '';
  try { const decipher=crypto.createDecipheriv('aes-256-gcm',getSmtpKey(),Buffer.from(obj.iv,'hex')); decipher.setAuthTag(Buffer.from(obj.tag,'hex')); return Buffer.concat([decipher.update(Buffer.from(obj.data,'hex')),decipher.final()]).toString('utf8'); }
  catch { return ''; }
}
function loadSmtpSettings(){
  let saved={};
  try { if(fs.existsSync(SMTP_SETTINGS_FILE)) saved=JSON.parse(fs.readFileSync(SMTP_SETTINGS_FILE,'utf8')); } catch {}
  const env=process.env;
  return {
    host:saved.host || env.SMTP_HOST || '',
    port:String(saved.port || env.SMTP_PORT || 587),
    secure: saved.secure !== undefined ? !!saved.secure : String(env.SMTP_PORT||'587')==='465',
    user:saved.user || env.SMTP_USER || '',
    pass: saved.pass ? decryptSecret(saved.pass) : (env.SMTP_PASS || ''),
    from:saved.from || env.SMTP_FROM || ''
  };
}
function publicSmtpSettings(){ const x=loadSmtpSettings(); return {...x,passConfigured:!!x.pass,pass:''}; }
function saveSmtpSettings(input){
  const data={host:String(input.host||'').trim(),port:Number(input.port||587),secure:!!input.secure,user:String(input.user||'').trim(),from:String(input.from||'').trim()};
  if(input.pass) data.pass=encryptSecret(input.pass);
  else { const old=loadSmtpSettings(); if(old.pass) data.pass=encryptSecret(old.pass); }
  fs.writeFileSync(SMTP_SETTINGS_FILE,JSON.stringify(data,null,2),{mode:0o600});
  return publicSmtpSettings();
}
function validPhone(v){return /^\+?[1-9]\d{7,14}$/.test(String(v||'').trim());}
function ageFromDob(dob){ if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dob||''))) return null; const d=new Date(`${dob}T00:00:00`); if(Number.isNaN(d.getTime())) return null; const now=new Date(); let age=now.getFullYear()-d.getFullYear(); const m=now.getMonth()-d.getMonth(); if(m<0 || (m===0 && now.getDate()<d.getDate())) age--; return age; }
function loadDb() { return dbState; }
function saveDb(db) {
  dbState = db;
  if (mongoCollection) return mongoCollection.replaceOne({ _id:'state' }, { _id:'state', users:db.users||[], sessions:db.sessions||[], passwordResetTokens:db.passwordResetTokens||[], questionBank:db.questionBank||[], notifications:db.notifications||[], loginChallenges:db.loginChallenges||[], auditLog:db.auditLog||[] }, {upsert:true}).catch(e=>console.error('MongoDB save failed:',e.message));
  return Promise.resolve();
}
async function initMongo(){
  if(!MONGODB_URI) throw new Error('MONGODB_URI is required. HireTrust v13 no longer uses database.json. Add your MongoDB Atlas connection string to .env.');
  if(!MongoClient) throw new Error('MongoDB driver is not installed. Run npm install.');
  mongoClient=new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  mongoCollection=mongoClient.db(MONGODB_DB).collection('hiretrust_state');
  const doc=await mongoCollection.findOne({_id:'state'});
  dbState={users:doc?.users||[],sessions:doc?.sessions||[],passwordResetTokens:doc?.passwordResetTokens||[],questionBank:doc?.questionBank||[],notifications:doc?.notifications||[],loginChallenges:doc?.loginChallenges||[],auditLog:doc?.auditLog||[]};
  await ensureAdminUser();
  console.log(`MongoDB connected: ${MONGODB_DB} (${dbState.users.length} users, ${dbState.sessions.length} sessions)`);
  return true;
}
function formatDateTime(value, options={}) {
  const d=new Date(value); if(Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN',{timeZone:APP_TIMEZONE,dateStyle:'medium',timeStyle:'short',...options}).format(d);
}
function formatTimeZoneName(){
  try { return new Intl.DateTimeFormat('en-IN',{timeZone:APP_TIMEZONE,timeZoneName:'short'}).format(new Date()).split(' ').pop(); } catch { return APP_TIMEZONE; }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  const hash = crypto.scryptSync(password, record.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(record.passwordHash, 'hex'));
}

const loginAttempts=new Map();
function loginKey(req, userId){return `${req.socket.remoteAddress||'unknown'}:${String(userId||'').toUpperCase()}`;}
function checkLoginRate(req,userId){const k=loginKey(req,userId), now=Date.now(), x=loginAttempts.get(k); if(!x)return true; if(now-x.resetAt>15*60*1000){loginAttempts.delete(k);return true;} return x.count<8;}
function noteLoginFailure(req,userId){const k=loginKey(req,userId),now=Date.now(),x=loginAttempts.get(k); if(!x||now-x.resetAt>15*60*1000)loginAttempts.set(k,{count:1,resetAt:now});else x.count++;}
function clearLoginFailures(req,userId){loginAttempts.delete(loginKey(req,userId));}
function hashCode(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
async function ensureAdminUser(){
  const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(), password=String(process.env.ADMIN_PASSWORD||''), userId=String(process.env.ADMIN_USER_ID||'ADMIN-1001').trim().toUpperCase();
  if(!email||!password||!validEmail(email)||!validPassword(password)) return;
  let user=dbState.users.find(u=>u.userId===userId || u.email===email);
  if(!user){const p=hashPassword(password);user={id:makeId(),userId,name:'HireTrust Administrator',email,phone:'',dob:'1990-01-01',profilePic:null,contactSync:false,role:'admin',salt:p.salt,passwordHash:p.hash,createdAt:new Date().toISOString(),twoFactorEnabled:false};dbState.users.push(user);await saveDb(dbState);console.log(`Admin account provisioned: ${userId}`);}
}
function pushNotification(userId,type,title,message,details={}){dbState.notifications=dbState.notifications||[];dbState.notifications.unshift({id:makeId(),userId:String(userId||''),type,title,message,details,read:false,createdAt:new Date().toISOString()});dbState.notifications=dbState.notifications.slice(0,1000);}
function addAudit(action,actor,details={},severity='Info'){dbState.notifications=dbState.notifications||[];dbState.auditLog=dbState.auditLog||[];dbState.auditLog.unshift({id:makeId(),action,actor:actor||'system',details,severity,createdAt:new Date().toISOString()});dbState.auditLog=dbState.auditLog.slice(0,5000);}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 6 && /[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?`~]/.test(password);
}
function hashResetToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function getPublicAppUrl(req) {
  if (PUBLIC_APP_URL) return PUBLIC_APP_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendFile(res, file) {
  const ext = path.extname(file);
  const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}
function readBody(req, maxBytes = 8_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        settled = true;
        const err = new Error(`Request body is too large. Maximum allowed size is ${Math.round(maxBytes / 1_000_000)} MB.`);
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        req.resume();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      try { settled = true; resolve(JSON.parse(raw || '{}')); }
      catch (e) { settled = true; reject(e); }
    });
    req.on('error', err => { if (!settled) { settled = true; reject(err); } });
  });
}


const EMAIL_RE = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
function validEmail(email) { return EMAIL_RE.test(String(email || '').trim()); }
async function createMailTransporter(){
  if (!nodemailer) return {error:'nodemailer_not_installed'};
  const cfg=loadSmtpSettings();
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.from) return {error:'smtp_not_configured'};
  try {
    const transporter=nodemailer.createTransport({host:cfg.host,port:Number(cfg.port||587),secure:!!cfg.secure,auth:{user:cfg.user,pass:cfg.pass}});
    await transporter.verify();
    return {transporter,cfg};
  } catch(e) { return {error:e.message}; }
}
async function sendInterviewEmail(to, subject, html) {
  const t=await createMailTransporter();
  if(t.error)return {sent:false,reason:t.error};
  try { await t.transporter.sendMail({from:t.cfg.from,to,subject,html}); return {sent:true}; }
  catch(e){ console.error('HireTrust email send failed:', e.message); return {sent:false,reason:e.message}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const db = loadDb();

  if (req.method === 'POST' && url.pathname === '/api/signup') {
    try {
      const { name, email, password, role, userId, phone, dob, profilePic, contactSync } = await readBody(req);
      if (!name || !password || !role || !userId) return sendJson(res,400,{ok:false,message:'Full name, password, role and username are required.'});
      if (!profilePic) return sendJson(res,400,{ok:false,message:'A present photo is required to create your account.'});
      const normalizedEmail = String(email||'').trim().toLowerCase();
      const normalizedPhone = String(phone||'').trim();
      if (!normalizedEmail && !normalizedPhone) return sendJson(res,400,{ok:false,message:'Enter either an email address or a phone number.'});
      if (normalizedEmail && !validEmail(normalizedEmail)) return sendJson(res,400,{ok:false,message:'Please enter a valid email address.'});
      if (normalizedPhone && !validPhone(normalizedPhone)) return sendJson(res,400,{ok:false,message:'Phone must be in international format, e.g. +919876543210.'});
      if (!['candidate','interviewer'].includes(role)) return sendJson(res,400,{ok:false,message:'Invalid role.'});
      const age=ageFromDob(String(dob||'').trim());
      if(age===null) return sendJson(res,400,{ok:false,message:'Please enter a valid date of birth.'});
      if(age<=21) return sendJson(res,400,{ok:false,message:'HireTrust is available only to people older than 21 years. Your age must be 22 or above.'});
      if (password.length < 6) return sendJson(res,400,{ok:false,message:'Password must be at least 6 characters.'});
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]/.test(password)) return sendJson(res,400,{ok:false,message:'Password must contain at least one special character.'});
      const normalizedId = String(userId).trim().toUpperCase();
      if (db.users.some(u => normalizedEmail && u.email === normalizedEmail)) return sendJson(res,409,{ok:false,message:'Email is already registered.'});
      if (db.users.some(u => normalizedPhone && u.phone === normalizedPhone)) return sendJson(res,409,{ok:false,message:'Phone number is already registered.'});
      if (db.users.some(u => u.userId === normalizedId)) return sendJson(res,409,{ok:false,message:'Username/User ID is already registered.'});
      if (profilePic && !/^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(String(profilePic))) return sendJson(res,400,{ok:false,message:'Profile picture must be JPG/JPEG or PNG.'});
      if (String(profilePic||'').length > 1_800_000) return sendJson(res,413,{ok:false,message:'Profile picture is too large.'});

      const p=hashPassword(password);
      const user={
        id:makeId(), userId:normalizedId, name:String(name).trim(), email:normalizedEmail,
        phone:normalizedPhone, dob:String(dob||'').trim(), profilePic:profilePic||null,
        contactSync:!!contactSync, role, salt:p.salt, passwordHash:p.hash,
        createdAt:new Date().toISOString()
      };
      db.users.push(user);
      await saveDb(db);
      return sendJson(res,201,{ok:true,emailVerificationRequired:false,email:user.email,userId:normalizedId,message:'Account created successfully. You can log in now.'});
    } catch(e) {
      console.error('Signup error:',e);
      if(e && e.code==='PAYLOAD_TOO_LARGE') return sendJson(res,413,{ok:false,message:'The profile photo/request is too large. Please choose a smaller JPG or PNG photo (under about 4 MB).'});
      return sendJson(res,500,{ok:false,message:`Could not create account: ${e && e.message ? e.message : 'server error'}`});
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const { email, phone, password, role, userId } = await readBody(req);
      const normalizedEmail=String(email||'').trim().toLowerCase();
      const normalizedPhone=String(phone||'').trim();
      const normalizedId=String(userId||'').trim().toUpperCase();
      if(!normalizedEmail && !normalizedPhone)return sendJson(res,400,{ok:false,message:'Enter your email or phone number.'});
      if(normalizedEmail && !validEmail(normalizedEmail))return sendJson(res,400,{ok:false,message:'Please enter a valid email address.'});
      const user=db.users.find(u =>
        u.userId===normalizedId && (u.role===role || (role==='interviewer' && u.role==='admin')) &&
        ((normalizedEmail && u.email===normalizedEmail) || (normalizedPhone && u.phone===normalizedPhone))
      );
      if(!checkLoginRate(req,normalizedId))return sendJson(res,429,{ok:false,message:'Too many failed login attempts. Please wait 15 minutes and try again.'});
      if(!user || !verifyPassword(String(password||''),user)){noteLoginFailure(req,normalizedId);return sendJson(res,401,{ok:false,message:'Email/phone, password, role, or username does not match.'});}
      clearLoginFailures(req,normalizedId);
      const publicUser={id:user.userId,name:user.name,email:user.email||'',phone:user.phone||'',dob:user.dob||'',role:user.role,profilePic:user.profilePic||null,contactSync:!!user.contactSync,twoFactorEnabled:!!user.twoFactorEnabled};
      if((user.role==='interviewer'||user.role==='admin')&&user.twoFactorEnabled){
        if(!validEmail(user.email))return sendJson(res,400,{ok:false,message:'Two-factor authentication requires a valid account email.'});
        const code=String(Math.floor(100000+Math.random()*900000)); const challengeId=makeId(); db.loginChallenges=(db.loginChallenges||[]).filter(x=>new Date(x.expiresAt).getTime()>Date.now()); db.loginChallenges.push({id:challengeId,userId:user.id,codeHash:hashCode(code),expiresAt:new Date(Date.now()+10*60*1000).toISOString(),used:false}); await saveDb(db);
        const email=await sendInterviewEmail(user.email,'HireTrust | Your sign-in verification code',`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>HireTrust sign-in verification</h2><p>Use this one-time code to finish signing in:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;padding:18px;background:#f4f6ff;text-align:center">${code}</div><p>This code expires in 10 minutes. If you did not try to sign in, ignore this message.</p></div>`);
        if(!email.sent){db.loginChallenges=db.loginChallenges.filter(x=>x.id!==challengeId);await saveDb(db);return sendJson(res,502,{ok:false,message:'Two-factor code could not be sent. Check Email Settings and try again.'});}
        return sendJson(res,200,{ok:true,requiresTwoFactor:true,challengeId,user:publicUser});
      }
      addAudit('LOGIN_SUCCESS',user.userId,{role:user.role}); await saveDb(db);
      return sendJson(res,200,{ok:true,user:publicUser});
    } catch(e){return sendJson(res,400,{ok:false,message:'Could not log in.'});}
  }

  if (req.method === 'POST' && url.pathname === '/api/forgot-password') {
    try {
      const email=String((await readBody(req)).email||'').trim().toLowerCase();
      if(!validEmail(email)) return sendJson(res,400,{ok:false,message:'Enter a valid email address.'});
      const user=db.users.find(u=>String(u.email||'').trim().toLowerCase()===email);
      if(!user) return sendJson(res,404,{ok:false,message:'Account is not registered. Please create an account.'});
      const rawToken=crypto.randomBytes(32).toString('hex');
      const tokenHash=hashResetToken(rawToken);
      const now=new Date();
      db.passwordResetTokens=(db.passwordResetTokens||[]).filter(t=>!t.used && new Date(t.expiresAt).getTime()>now.getTime());
      db.passwordResetTokens.push({id:makeId(),userId:user.id,userCode:user.userId,email,tokenHash,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+15*60*1000).toISOString(),used:false});
      await saveDb(db);
      const resetUrl=`${getPublicAppUrl(req)}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const safeName=String(user.name||'User').replace(/[<>]/g,'');
      const html=`<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#4055c7;color:#fff;padding:24px;border-radius:16px 16px 0 0"><h1 style="margin:0">HireTrust</h1><p style="margin:8px 0 0">Password reset request</p></div><div style="padding:28px;border:1px solid #e6eaf2;border-top:0;border-radius:0 0 16px 16px"><h2>Reset your password</h2><p>Hello <b>${safeName}</b>,</p><p>We received a request to change the password for your HireTrust account. Use the button below to create a new password.</p><p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;background:#4055c7;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Change Password</a></p><p style="color:#5f6878">If the button does not work, copy and paste this link into your browser:</p><p style="word-break:break-all;background:#f8f9fc;padding:12px;border-radius:8px;font-size:13px">${resetUrl}</p><p style="color:#5f6878">This link is single-use and expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.</p><div style="margin-top:22px;padding:16px 18px;background:#f8f9fc;border-left:4px solid #4055c7;border-radius:10px;color:#4b5568"><b>Need help?</b><br>Contact HireTrust support at <a href="mailto:hiretrusthelp@gmail.com" style="color:#4055c7;font-weight:600">hiretrusthelp@gmail.com</a>.</div></div></div>`;
      const emailResult=await sendInterviewEmail(email,'HireTrust | Password Reset',html);
      if(!emailResult.sent){
        db.passwordResetTokens=db.passwordResetTokens.filter(t=>t.tokenHash!==tokenHash); await saveDb(db);
        console.error(`Password reset email failed for ${email}:`,emailResult.reason);
        return sendJson(res,502,{ok:false,message:'The account is registered, but the reset email could not be sent. Please open Email Settings and configure a valid Gmail App Password, then try again.'});
      }
      console.log(`Password reset email sent to ${email}.`);
      return sendJson(res,200,{ok:true,message:'Password reset link sent. Check your inbox and spam folder. The link expires in 15 minutes.'});
    } catch(e){
      console.error('Forgot password error:',e.message);
      return sendJson(res,500,{ok:false,message:'Could not send the password reset email. Please check the Email Settings configuration.'});
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/reset-password') {
    try {
      const body=await readBody(req);
      const token=String(body.token||'').trim();
      const password=String(body.password||'');
      if(!token) return sendJson(res,400,{ok:false,message:'This password reset link is invalid.'});
      if(!validPassword(password)) return sendJson(res,400,{ok:false,message:'Password must be at least 6 characters and contain at least one special character.'});
      const tokenHash=hashResetToken(token);
      const now=Date.now();
      const record=(db.passwordResetTokens||[]).find(t=>t.tokenHash===tokenHash && !t.used);
      if(!record || new Date(record.expiresAt).getTime()<=now) return sendJson(res,400,{ok:false,message:'This password reset link is invalid or has expired. Please request a new link.'});
      const user=db.users.find(u=>u.id===record.userId && u.email===record.email);
      if(!user) return sendJson(res,400,{ok:false,message:'This password reset link is no longer valid.'});
      const p=hashPassword(password); user.salt=p.salt; user.passwordHash=p.hash; user.passwordChangedAt=new Date().toISOString();
      db.passwordResetTokens=(db.passwordResetTokens||[]).map(t=>t.userId===record.userId?{...t,used:true,usedAt:new Date().toISOString()}:t);
      await saveDb(db);
      return sendJson(res,200,{ok:true,message:'Your password has been changed successfully. You can now log in with the new password.'});
    } catch(e){return sendJson(res,400,{ok:false,message:'Could not change the password.'});}
  }


  if (req.method === 'POST' && url.pathname === '/api/login/2fa') {
    try{const body=await readBody(req);const c=(db.loginChallenges||[]).find(x=>x.id===String(body.challengeId||'')&&!x.used&&new Date(x.expiresAt).getTime()>Date.now());if(!c||hashCode(String(body.code||'').trim())!==c.codeHash)return sendJson(res,401,{ok:false,message:'Invalid or expired verification code.'});c.used=true;const u=db.users.find(x=>x.id===c.userId);if(!u)return sendJson(res,401,{ok:false,message:'Account not found.'});addAudit('LOGIN_2FA_SUCCESS',u.userId,{role:u.role});await saveDb(db);return sendJson(res,200,{ok:true,user:{id:u.userId,name:u.name,email:u.email||'',phone:u.phone||'',dob:u.dob||'',role:u.role,profilePic:u.profilePic||null,contactSync:!!u.contactSync,twoFactorEnabled:true}});}catch(e){return sendJson(res,400,{ok:false,message:'Could not verify the code.'});}
  }
  if (req.method === 'POST' && url.pathname === '/api/security/2fa') {
    try{const body=await readBody(req);const u=db.users.find(x=>x.userId===String(body.userId||'').trim().toUpperCase());if(!u)return sendJson(res,404,{ok:false,message:'User not found.'});const enabled=!!body.enabled;if(enabled&&!validEmail(u.email))return sendJson(res,400,{ok:false,message:'Add a valid email address before enabling two-factor authentication.'});u.twoFactorEnabled=enabled;u.securityUpdatedAt=new Date().toISOString();addAudit(enabled?'2FA_ENABLED':'2FA_DISABLED',u.userId);await saveDb(db);return sendJson(res,200,{ok:true,twoFactorEnabled:enabled,message:enabled?'Two-factor authentication enabled. The next interviewer/admin login will require an email code.':'Two-factor authentication disabled.'});}catch(e){return sendJson(res,400,{ok:false,message:'Could not update two-factor authentication.'});}
  }
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    const uid=String(url.searchParams.get('userId')||'');const items=(db.notifications||[]).filter(n=>!uid||n.userId===uid||n.userId==='*').slice(0,100);return sendJson(res,200,{ok:true,notifications:items});
  }
  if (req.method === 'POST' && url.pathname === '/api/notifications/read') {
    try{const body=await readBody(req);const ids=Array.isArray(body.ids)?body.ids.map(String):[];(db.notifications||[]).forEach(n=>{if(ids.includes(n.id))n.read=true;});await saveDb(db);return sendJson(res,200,{ok:true});}catch(e){return sendJson(res,400,{ok:false,message:'Could not update notifications.'});}
  }
  if (req.method === 'GET' && url.pathname === '/api/question-bank') {
    const q=String(url.searchParams.get('q')||'').toLowerCase();const cat=String(url.searchParams.get('category')||'').toLowerCase();let items=db.questionBank||[];if(q)items=items.filter(x=>[x.question,x.category,x.difficulty].some(v=>String(v||'').toLowerCase().includes(q)));if(cat)items=items.filter(x=>String(x.category||'').toLowerCase()===cat);return sendJson(res,200,{ok:true,questions:items});
  }
  if (req.method === 'POST' && url.pathname === '/api/question-bank') {
    try{const b=await readBody(req);if(!String(b.question||'').trim())return sendJson(res,400,{ok:false,message:'Question is required.'});const item={id:makeId(),question:String(b.question).trim(),category:String(b.category||'General').trim(),difficulty:String(b.difficulty||'Medium').trim(),expectedTopics:String(b.expectedTopics||'').trim(),createdBy:String(b.createdBy||'').trim(),createdAt:new Date().toISOString()};db.questionBank=db.questionBank||[];db.questionBank.unshift(item);await saveDb(db);return sendJson(res,201,{ok:true,question:item});}catch(e){return sendJson(res,400,{ok:false,message:'Could not save question.'});}
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/question-bank/')) {const id=decodeURIComponent(url.pathname.split('/').pop());db.questionBank=(db.questionBank||[]).filter(x=>x.id!==id);await saveDb(db);return sendJson(res,200,{ok:true});}
  if (req.method === 'GET' && url.pathname === '/api/analytics') {
    const sessions=db.sessions||[];const completed=sessions.filter(s=>['Completed','Passed','Failed','Rejected','Terminated'].includes(s.status));const avgDuration=completed.filter(s=>s.startedAt&&s.endedAt).map(s=>(new Date(s.endedAt)-new Date(s.startedAt))/60000);const avg=avgDuration.length?(avgDuration.reduce((a,b)=>a+b,0)/avgDuration.length):0;const byStatus={};sessions.forEach(s=>{byStatus[s.status||'Unknown']=(byStatus[s.status||'Unknown']||0)+1;});return sendJson(res,200,{ok:true,metrics:{totalSessions:sessions.length,completed:completed.length,passed:sessions.filter(s=>s.decision==='Passed').length,failed:sessions.filter(s=>s.decision==='Failed'||['Failed','Rejected','Terminated'].includes(s.status)).length,needsReview:sessions.filter(s=>s.decision==='Review'||(s.status==='Completed'&&!s.decision)).length,totalWarnings:sessions.reduce((n,s)=>n+Number(s.warnings||0),0),averageMinutes:Math.round(avg*10)/10,byStatus}});
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/waiting-room$/)) {try{const id=decodeURIComponent(url.pathname.split('/')[3]);const s=db.sessions.find(x=>x.id===id);if(!s)return sendJson(res,404,{ok:false,message:'Session not found.'});s.status='Waiting Room';s.waitingAt=new Date().toISOString();s.updatedAt=new Date().toISOString();pushNotification(s.interviewerId,'waiting-room','Candidate waiting',`${s.candidateName||'Candidate'} is waiting to be admitted.`,{sessionId:id});addAudit('CANDIDATE_WAITING',s.candidateId,{sessionId:id});await saveDb(db);return sendJson(res,200,{ok:true,session:s});}catch(e){return sendJson(res,400,{ok:false,message:'Could not enter waiting room.'});}}
  if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/admit$/)) {try{const id=decodeURIComponent(url.pathname.split('/')[3]);const s=db.sessions.find(x=>x.id===id);if(!s)return sendJson(res,404,{ok:false,message:'Session not found.'});s.admittedAt=new Date().toISOString();s.status='Scheduled';s.updatedAt=new Date().toISOString();pushNotification(s.candidateId,'admitted','You were admitted',`The interviewer admitted you to ${s.id}. You can begin verification.`,{sessionId:id});addAudit('CANDIDATE_ADMITTED',s.interviewerId,{sessionId:id});await saveDb(db);return sendJson(res,200,{ok:true,session:s});}catch(e){return sendJson(res,400,{ok:false,message:'Could not admit candidate.'});}}
  if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/connection$/)) {try{const id=decodeURIComponent(url.pathname.split('/')[3]);const s=db.sessions.find(x=>x.id===id);if(!s)return sendJson(res,404,{ok:false,message:'Session not found.'});const b=await readBody(req);s.connection=s.connection||[];s.connection.push({online:!!b.online,rtt:Number(b.rtt||0),downlink:Number(b.downlink||0),type:String(b.type||'unknown'),at:new Date().toISOString()});if(s.connection.length>100)s.connection=s.connection.slice(-100);s.updatedAt=new Date().toISOString();await saveDb(db);return sendJson(res,200,{ok:true});}catch(e){return sendJson(res,400,{ok:false,message:'Could not record connection quality.'});}}
  if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/consent$/)) {try{const id=decodeURIComponent(url.pathname.split('/')[3]);const s=db.sessions.find(x=>x.id===id);if(!s)return sendJson(res,404,{ok:false,message:'Session not found.'});const b=await readBody(req);s.consentRecord={version:String(b.version||'1.0'),accepted:!!b.accepted,acceptedAt:new Date().toISOString(),items:Array.isArray(b.items)?b.items:[]};s.updatedAt=new Date().toISOString();await saveDb(db);return sendJson(res,200,{ok:true,consent:s.consentRecord});}catch(e){return sendJson(res,400,{ok:false,message:'Could not record consent.'});}}
  if (req.method === 'GET' && url.pathname.match(/^\/api\/calendar\/[^/]+\.ics$/)) {const id=decodeURIComponent(url.pathname.split('/').pop().replace(/\.ics$/,''));const s=db.sessions.find(x=>x.id===id);if(!s)return sendJson(res,404,{ok:false,message:'Session not found.'});const dt=new Date(s.scheduledAt||Date.now()).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const end=new Date(new Date(s.scheduledAt||Date.now()).getTime()+60*60*1000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const ics=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HireTrust//Interview//EN\r\nBEGIN:VEVENT\r\nUID:${s.id}@hiretrust\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}\r\nDTSTART:${dt}\r\nDTEND:${end}\r\nSUMMARY:HireTrust Interview - ${String(s.candidateName||'Candidate').replace(/[\r\n,;]/g,' ')}\r\nDESCRIPTION:HireTrust interview session ${s.id}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename=hiretrust-${s.id}.ics`});return res.end(ics);}
  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {const adminId=String(url.searchParams.get('userId')||'').toUpperCase();const u=db.users.find(x=>x.userId===adminId);if(!u||u.role!=='admin')return sendJson(res,403,{ok:false,message:'Admin access required.'});const sessions=db.sessions||[];return sendJson(res,200,{ok:true,users:(db.users||[]).map(x=>({id:x.userId,name:x.name,email:x.email||'',role:x.role,twoFactorEnabled:!!x.twoFactorEnabled,createdAt:x.createdAt||null})),metrics:{users:(db.users||[]).length,candidates:(db.users||[]).filter(x=>x.role==='candidate').length,interviewers:(db.users||[]).filter(x=>x.role==='interviewer').length,admins:(db.users||[]).filter(x=>x.role==='admin').length,sessions:sessions.length,active:sessions.filter(x=>['Interview In Progress','Waiting Room','Ready','Scheduled'].includes(x.status)).length,failed:sessions.filter(x=>['Failed','Rejected','Terminated'].includes(x.status)).length},audit:(db.auditLog||[]).slice(0,100)});}
  if (req.method === 'POST' && url.pathname === '/api/admin/retention') {try{const b=await readBody(req);const admin=db.users.find(x=>x.userId===String(b.userId||'').toUpperCase());if(!admin||admin.role!=='admin')return sendJson(res,403,{ok:false,message:'Admin access required.'});const days=Math.max(1,Math.min(3650,Number(b.days||90)));const cutoff=Date.now()-days*86400000;const dryRun=b.dryRun!==false;const targets=(db.sessions||[]).filter(s=>new Date(s.endedAt||s.updatedAt||s.createdAt||0).getTime()<cutoff);if(!dryRun){targets.forEach(s=>{delete s.facePhoto;delete s.idDocument;delete s.audioChunks;delete s.audioRecording;delete s.connection;});addAudit('RETENTION_PURGE',admin.userId,{days,records:targets.length},'Warning');await saveDb(db);}return sendJson(res,200,{ok:true,dryRun,days,records:targets.length,message:dryRun?`${targets.length} old session record(s) would be privacy-redacted.`:`${targets.length} old session record(s) were privacy-redacted.`});}catch(e){return sendJson(res,400,{ok:false,message:'Could not process retention policy.'});}}

  if (req.method === 'GET' && url.pathname === '/api/profile') {
    const userId=String(url.searchParams.get('userId')||'').trim().toUpperCase();
    const user=db.users.find(u=>u.userId===userId);
    if(!user)return sendJson(res,404,{ok:false,message:'User not found.'});
    return sendJson(res,200,{ok:true,profile:{id:user.userId,name:user.name,email:user.email||'',phone:user.phone||'',dob:user.dob||'',role:user.role,contactSync:!!user.contactSync,createdAt:user.createdAt||null,profilePic:user.profilePic||null}});
  }

  if (req.method === 'POST' && url.pathname === '/api/profile') {
    try{
      const body=await readBody(req); const userId=String(body.userId||'').trim().toUpperCase();
      const user=db.users.find(u=>u.userId===userId); if(!user)return sendJson(res,404,{ok:false,message:'User not found.'});
      if(body.dob!==undefined)user.dob=String(body.dob||'').trim(); if(body.contactSync!==undefined)user.contactSync=!!body.contactSync; if(body.profilePic!==undefined){
        const pic=String(body.profilePic||'');
        if(pic && !/^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(pic))return sendJson(res,400,{ok:false,message:'Profile picture must be JPG/JPEG or PNG.'});
        if(pic.length>1_800_000)return sendJson(res,413,{ok:false,message:'Profile picture is too large. Please use an image under about 1.3 MB.'});
        user.profilePic=pic||null;
      }
      user.profileUpdatedAt=new Date().toISOString(); saveDb(db);
      return sendJson(res,200,{ok:true,message:'Profile updated successfully.',profile:{id:user.userId,name:user.name,email:user.email||'',phone:user.phone||'',dob:user.dob||'',role:user.role,contactSync:!!user.contactSync,createdAt:user.createdAt||null,profilePic:user.profilePic||null}});
    }catch(e){return sendJson(res,400,{ok:false,message:'Could not update profile.'});}
  }

  if (req.method === 'GET' && url.pathname === '/api/email-settings') {
    return sendJson(res,200,{ok:true,settings:publicSmtpSettings()});
  }
  if (req.method === 'GET' && url.pathname === '/api/email-settings/diagnostics') {
    const cfg=loadSmtpSettings();
    const placeholder=/YOUR_GMAIL|YOUR_EMAIL|example\.com/i;
    return sendJson(res,200,{ok:true,diagnostics:{nodemailerInstalled:!!nodemailer,hostConfigured:!!cfg.host,port:cfg.port,userConfigured:!!cfg.user,passwordConfigured:!!cfg.pass,fromConfigured:!!cfg.from,placeholderCredentials:placeholder.test(String(cfg.user||''))||placeholder.test(String(cfg.from||'')),from:cfg.from||'',host:cfg.host||'',port:cfg.port}});
  }
  if (req.method === 'POST' && url.pathname === '/api/email-settings') {
    try {
      const body=await readBody(req);
      if(!body.host || !body.user || !body.from) return sendJson(res,400,{ok:false,message:'SMTP host, username and From email are required.'});
      if(/YOUR_GMAIL|YOUR_EMAIL|example\.com/i.test(String(body.user)) || /YOUR_GMAIL|YOUR_EMAIL|example\.com/i.test(String(body.from))) return sendJson(res,400,{ok:false,message:'Replace the placeholder Gmail address with your real Gmail address.'});
      if(!validEmail(body.user)) return sendJson(res,400,{ok:false,message:'SMTP username must be a valid Gmail/email address.'});
      if(!validEmail(body.from)) return sendJson(res,400,{ok:false,message:'From email must be a valid email address.'});
      const port=Number(body.port||587); if(!Number.isInteger(port)||port<1||port>65535) return sendJson(res,400,{ok:false,message:'SMTP port must be between 1 and 65535.'});
      const settings=saveSmtpSettings({...body,port});
      return sendJson(res,200,{ok:true,settings,message:'Email settings saved securely on this server.'});
    } catch(e){return sendJson(res,400,{ok:false,message:'Could not save email settings.'});}
  }
  if (req.method === 'POST' && url.pathname === '/api/email-settings/test') {
    try {
      const body=await readBody(req); const to=String(body.to||'').trim();
      if(!validEmail(to))return sendJson(res,400,{ok:false,message:'Enter a valid test recipient email address.'});
      const t=await createMailTransporter(); if(t.error)return sendJson(res,400,{ok:false,message:`SMTP connection failed: ${t.error}`});
      await t.transporter.sendMail({from:t.cfg.from,to,subject:'HireTrust SMTP test',html:'<h2>HireTrust</h2><p>Your SMTP settings are working correctly.</p>'});
      return sendJson(res,200,{ok:true,message:`Test email sent to ${to}.`});
    } catch(e){return sendJson(res,400,{ok:false,message:`SMTP test failed: ${e.message}`});}
  }

  if (req.method === 'POST' && url.pathname === '/api/schedule') {
    try {
      const body = await readBody(req);
      if (!validEmail(body.candidateEmail) || !validEmail(body.interviewerEmail)) return sendJson(res,400,{ok:false,message:'A valid candidate email and interviewer email are required so both receive the interview notification.'});
      if (!body.scheduledAt || Number.isNaN(Date.parse(body.scheduledAt))) return sendJson(res,400,{ok:false,message:'A valid interview date and time is required.'});
      const candidate=db.users.find(u=>u.userId===String(body.candidateId||'').trim().toUpperCase() && u.role==='candidate');
      const interviewer=db.users.find(u=>u.userId===String(body.interviewerId||'').trim().toUpperCase() && u.role==='interviewer');
      const id = body.sessionId || `PG-${Math.floor(Math.random()*90000+10000)}`;
      const session={id,candidateId:body.candidateId||'',candidateName:body.candidateName||'',candidateEmail:body.candidateEmail.trim().toLowerCase(),candidatePhone:candidate?.phone||body.candidatePhone||'',interviewerId:body.interviewerId||'',interviewerName:body.interviewerName||'',interviewerEmail:body.interviewerEmail.trim().toLowerCase(),interviewerPhone:interviewer?.phone||body.interviewerPhone||'',scheduledAt:new Date(body.scheduledAt).toISOString(),status:'Scheduled',decision:null,warnings:0,violations:[],audioConsent:false,voiceMonitoring:'advisory',createdAt:new Date().toISOString(),startedAt:null,endedAt:null,updatedAt:new Date().toISOString(),reason:''};
      const idx=db.sessions.findIndex(x=>x.id===id); if(idx>=0)db.sessions[idx]={...db.sessions[idx],...session}; else db.sessions.push(session);  saveDb(db);
      const when=formatDateTime(session.scheduledAt);
      pushNotification(session.candidateId,'interview-scheduled','Interview scheduled',`Your HireTrust interview is scheduled for ${when}.`,{sessionId:id}); pushNotification(session.interviewerId,'interview-scheduled','Interview scheduled',`Your interview with ${session.candidateName||'candidate'} is scheduled for ${when}.`,{sessionId:id}); addAudit('INTERVIEW_SCHEDULED',session.interviewerId,{sessionId:id,candidateId:session.candidateId});
      const tz=formatTimeZoneName();
      const safe=(v)=>String(v||'').replace(/[<>]/g,'');
      const subject=`HireTrust | Interview Confirmed | ${when} ${tz}`;
      const candidateHtml=`<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#4055c7;color:#fff;padding:24px;border-radius:16px 16px 0 0"><h1 style="margin:0">HireTrust</h1><p style="margin:8px 0 0">Interview confirmation & preparation details</p></div><div style="padding:28px;border:1px solid #e6eaf2;border-top:0;border-radius:0 0 16px 16px"><h2>Your interview is scheduled</h2><p>Hello <b>${safe(session.candidateName)}</b>,</p><p>Your HireTrust interview has been successfully scheduled. Please join the portal a few minutes early so you have enough time to complete the verification steps.</p><div style="background:#f5f7ff;padding:18px;border-radius:12px"><p><b>Date & time:</b> ${when} ${tz}</p><p><b>Interviewer:</b> ${safe(session.interviewerName)}</p><p><b>Interviewer ID:</b> ${safe(session.interviewerId)}</p><p><b>Session ID:</b> ${safe(session.id)}</p></div><h3>Before you join</h3><ul><li>Use a laptop/desktop with a working camera and microphone.</li><li>Keep your government ID available for verification.</li><li>Complete the room verification when prompted.</li><li>Use a stable internet connection and remain available for the scheduled time.</li></ul><p><b>Portal:</b> Open your HireTrust portal at the scheduled time.</p><div style="margin-top:22px;padding:16px 18px;background:#f8f9fc;border-left:4px solid #4055c7;border-radius:10px;color:#4b5568"><b>Need further assistance?</b><br>If you need any help before or during your interview, our HireTrust support team is happy to assist you. Please contact us at <a href="mailto:hiretrusthelp@gmail.com" style="color:#4055c7;font-weight:600">hiretrusthelp@gmail.com</a> or call <b>+91xxxxxxxxxxx</b>.</div></div></div>`;
      const interviewerHtml=`<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#4055c7;color:#fff;padding:24px;border-radius:16px 16px 0 0"><h1 style="margin:0">HireTrust</h1><p style="margin:8px 0 0">Interview scheduling notification</p></div><div style="padding:28px;border:1px solid #e6eaf2;border-top:0;border-radius:0 0 16px 16px"><h2>Interview scheduled successfully</h2><p>Hello <b>${safe(session.interviewerName)}</b>,</p><p>The following candidate interview has been added to your HireTrust schedule.</p><div style="background:#f5f7ff;padding:18px;border-radius:12px"><p><b>Date & time:</b> ${when} ${tz}</p><p><b>Candidate:</b> ${safe(session.candidateName)}</p><p><b>Candidate ID:</b> ${safe(session.candidateId)}</p><p><b>Candidate email:</b> ${safe(session.candidateEmail)}</p><p><b>Candidate phone:</b> ${safe(session.candidatePhone||'Not provided')}</p><p><b>Session ID:</b> ${safe(session.id)}</p></div><h3>Interviewer checklist</h3><ul><li>Review the candidate profile before the session.</li><li>Be ready to review identity, room, camera and audio verification.</li><li>Monitor the session and record the final outcome after the interview.</li></ul><p><b>Portal:</b> Open the HireTrust interviewer dashboard at the scheduled time.</p></div></div>`;
      const [candidateMail, interviewerMail] = await Promise.all([sendInterviewEmail(session.candidateEmail,subject,candidateHtml),sendInterviewEmail(session.interviewerEmail,subject,interviewerHtml)]);
      session.emailNotice={candidate:candidateMail,interviewer:interviewerMail};
      const saved=db.sessions.find(x=>x.id===id); if(saved){saved.emailNotice=session.emailNotice;saved.updatedAt=new Date().toISOString();saveDb(db);}
      const allSent=!!candidateMail.sent && !!interviewerMail.sent; const partial=!allSent && (!!candidateMail.sent || !!interviewerMail.sent); return sendJson(res,201,{ok:true,session,emailNotice:session.emailNotice,message:allSent?'Interview saved and email notifications were sent to both candidate and interviewer.':partial?'Interview saved. One email was sent, but the other notification failed. Check Email Settings → Send Test Email.': 'Interview saved. Email notifications were not sent. Configure a sender SMTP account in Email Settings (candidate email alone is not SMTP configuration).',mailConfigured:allSent||partial});
    } catch(e){ console.error('Schedule error:',e.message); return sendJson(res,400,{ok:false,message:`Could not schedule interview: ${e.message}`}); }
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/feedback')) {
    try {
      const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]);
      const body=await readBody(req); const session=db.sessions.find(x=>x.id===sessionId);
      if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
      const rating=Number(body.rating); if(!Number.isInteger(rating)||rating<1||rating>5)return sendJson(res,400,{ok:false,message:'Feedback rating must be between 1 and 5.'});
      const comment=String(body.comment||'').trim(); if(comment.length>1000)return sendJson(res,400,{ok:false,message:'Feedback is limited to 1000 characters.'});
      session.feedback={rating,comment,submittedBy:String(body.submittedBy||session.candidateId||''),status:String(body.status||session.status||'Completed'),createdAt:new Date().toISOString()};
      session.updatedAt=new Date().toISOString(); saveDb(db);
      return sendJson(res,200,{ok:true,message:'Feedback saved successfully.',feedback:session.feedback});
    } catch(e){return sendJson(res,400,{ok:false,message:'Could not save feedback.'});}
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/result-email')) {
    try {
      const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]);
      const body=await readBody(req); const session=db.sessions.find(x=>x.id===sessionId);
      if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
      if(!validEmail(session.candidateEmail))return sendJson(res,400,{ok:false,message:'Candidate email is invalid.'});
      const result=String(body.result||session.decision||'Failed');
      const when=session.endedAt?new Date(session.endedAt).toLocaleString():new Date().toLocaleString();
      const subject=`HireTrust interview result — ${result}`;
      const html=`<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><div style="background:#4055c7;color:#fff;padding:24px;border-radius:16px 16px 0 0"><h1 style="margin:0">HireTrust</h1><p style="margin:8px 0 0">Interview result notification</p></div><div style="padding:28px;border:1px solid #e6eaf2;border-top:0;border-radius:0 0 16px 16px"><h2>Interview Result</h2><p>Hello <b>${String(session.candidateName||'Candidate').replace(/[<>]/g,'')}</b>,</p><p>Your interview session <b>${session.id}</b> ended on <b>${when}</b>.</p><div style="background:#f5f7ff;padding:18px;border-radius:12px"><p style="margin:0"><b>Result: ${result}</b></p></div><div style="margin-top:22px;padding:16px 18px;background:#f8f9fc;border-left:4px solid #4055c7;border-radius:10px;color:#4b5568"><b>Need further assistance?</b><br>If you have any questions or need further assistance regarding your interview result, our HireTrust support team is happy to help. Please contact us at <a href="mailto:hiretrusthelp@gmail.com" style="color:#4055c7;font-weight:600">hiretrusthelp@gmail.com</a> or call <b>+91xxxxxxxxxxx</b>.</div><p style="margin-top:24px;color:#6b7487">Thank you for using HireTrust.</p></div></div>`;
      const email=await sendInterviewEmail(session.candidateEmail,subject,html);
      session.resultEmail=email;session.updatedAt=new Date().toISOString();saveDb(db);
      return sendJson(res,200,{ok:true,email});
    }catch(e){return sendJson(res,400,{ok:false,message:'Could not send result email.'});}
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/monitor-event$/)) {
    try {
      const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]); const body=await readBody(req);
      const session=db.sessions.find(s=>s.id===sessionId); if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
      session.monitorEvents=session.monitorEvents||[];
      session.monitorEvents.push({id:makeId(),type:String(body.type||'Monitoring event'),details:body.details||{},severity:body.severity||'Warning',createdAt:new Date().toISOString()});
      if(session.monitorEvents.length>200)session.monitorEvents=session.monitorEvents.slice(-200);
      if(body.severity==='Warning'){
        session.warnings=Number(session.warnings||0)+1;
        session.violations=session.violations||[];
        session.violations.push({time:new Date().toISOString(),reason:String(body.type||'Monitoring warning')});
      }
      session.updatedAt=new Date().toISOString(); addAudit('MONITOR_EVENT',session.candidateId,{sessionId, type:String(body.type||'Monitoring event'), severity:body.severity||'Warning'},body.severity||'Info'); await saveDb(db); return sendJson(res,201,{ok:true});
    }catch(e){return sendJson(res,400,{ok:false,message:'Could not store monitoring event.'});}
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/sessions\/[^/]+\/phone-status$/)) {
    const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]); const session=db.sessions.find(s=>s.id===sessionId);
    if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
    const now=Date.now(); const devices=(session.phoneDevices||[]).filter(d=>now-new Date(d.lastSeen).getTime()<20000);
    session.phoneDevices=devices; session.updatedAt=new Date().toISOString(); saveDb(db); return sendJson(res,200,{ok:true,devices});
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/phone-heartbeat$/)) {
    try{
      const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]); const body=await readBody(req); const session=db.sessions.find(s=>s.id===sessionId);
      if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
      const deviceId=String(body.deviceId||''); if(!deviceId)return sendJson(res,400,{ok:false,message:'Device ID required.'});
      session.phoneDevices=session.phoneDevices||[]; const ip=req.socket.remoteAddress||''; let d=session.phoneDevices.find(x=>x.deviceId===deviceId);
      if(!d){d={deviceId,firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString(),ip,networkHint:String(body.networkHint||'')};session.phoneDevices.push(d);} else {d.lastSeen=new Date().toISOString();d.ip=ip;d.networkHint=String(body.networkHint||d.networkHint||'');}
      session.updatedAt=new Date().toISOString(); saveDb(db); return sendJson(res,200,{ok:true,device:{deviceId:d.deviceId,lastSeen:d.lastSeen,ip:d.ip,networkHint:d.networkHint}});
    }catch(e){return sendJson(res,400,{ok:false,message:'Could not update phone heartbeat.'});}
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    try {
      const body = await readBody(req);
      if(body.idDocument && (typeof body.idDocument!=='string' || body.idDocument.length>1_400_000 || !/^data:application\/(pdf)|data:image\/(jpeg|jpg);base64,/.test(body.idDocument))) return sendJson(res,400,{ok:false,message:'Government ID document is invalid or too large.'});
      const now = new Date().toISOString();
      const session = { id: body.sessionId || `PG-${Math.floor(Math.random()*90000+10000)}`, candidateId:body.candidateId, candidateName:body.candidateName, candidateEmail:body.candidateEmail || '', candidatePhone:body.candidatePhone || '', interviewerId:body.interviewerId || '', interviewerName:body.interviewerName || '', interviewerEmail:body.interviewerEmail || '', interviewerPhone:body.interviewerPhone || '', roomViews:body.roomViews || {}, status:body.status || 'Ready', decision:body.decision || null, warnings:Number(body.warnings||0), violations:body.violations || [], audioConsent:!!body.audioConsent, voiceMonitoring:'advisory', createdAt:body.createdAt || now, startedAt:body.startedAt || null, endedAt:body.endedAt || null, updatedAt:now, reason:body.reason || '', scheduledAt:body.scheduledAt || null, facePhoto:body.facePhoto || null, faceMatchScore:body.faceMatchScore ?? null, faceMatchStatus:body.faceMatchStatus || 'Not checked', idFileName:body.idFileName || '', idDocument:body.idDocument || null, emailNotice:body.emailNotice || null, phoneDevices:body.phoneDevices || [], monitorEvents:body.monitorEvents || [], interviewerReview:body.interviewerReview || null, consentRecord:body.consentRecord || null, waitingAt:body.waitingAt||null, admittedAt:body.admittedAt||null, connection:body.connection||[], questionPlan:body.questionPlan||[], chatMessages:Array.isArray(body.chatMessages)?body.chatMessages:(db.sessions.find(s=>s.id===(body.sessionId||body.id))?.chatMessages||[]), createdBy:body.createdBy||body.interviewerId||'' };
      const idx = db.sessions.findIndex(s => s.id === session.id);
      if (idx >= 0) db.sessions[idx] = { ...db.sessions[idx], ...session, updatedAt:new Date().toISOString() }; else db.sessions.push(session);
      saveDb(db);
      return sendJson(res, 200, { ok:true, session });
    } catch { return sendJson(res, 400, { ok:false, message:'Could not save session.' }); }
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/audio')) {
    try {
      const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]);
      const body=await readBody(req);
      const session=db.sessions.find(s=>s.id===sessionId);
      if(!session) return sendJson(res,404,{ok:false,message:'Session not found.'});
      if(!session.audioConsent) return sendJson(res,403,{ok:false,message:'Audio consent was not recorded.'});
      if(!body.data) return sendJson(res,400,{ok:false,message:'Audio data is required.'});
      const recordingsDir=path.join(ROOT,'recordings',sessionId); fs.mkdirSync(recordingsDir,{recursive:true});
      const safeMime=String(body.mimeType||'audio/webm').split(';')[0];
      const ext=safeMime.includes('ogg')?'ogg':safeMime.includes('mp4')?'m4a':'webm';
      const filename=`${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(recordingsDir,filename),Buffer.from(body.data,'base64'));
      session.audioChunks=(session.audioChunks||0)+1; session.updatedAt=new Date().toISOString(); saveDb(db);
      return sendJson(res,201,{ok:true,stored:true,chunk:session.audioChunks});
    } catch(e){ return sendJson(res,400,{ok:false,message:'Could not store audio.'}); }
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/chat')) {
    try {
      const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]||'');
      const session=db.sessions.find(s=>s.id===sessionId);
      if(!session) return sendJson(res,404,{ok:false,message:'Session not found.'});
      const body=await readBody(req, 100_000);
      const message=String(body.message||'').trim();
      if(!message) return sendJson(res,400,{ok:false,message:'Message is required.'});
      if(message.length>1000) return sendJson(res,400,{ok:false,message:'Message is limited to 1000 characters.'});
      const role=String(body.senderRole||'').toLowerCase();
      if(!['candidate','interviewer'].includes(role)) return sendJson(res,400,{ok:false,message:'Invalid sender role.'});
      session.chatMessages=Array.isArray(session.chatMessages)?session.chatMessages:[];
      const item={id:makeId(),senderId:String(body.senderId||''),senderName:String(body.senderName||role).slice(0,120),senderRole:role,message,createdAt:new Date().toISOString()};
      session.chatMessages.push(item);
      if(session.chatMessages.length>200) session.chatMessages=session.chatMessages.slice(-200);
      session.updatedAt=new Date().toISOString(); saveDb(db);
      return sendJson(res,201,{ok:true,message:item});
    } catch(e){ return sendJson(res,400,{ok:false,message:'Could not send chat message.'}); }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/chat')) {
    const parts=url.pathname.split('/'); const sessionId=decodeURIComponent(parts[3]||'');
    const session=db.sessions.find(s=>s.id===sessionId);
    if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
    return sendJson(res,200,{ok:true,messages:Array.isArray(session.chatMessages)?session.chatMessages:[]});
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/webrtc/')) {
    try {
      const sessionId=decodeURIComponent(url.pathname.split('/')[3]||'');
      const session=db.sessions.find(s=>s.id===sessionId);
      if(!session) return sendJson(res,404,{ok:false,message:'Session not found.'});
      const body=await readBody(req);
      session.signals=session.signals||[];
      session.signals.push({id:makeId(),from:body.from||'unknown',type:body.type,payload:body.payload||null,createdAt:new Date().toISOString()});
      // Keep signaling data short-lived and bounded.
      if(session.signals.length>200)session.signals=session.signals.slice(-200);
      session.updatedAt=new Date().toISOString(); saveDb(db);
      return sendJson(res,201,{ok:true});
    } catch(e){return sendJson(res,400,{ok:false,message:'Could not store signaling message.'});}
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/webrtc/')) {
    const sessionId=decodeURIComponent(url.pathname.split('/')[3]||'');
    const session=db.sessions.find(s=>s.id===sessionId);
    if(!session)return sendJson(res,404,{ok:false,message:'Session not found.'});
    return sendJson(res,200,{ok:true,signals:session.signals||[]});
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    if(!q) return sendJson(res,200,{ok:true,users:[],sessions:[]});
    const users=(db.users||[]).filter(u=>u.role==='candidate' && [u.name,u.userId,u.email,u.phone].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,50).map(u=>({id:u.userId,name:u.name,email:u.email||'',phone:u.phone||'',role:u.role,profilePic:u.profilePic||null}));
    const sessions=(db.sessions||[]).filter(s=>[s.candidateName,s.candidateId,s.candidateEmail,s.candidatePhone,s.interviewerName,s.id,s.status].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,50);
    return sendJson(res,200,{ok:true,users,sessions});
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    const role=String(url.searchParams.get('role')||'').trim().toLowerCase();
    let users=db.users||[]; if(role) users=users.filter(u=>u.role===role);
    if(q) users=users.filter(u=>[u.name,u.userId,u.email,u.phone].some(v=>String(v||'').toLowerCase().includes(q)));
    return sendJson(res,200,{ok:true,users:users.slice(0,50).map(u=>({id:u.userId,name:u.name,email:u.email||'',phone:u.phone||'',role:u.role,profilePic:u.profilePic||null,createdAt:u.createdAt||null}))});
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const uid=String(url.searchParams.get('userId')||'').trim().toUpperCase();
    const role=String(url.searchParams.get('role')||'').trim().toLowerCase();
    let sessions=db.sessions;
    if(uid){
      sessions=sessions.filter(s=>role==='candidate' ? String(s.candidateId||'').toUpperCase()===uid : String(s.interviewerId||'').toUpperCase()===uid);
    }
    return sendJson(res,200,{ok:true,sessions});
  }

  if (url.pathname === '/phone.html') {
    const phoneHtml=`<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>HireTrust Phone Companion</title><style>body{font-family:system-ui;margin:0;padding:24px;background:#f5f7fb;color:#172033}.card{max-width:520px;margin:auto;background:white;padding:24px;border-radius:16px}.btn{padding:12px 16px;border:0;border-radius:9px;background:#4055c7;color:white;font-weight:700}</style></head><body><div class=\"card\"><h1>HireTrust Phone Companion</h1><p>This page lets the interview system know that this phone is present. It reports network-level presence only; it cannot measure physical distance in meters.</p><input id=\"session\" placeholder=\"Session ID\" style=\"width:100%;padding:10px;margin:8px 0\"><button class=\"btn\" onclick=\"join()\">Join Session</button><p id=\"status\"></p></div><script>let id='phone-'+makeId();let timer;async function join(){const s=document.getElementById('session').value.trim();if(!s)return;async function hb(){try{const r=await fetch('/api/sessions/'+encodeURIComponent(s)+'/phone-heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:id,networkHint:navigator.connection?.type||'unknown'})});document.getElementById('status').textContent=r.ok?'Phone companion connected. Keep this page open.':'Session not found.';}catch(e){document.getElementById('status').textContent='Connection failed.';}}await hb();clearInterval(timer);timer=setInterval(hb,5000);}</script></body></html>`;
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(phoneHtml);
  }

  const spaRoute = url.pathname === '/' || url.pathname === '/reset-password';
  let filePath = spaRoute ? path.join(ROOT, 'index.html') : path.join(ROOT, url.pathname.replace(/^\//, ''));
  if (!filePath.startsWith(ROOT)) return sendJson(res, 403, { ok:false, message:'Forbidden' });
  sendFile(res, filePath);
});

(async () => {
  try {
    await initMongo();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(
        `HireTrust running on port ${PORT} | timezone ${APP_TIMEZONE}`
      );
    });

  } catch (e) {
    console.error('HireTrust startup failed:', e.message);
    process.exit(1);
  }
})();
