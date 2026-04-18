/* 中文備註：Google Drive OAuth 直連版。使用 Google OAuth 與 Google Drive API 直接備份與還原，不使用 Apps Script。 */
import { state, persistAll } from '../core/store.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
let tokenClient = null;
let accessToken = '';
let profileEmail = '';

function ensureGoogleDriveConfig(){
  if(!state.settings) state.settings = {};
  if(!state.settings.googleDriveBackup){
    state.settings.googleDriveBackup = {
      clientId: '',
      folderId: '',
      autoBackupEnabled: false,
      autoBackupMinutes: 60,
      lastBackupAt: '',
      lastRestoreAt: '',
      lastBackupStatus: '尚未備份',
      lastRestoreStatus: '尚未還原'
    };
  }
  return state.settings.googleDriveBackup;
}

export function getGoogleBackupConfig(){
  return ensureGoogleDriveConfig();
}

export function getGoogleDriveSession(){
  return {
    isSignedIn: !!accessToken,
    email: profileEmail || ''
  };
}

export function buildBackupPayload(){
  return {
    exportedAt: new Date().toISOString(),
    source: 'restaurant-pos',
    version: 'v2_1_16_google_oauth',
    payload: {
      categories: state.categories,
      modules: state.modules,
      products: state.products,
      pendingProducts: state.pendingProducts,
      orders: state.orders,
      settings: state.settings,
      reports: state.reports
    }
  };
}

function ensureGoogleLibraries(){
  if(!window.google?.accounts?.oauth2){
    throw new Error('Google OAuth 套件尚未載入');
  }
}

async function fetchGoogleProfile(){
  if(!accessToken) return;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if(!res.ok) return;
  const data = await res.json();
  profileEmail = data.email || '';
}

function getTokenClient(){
  ensureGoogleLibraries();
  const cfg = ensureGoogleDriveConfig();
  if(!cfg.clientId){
    throw new Error('請先設定 Google OAuth Client ID');
  }
  if(!tokenClient){
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: DRIVE_SCOPE,
      callback: () => {}
    });
  }
  return tokenClient;
}

async function requestAccessToken(promptMode = 'consent'){
  const client = getTokenClient();
  return await new Promise((resolve, reject) => {
    client.callback = async (resp) => {
      if(resp.error){
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token || '';
      await fetchGoogleProfile();
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: promptMode });
  });
}

export async function signInGoogleDrive(){
  await requestAccessToken('consent');
  return getGoogleDriveSession();
}

export function signOutGoogleDrive(){
  if(window.google?.accounts?.oauth2 && accessToken){
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = '';
  profileEmail = '';
}

async function ensureAuthorized(){
  if(accessToken) return accessToken;
  return await requestAccessToken('consent');
}

function buildDriveQuery(){
  const cfg = ensureGoogleDriveConfig();
  const folderPart = cfg.folderId ? `'${cfg.folderId}' in parents and ` : '';
  return `${folderPart}name contains 'pos-backup-' and trashed = false`;
}

async function driveFetch(url, options = {}){
  const token = await ensureAuthorized();
  const headers = Object.assign({}, options.headers || {}, {
    Authorization: `Bearer ${token}`
  });
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if(!res.ok){
    const txt = await res.text();
    throw new Error(`Google Drive API 失敗：HTTP ${res.status} ${txt}`);
  }
  return res;
}

export async function backupToGoogle(){
  const cfg = ensureGoogleDriveConfig();
  if(!cfg.clientId){
    throw new Error('請先設定 Google OAuth Client ID');
  }

  const metadata = {
    name: `pos-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    mimeType: 'application/json'
  };
  if(cfg.folderId) metadata.parents = [cfg.folderId];

  const boundary = 'restaurant-pos-boundary';
  const delimiter = `--${boundary}\r\n`;
  const closeDelimiter = `--${boundary}--`;
  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(buildBackupPayload()) + '\r\n' +
    closeDelimiter;

  const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });

  const data = await res.json();
  cfg.lastBackupAt = new Date().toISOString();
  cfg.lastBackupStatus = `備份成功：${data.name || data.id || '已建立檔案'}`;
  persistAll();
  return data;
}

export async function listGoogleBackups(){
  const q = encodeURIComponent(buildDriveQuery());
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime,size)`);
  const data = await res.json();
  return data.files || [];
}

export async function restoreFromGoogle(fileId = ''){
  const cfg = ensureGoogleDriveConfig();
  let targetFileId = fileId;

  if(!targetFileId){
    const files = await listGoogleBackups();
    if(!files.length){
      throw new Error('Google Drive 找不到備份檔');
    }
    targetFileId = files[0].id;
  }

  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${targetFileId}?alt=media`);
  const data = await res.json();
  const payload = data.payload || data.data || data;

  if(Array.isArray(payload.categories)) state.categories = payload.categories.includes('未分類') ? payload.categories : ['未分類', ...payload.categories];
  if(Array.isArray(payload.modules)) state.modules = payload.modules;
  if(Array.isArray(payload.products)) state.products = payload.products;
  if(Array.isArray(payload.pendingProducts)) state.pendingProducts = payload.pendingProducts;
  if(Array.isArray(payload.orders)) state.orders = payload.orders;
  if(payload.settings) state.settings = payload.settings;
  if(payload.reports) state.reports = payload.reports;

  const newCfg = ensureGoogleDriveConfig();
  newCfg.lastRestoreAt = new Date().toISOString();
  newCfg.lastRestoreStatus = '還原成功';
  persistAll();
  return payload;
}

let autoBackupTimer = null;

export function startGoogleAutoBackup(){
  const cfg = ensureGoogleDriveConfig();
  stopGoogleAutoBackup();
  if(!cfg.autoBackupEnabled) return;
  const minutes = Math.max(5, Number(cfg.autoBackupMinutes || 60));
  autoBackupTimer = setInterval(async ()=>{
    try{
      await backupToGoogle();
      if(typeof window.refreshGoogleBackupPanel === 'function') window.refreshGoogleBackupPanel();
    }catch(err){
      cfg.lastBackupStatus = err.message || '自動備份失敗';
      persistAll();
      if(typeof window.refreshGoogleBackupPanel === 'function') window.refreshGoogleBackupPanel();
      console.error(err);
    }
  }, minutes * 60 * 1000);
}

export function stopGoogleAutoBackup(){
  if(autoBackupTimer){
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

export async function initializeGoogleDriveApi(){
  ensureGoogleLibraries();
  if(window.gapi?.load){
    await new Promise(resolve => window.gapi.load('client', resolve));
    await window.gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
  }
}