import { FEISHU_URL } from './core.js';
const $ = id => document.getElementById(id);
let busy = false;
async function call(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || '扩展后台未响应。');
  return response.data;
}
function setStatus(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function displayMode() {
  $('app-fields').hidden = $('auth-mode').value !== 'app';
  $('token-fields').hidden = $('auth-mode').value !== 'token';
  $('app-id').required = $('auth-mode').value === 'app';
}
function lock(value) {
  busy = value;
  document.querySelectorAll('input,select,button').forEach(element => { element.disabled = value; });
}
async function load() {
  const state = await call('GET_CONNECTION');
  $('base-url').value = state.settings.baseUrl || FEISHU_URL;
  $('view-only').checked = state.settings.viewOnly;
  $('auth-mode').value = state.mode;
  $('app-id').value = state.appId;
  $('remember').checked = state.remembered;
  $('app-secret').value = ''; $('feishu-token').value = '';
  $('app-secret').placeholder = state.hasCredentials && state.mode === 'app' ? '已保存；留空表示继续使用' : '填写飞书应用密钥';
  $('feishu-token').placeholder = state.hasCredentials && state.mode === 'token' ? '已保存；留空表示继续使用' : '填写开放平台访问凭证';
  $('credential-status').textContent = state.hasCredentials ? `已保存飞书凭证（${state.remembered ? '本机存储' : '当前浏览器会话'}）。` : '尚未配置飞书凭证。';
  displayMode();
}
$('auth-mode').addEventListener('change', displayMode);
$('connection').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  lock(true);
  try {
    await call('SAVE_CONNECTION', { settings: { baseUrl: $('base-url').value.trim(), viewOnly: $('view-only').checked },
      credentials: { mode: $('auth-mode').value, appId: $('app-id').value.trim(), appSecret: $('app-secret').value.trim(), token: $('feishu-token').value.trim() },
      remember: $('remember').checked });
    await load(); setStatus('已保存。返回工具后点击“刷新列表”验证连接。');
  } catch (error) { setStatus(error.message, true); }
  finally { lock(false); }
});
$('clear').addEventListener('click', async () => {
  if (busy) return;
  lock(true);
  try { await call('CLEAR_CONNECTION'); await load(); setStatus('已清除飞书凭证和本地应用列表。'); }
  catch (error) { setStatus(error.message, true); }
  finally { lock(false); }
});
try { await load(); } catch (error) { setStatus(error.message, true); }
