import { FIELD_NAMES, DOCS, parseBaseUrl, normalizeRecords, buildPayload, policyUrl, validateChannel } from './core.js';

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const CONFIG_API = 'https://www.xingkongweilai.cn/prod-api/config-service';

export async function requestJson(url, { token, method = 'GET', body, fetcher = fetch, service = '接口' } = {}) {
  let response;
  try {
    response = await fetcher(url, { method, credentials: 'omit', redirect: 'error',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
  } catch {
    throw new Error(`${service}连接失败或超时，请检查网络和扩展的网站访问权限。`);
  }
  if (response.status === 401) throw new Error(`${service}登录或访问凭证已过期，请重新登录或更新连接设置。`);
  if (response.status === 403) throw new Error(`${service}拒绝访问，请检查应用权限及表格授权。`);
  if (!response.ok) throw new Error(`${service}请求失败（HTTP ${response.status}）。`);
  let json;
  try { json = await response.json(); } catch { throw new Error(`${service}未返回有效 JSON。`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${service}响应格式不正确。`);
  return json;
}

function assertFeishu(json) {
  if (json.code !== 0) {
    // Do not echo response bodies: server errors may contain credentials or private records.
    throw new Error(`飞书接口返回错误（code=${Number(json.code) || '未知'}），请检查读取权限、应用发布状态与表格授权。`);
  }
  return json.data;
}

export async function getFeishuToken(credentials, fetcher = fetch) {
  if (credentials.mode === 'token') {
    const token = String(credentials.token || '').trim().replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('请先在“飞书连接设置”中填写读取凭证。');
    return token;
  }
  if (!credentials.appId || !credentials.appSecret) throw new Error('请先在“飞书连接设置”中配置 App ID 和 App Secret。');
  const response = await requestJson(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST', body: { app_id: credentials.appId, app_secret: credentials.appSecret }, fetcher, service: '飞书授权',
  });
  assertFeishu(response);
  if (!response.tenant_access_token) throw new Error('飞书未返回有效的应用访问凭证。');
  return response.tenant_access_token;
}

export async function readFeishuRecords(settings, credentials, fetcher = fetch, log = () => {}) {
  const source = parseBaseUrl(settings.baseUrl);
  const token = await getFeishuToken(credentials, fetcher);
  const base = `${FEISHU_API}/bitable/v1/apps/${source.appToken}/tables/${source.tableId}`;
  const items = [];
  const cursors = new Set();
  let cursor = '';
  // Validate field names even when the table has no records.
  const fields = [];
  for (;;) {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('page_token', cursor);
    const data = assertFeishu(await requestJson(`${base}/fields?${params}`, { token, fetcher, service: '飞书字段读取' }));
    if (!Array.isArray(data?.items)) throw new Error('飞书字段列表格式不正确。');
    fields.push(...data.items.map(f => f.field_name));
    if (!data.has_more) break;
    if (!data.page_token || cursors.has(data.page_token)) throw new Error('飞书字段分页游标异常。');
    cursors.add(data.page_token); cursor = data.page_token;
  }
  const missing = FIELD_NAMES.filter(name => !fields.includes(name));
  if (missing.length) throw new Error(`飞书表格缺少字段：${missing.join('、')}。请检查字段名称。`);
  cursor = ''; cursors.clear();
  for (;;) {
    const params = new URLSearchParams({ page_size: '500', field_names: JSON.stringify(FIELD_NAMES), text_field_as_array: 'true' });
    if (settings.viewOnly) {
      if (!source.viewId) throw new Error('仅当前视图模式需要链接中包含 view 参数。');
      params.set('view_id', source.viewId);
    }
    if (cursor) params.set('page_token', cursor);
    const data = assertFeishu(await requestJson(`${base}/records?${params}`, { token, fetcher, service: '飞书记录读取' }));
    if (!Array.isArray(data?.items)) throw new Error('飞书记录列表格式不正确。');
    items.push(...data.items);
    log(`已读取 ${items.length} 条飞书记录…`);
    if (!data.has_more) break;
    if (!data.page_token || cursors.has(data.page_token)) throw new Error('飞书记录分页游标异常，已停止读取。');
    cursors.add(data.page_token); cursor = data.page_token;
  }
  return { ...normalizeRecords(items), source: source.url, viewOnly: Boolean(settings.viewOnly) };
}

function cloudSummary(json) {
  const scalar = value => {
    if (value == null) return '未提供';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return typeof value === 'string' && /^[0-9]{1,10}$/.test(value) ? value : '格式异常';
  };
  return `code=${scalar(json.code)}，success=${scalar(json.success)}`;
}

function assertCloud(json, kind, stage) {
  const hasCode = json.code != null;
  const code = typeof json.code === 'number' ? json.code
    : (typeof json.code === 'string' && /^[0-9]+$/.test(json.code) ? Number(json.code) : NaN);
  if (code === 401) throw new Error('星空未来登录已失效，请重新登录网站后重试。');
  if (code === 403) throw new Error(`${stage}：星空未来拒绝访问，请检查当前账号权限。`);
  if ((hasCode && code !== 200) || (json.success != null && json.success !== true) || json.error) {
    throw new Error(`${stage}失败（${cloudSummary(json)}）。`);
  }
  // The configuration list historically returns { rows, total } without an envelope.
  // Reads must have the requested data shape; writes need an explicit success marker.
  const valid = kind === 'products' ? Array.isArray(json.data)
    : kind === 'list' ? Array.isArray(json.rows)
      : code === 200 || json.success === true;
  if (!valid) {
    const expected = kind === 'products' ? '产品列表 data 数组'
      : kind === 'list' ? '配置列表 rows 数组' : '明确的成功标记';
    throw new Error(`${stage}响应格式不正确：缺少${expected}（${cloudSummary(json)}）。`);
  }
  return json;
}

export async function synchronize({ record, documents, token, channel = 'dev', fetcher = fetch, log = () => {} }) {
  validateChannel(channel);
  log(`同步目标：Android / ${channel}。`);
  log('查询云端产品列表（GET /switch/products）…');
  const productsResponse = assertCloud(await requestJson(`${CONFIG_API}/switch/products`, {
    token, fetcher, service: '星空未来产品列表读取',
  }), 'products', '产品列表读取（GET /switch/products）');
  const products = productsResponse.data;
  log(`产品列表读取成功：${products.length} 个产品（${cloudSummary(productsResponse)}）。`);
  const matched = products.filter(p => String(p?.label || '').trim() === record.track);
  if (matched.length !== 1) throw new Error(`云端未唯一匹配赛道“${record.track}”，请核对飞书赛道与后台中文产品名。`);
  const product = matched[0];
  log(`已匹配云端产品：${product.label}（ID=${product.id}）。`);
  const rows = [];
  const seenIds = new Set();
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageNum: String(page), pageSize: '100', productId: String(product.id),
      productName: product.label, system: 'android', pkg: record.order, channel });
    log(`读取云端配置列表（GET /info/list，第 ${page} 页）…`);
    const response = assertCloud(await requestJson(`${CONFIG_API}/info/list?${params}`, {
      token, fetcher, service: '星空未来配置列表读取',
    }), 'list', '配置列表读取（GET /info/list）');
    log(`配置列表第 ${page} 页：${response.rows.length} 条记录（${cloudSummary(response)}）。`);
    for (const row of response.rows) {
      if (!row || typeof row !== 'object' || !Number.isInteger(row.id)) throw new Error('云端配置缺少有效 ID，已停止同步。');
      if (seenIds.has(row.id)) throw new Error('云端分页重复返回相同记录，已停止同步。');
      seenIds.add(row.id); rows.push(row);
    }
    if (response.rows.length < 100 && !(Number(response.total) > rows.length)) break;
    if (!response.rows.length || page >= 1000) throw new Error('云端配置分页异常，已停止同步。');
  }
  const scopedRows = rows.filter(row => {
    if (row.channel !== channel) return false;
    if (row.system !== 'android' || String(row.pkg) !== record.order || Number(row.productId) !== product.id) {
      throw new Error('云端返回了与选定产品、马甲号或系统不符的记录，已停止同步。');
    }
    return true;
  });
  // Preflight BOTH documents before the first mutation.
  const jobs = DOCS.map(doc => {
    if (!documents[doc.key]?.trim()) throw new Error(`生成的${doc.label}为空。`);
    return { doc, ...buildPayload(product, record.order, doc, documents[doc.key], scopedRows, channel) };
  });
  const results = [];
  for (const job of jobs) {
    log(`${job.method === 'PUT' ? '更新' : '创建'}${job.doc.label}…`);
    try {
      assertCloud(await requestJson(`${CONFIG_API}/info`, {
        method: job.method, token, body: job.payload, fetcher, service: job.doc.label,
      }), 'write', `${job.doc.label}写入（${job.method} /info）`);
      results.push({ key: job.doc.key, label: job.doc.label, ok: true, url: policyUrl(product.label, record.order, job.doc.key, channel) });
      log(`${job.doc.label}同步成功。`);
    } catch (error) {
      results.push({ key: job.doc.key, label: job.doc.label, ok: false, error: error.message });
      log(`${job.doc.label}同步失败：${error.message}`);
    }
  }
  return { complete: results.every(r => r.ok), results };
}
