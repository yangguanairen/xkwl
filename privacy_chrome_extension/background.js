import { FEISHU_URL, DOCS, TEMPLATES, parseBaseUrl, renderDocument, validateChannel } from './core.js';
import { readFeishuRecords, synchronize } from './api.js';

const DEFAULT_SETTINGS = { baseUrl: FEISHU_URL, viewOnly: false };
let running = false;
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

async function loadSettings() {
  return (await chrome.storage.local.get('settings')).settings || DEFAULT_SETTINGS;
}

async function loadCredentials() {
  const local = await chrome.storage.local.get('feishuCredentials');
  const session = await chrome.storage.session.get('feishuCredentials');
  return session.feishuCredentials || local.feishuCredentials || {};
}

async function readWebsiteToken() {
  const tabs = await chrome.tabs.query({ url: 'https://www.xingkongweilai.cn/*' });
  tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const tab of tabs) {
    try {
      const [value] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'ISOLATED',
        func: () => {
          if (location.origin !== 'https://www.xingkongweilai.cn') return '';
          return localStorage.getItem('Admin-Token') || sessionStorage.getItem('Admin-Token') || '';
        },
      });
      const token = typeof value?.result === 'string' ? value.result.trim().replace(/^Bearer\s+/i, '') : '';
      if (token) return token;
    } catch { /* Another matching tab may still be available. */ }
  }
  throw new Error('请在同一个浏览器中打开并登录星空未来网站，保留该标签页，再点击“重新检测”。');
}

async function loginStatus() {
  try { await readWebsiteToken(); return { available: true }; }
  catch (error) { return { available: false, message: error.message }; }
}

async function withExclusive(operation) {
  if (running) throw new Error('另一个任务正在执行，请等待完成后重试。');
  running = true;
  try { return await operation(); } finally { running = false; }
}

async function handle(message) {
  await storageReady;
  switch (message.type) {
    case 'GET_STATE': {
      const { appCache, selection } = await chrome.storage.local.get(['appCache', 'selection']);
      const settings = await loadSettings();
      const credentials = await loadCredentials();
      return { settings, appCache: appCache || null, selection: selection || null,
        configured: Boolean(credentials.token || (credentials.appId && credentials.appSecret)), running };
    }
    case 'GET_CONNECTION': {
      const settings = await loadSettings();
      const credentials = await loadCredentials();
      const local = await chrome.storage.local.get('feishuCredentials');
      return { settings, mode: credentials.mode || 'app', appId: credentials.appId || '',
        hasCredentials: Boolean(credentials.token || credentials.appSecret), remembered: Boolean(local.feishuCredentials) };
    }
    case 'SAVE_CONNECTION': return withExclusive(async () => {
      const settings = { baseUrl: String(message.settings?.baseUrl || '').trim(), viewOnly: message.settings?.viewOnly === true };
      const parsed = parseBaseUrl(settings.baseUrl);
      if (settings.viewOnly && !parsed.viewId) throw new Error('当前视图模式需要链接中包含 view 参数。');
      const previous = await loadCredentials();
      const input = message.credentials || {};
      const mode = input.mode === 'token' ? 'token' : 'app';
      const credentials = mode === 'app'
        ? { mode, appId: String(input.appId || '').trim(), appSecret: String(input.appSecret || '').trim() }
        : { mode, token: String(input.token || '').trim().replace(/^Bearer\s+/i, '') };
      if (mode === 'app' && !credentials.appSecret && previous.mode === mode && previous.appId === credentials.appId) credentials.appSecret = previous.appSecret;
      if (mode === 'token' && !credentials.token && previous.mode === mode) credentials.token = previous.token;
      if (mode === 'app' && (!/^cli_[a-zA-Z0-9]+$/.test(credentials.appId) || !credentials.appSecret)) {
        throw new Error('请填写有效的飞书 App ID（cli_ 开头）和 App Secret。');
      }
      if (mode === 'token' && !credentials.token) throw new Error('请填写飞书开放平台访问凭证。');
      // Complete the target write before removing the previous credentials.
      if (message.remember === true) {
        await chrome.storage.local.set({ settings, feishuCredentials: credentials });
        await chrome.storage.session.remove('feishuCredentials');
      } else {
        await chrome.storage.session.set({ feishuCredentials: credentials });
        await chrome.storage.local.set({ settings });
        await chrome.storage.local.remove('feishuCredentials');
      }
      await chrome.storage.local.remove(['appCache', 'selection']);
      return { saved: true };
    });
    case 'CLEAR_CONNECTION': return withExclusive(async () => {
      await chrome.storage.session.remove('feishuCredentials');
      await chrome.storage.local.remove(['feishuCredentials', 'appCache', 'selection']);
      return { cleared: true };
    });
    case 'REFRESH_APPS': return withExclusive(async () => {
      const result = await readFeishuRecords(await loadSettings(), await loadCredentials());
      const appCache = { ...result, updatedAt: Date.now(), revision: crypto.randomUUID() };
      await chrome.storage.local.set({ appCache });
      return { appCache };
    });
    case 'CHECK_LOGIN': return loginStatus();
    case 'OPEN_WEBSITE': await chrome.tabs.create({ url: 'https://www.xingkongweilai.cn/' }); return {};
    case 'OPEN_FEISHU': await chrome.tabs.create({ url: (await loadSettings()).baseUrl }); return {};
    case 'OPEN_SETTINGS': await chrome.runtime.openOptionsPage(); return {};
    case 'SAVE_SELECTION': {
      const channel = validateChannel(message.channel ?? 'dev');
      if (!running) await chrome.storage.local.set({ selection: {
        recordId: String(message.recordId || ''), template: message.template in TEMPLATES ? message.template : 'normal', channel,
      } });
      return {};
    }
    case 'RUN_SYNC': return withExclusive(async () => {
      const log = [];
      try {
        const { appCache } = await chrome.storage.local.get('appCache');
        if (!appCache || appCache.revision !== message.revision) throw new Error('应用列表已变化，请刷新后重新选择。');
        const record = appCache.records.find(item => item.id === message.recordId);
        if (!record) throw new Error('所选应用不在当前飞书列表中，请重新选择。');
        const appName = String(message.appName || '').trim();
        const companyName = String(message.companyName || '').trim();
        if (!appName || !companyName) throw new Error('请补全应用名称和主体名称。');
        if (appName.length > 500 || companyName.length > 500) throw new Error('应用名称或主体名称过长，请核对。');
        if (!(message.template in TEMPLATES)) throw new Error('请选择协议模板。');
        const channel = validateChannel(message.channel ?? 'dev');
        const token = await readWebsiteToken();
        log.push(`赛道：${record.track}；马甲号：${record.order}`, `应用：${appName}`, `主体：${companyName}`, `模板：${TEMPLATES[message.template].label}`, `渠道：${channel}`);
        const documents = {};
        for (const doc of DOCS) {
          const response = await fetch(chrome.runtime.getURL(`templates/${message.template}/${doc.file}`));
          if (!response.ok) throw new Error(`无法读取内置${doc.label}模板。`);
          documents[doc.key] = renderDocument(await response.text(), message.template, appName, companyName);
        }
        log.push('两份协议已生成，开始检查云端配置…');
        const result = await synchronize({ record, documents, token, channel, log: text => log.push(text) });
        return { ...result, log };
      } catch (error) {
        return { complete: false, results: [], log: [...log, error.message], error: error.message };
      }
    });
    default: throw new Error('不支持的操作。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const ownPages = [chrome.runtime.getURL('app.html'), chrome.runtime.getURL('settings.html')];
  if (sender.id !== chrome.runtime.id || !ownPages.includes(sender.url)) return false;
  handle(message).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const existing = (await chrome.tabs.query({ url }))[0];
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
});
