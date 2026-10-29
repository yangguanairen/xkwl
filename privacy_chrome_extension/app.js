import { CHANNELS } from './core.js';

const $ = id => document.getElementById(id);
let cache = null;
let busy = false;
let loginAvailable = false;

async function call(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || '扩展后台未响应，请重新加载扩展。');
  return response.data;
}
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function selectedRecord() { return cache?.records.find(r => r.id === $('order').value); }
function updateTarget() { $('sync-target').textContent = `同步目标：Android / ${$('channel').value} · 已有记录更新，缺失记录创建`; }
function updateControls() {
  document.querySelectorAll('input,select,button').forEach(element => { element.disabled = busy; });
  $('track').disabled = busy || !cache?.records.length;
  $('order').disabled = busy || !$('track').value;
  $('run').disabled = busy || !selectedRecord() || !loginAvailable;
}
function clearResults() {
  $('results').replaceChildren();
  $('log').textContent = '等待执行任务…';
  $('details').open = false;
}
function fillRecord() {
  const record = selectedRecord();
  $('app-name').value = record?.appName || '';
  $('company-name').value = record?.companyName || '';
  clearResults();
  status(record ? '已带入应用信息，确认主体全称后即可同步。' : '请选择马甲号。');
  updateControls();
}
function filterOrders(recordId = '') {
  $('order').replaceChildren(new Option('请选择马甲号', ''));
  for (const record of cache?.records || []) {
    if (record.track === $('track').value) $('order').add(new Option(record.order, record.id));
  }
  $('order').value = recordId;
  fillRecord();
}
function populate(nextCache, selection) {
  cache = nextCache;
  $('track').replaceChildren(new Option(cache?.records.length ? '请选择赛道' : '请先加载飞书列表', ''));
  for (const track of new Set((cache?.records || []).map(r => r.track))) $('track').add(new Option(track, track));
  const selected = cache?.records.find(r => r.id === selection?.recordId);
  $('track').value = selected?.track || '';
  $('template').value = ['normal', 'amap'].includes(selection?.template) ? selection.template : 'normal';
  $('channel').value = CHANNELS.includes(selection?.channel) ? selection.channel : 'dev';
  updateTarget();
  filterOrders(selected?.id || '');
  $('source-status').textContent = cache
    ? `${cache.viewOnly ? '当前视图' : '整张数据表'} · ${cache.records.length} 个应用 · 更新于 ${new Date(cache.updatedAt).toLocaleString('zh-CN')}`
    : '尚未加载 · 首次使用请配置飞书连接';
  if (cache?.skipped) $('source-status').textContent += ` · 跳过 ${cache.skipped} 条无赛道或马甲号的记录`;
}
async function checkLogin() {
  try {
    const result = await call('CHECK_LOGIN');
    loginAvailable = result.available;
    $('login-status').textContent = result.available ? '已读取网站登录信息（同步时校验有效性）' : '未读取到登录信息，请打开网站并登录';
  } catch (error) {
    loginAvailable = false; $('login-status').textContent = error.message;
  }
  updateControls();
}
async function refresh() {
  if (busy) return;
  busy = true; updateControls(); status('正在分页读取飞书应用列表，请稍候…');
  try {
    const selection = { recordId: $('order').value, template: $('template').value, channel: $('channel').value };
    const { appCache } = await call('REFRESH_APPS');
    populate(appCache, selection);
    status(appCache.records.length ? `已读取 ${appCache.records.length} 个应用，请选择赛道和马甲号。` : '飞书读取成功，但没有包含赛道和马甲号的记录。');
  } catch (error) { status(`刷新失败：${error.message}${cache ? ' 当前显示上次成功读取的缓存。' : ''}`, true); }
  finally { busy = false; updateControls(); }
}
async function saveSelection() {
  try { await call('SAVE_SELECTION', { recordId: $('order').value, template: $('template').value, channel: $('channel').value }); }
  catch (error) { status(error.message, true); }
}

$('track').addEventListener('change', () => { filterOrders(); void saveSelection(); });
$('order').addEventListener('change', () => { fillRecord(); void saveSelection(); });
$('template').addEventListener('change', () => { clearResults(); void saveSelection(); });
$('channel').addEventListener('change', () => {
  clearResults(); updateTarget();
  status(`已选择渠道 ${$('channel').value}，生成并同步时将使用此渠道。`);
  void saveSelection();
});
for (const id of ['app-name', 'company-name']) $(id).addEventListener('input', () => { clearResults(); status('已编辑，生成时将使用当前填写的名称。'); });
$('refresh').addEventListener('click', refresh);
$('check-login').addEventListener('click', checkLogin);
for (const [id, type] of [['settings', 'OPEN_SETTINGS'], ['open-feishu', 'OPEN_FEISHU'], ['open-site', 'OPEN_WEBSITE']]) {
  $(id).addEventListener('click', async () => { try { await call(type); } catch (error) { status(error.message, true); } });
}
$('workflow').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !selectedRecord()) return;
  busy = true; updateControls(); clearResults();
  $('log').textContent = '正在生成两份协议并检查云端配置…';
  status('正在生成并同步，请保持此页面打开，避免重复提交。');
  try {
    const result = await call('RUN_SYNC', { recordId: $('order').value, revision: cache.revision,
      template: $('template').value, channel: $('channel').value, appName: $('app-name').value, companyName: $('company-name').value });
    $('log').textContent = result.log.join('\n');
    $('details').open = true;
    for (const item of result.results) {
      const p = document.createElement('p');
      if (item.ok) {
        const link = document.createElement('a');
        link.textContent = `${item.label}：同步成功，打开查看 ↗`;
        link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; p.append(link);
      } else { p.className = 'error'; p.textContent = `${item.label}：${item.error}`; }
      $('results').append(p);
    }
    status(result.complete ? '两份协议均已同步成功。' : (result.error || '同步未全部成功，请查看运行详情；已成功的项目不会自动回滚。'), !result.complete);
  } catch (error) {
    $('log').textContent += `\n${error.message}\n若任务意外中断，请先检查后台记录再重试。`;
    $('details').open = true; status(error.message, true);
  } finally { busy = false; updateControls(); }
});
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', () => { if (!busy) void reloadState(false); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.appCache) && !busy) void reloadState(false);
});
async function reloadState(autoRefresh) {
  try {
    const state = await call('GET_STATE');
    if (state.appCache?.revision !== cache?.revision || !cache) populate(state.appCache, state.selection);
    await checkLogin();
    if (!state.configured) status('首次使用：请打开“连接设置”，配置飞书读取授权。');
    else if (autoRefresh && !state.appCache) await refresh();
  } catch (error) { status(error.message, true); }
}
await reloadState(true);
