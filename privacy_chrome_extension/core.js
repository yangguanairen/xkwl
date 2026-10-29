// Pure data transformations shared by the service worker and automated tests.
export const FEISHU_URL = 'https://ycnqla2x5k7g.feishu.cn/base/KJfdbKDmiaNPrXs0a8dcICDMnke?table=tbl5vcVjOQwjPRLh&view=vewc5eDYwM';
export const FIELD_NAMES = ['所属主体', '赛道', '马甲序号', '备案名称'];
export const CHANNELS = ['dev', 'xiaomi', 'huawei', 'oppo', 'vivo', 'honor', 'qq', 'baidu'];

export function validateChannel(channel) {
  if (!CHANNELS.includes(channel)) throw new Error('请选择有效的渠道。');
  return channel;
}
export const DOCS = [
  { key: 'privacy_policy', label: '隐私政策', file: 'privacy.html' },
  { key: 'user_agreement', label: '用户协议', file: 'user.html' },
];
export const TEMPLATES = {
  normal: { label: '普通模板', app: '社保养老云计算', company: '南京星绘视界网络科技有限公司第二分公司' },
  amap: { label: '高德模板', app: '公交地铁出行助手', company: '南京星绘视界网络科技有限公司第一分公司' },
};

export function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(cellText).join('').trim();
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim();
    if (typeof value.name === 'string') return value.name.trim();
    if (value.value != null) return cellText(value.value);
  }
  throw new Error('飞书字段类型无法转换为文本，请检查前四列的字段类型。');
}

export function parseBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入有效的飞书多维表格链接。'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.feishu\.cn$/i.test(url.hostname)) {
    throw new Error('仅支持 https://xxx.feishu.cn/base/... 格式的链接。');
  }
  const match = url.pathname.match(/^\/base\/([a-zA-Z0-9]+)\/?$/);
  const tableId = url.searchParams.get('table');
  const viewId = url.searchParams.get('view') || '';
  if (!match || !/^tbl[a-zA-Z0-9]+$/.test(tableId || '') || (viewId && !/^vew[a-zA-Z0-9]+$/.test(viewId))) {
    throw new Error('飞书链接缺少有效的 base 标识、table 参数或 view 参数。');
  }
  return { appToken: match[1], tableId, viewId, url: url.href };
}

export function normalizeRecords(items) {
  if (!Array.isArray(items)) throw new Error('飞书记录响应格式不正确。');
  const records = [];
  const keys = new Set();
  let skipped = 0;
  for (const item of items) {
    const fields = item?.fields || {};
    const track = cellText(fields['赛道']);
    const order = cellText(fields['马甲序号']);
    if (!track || !order) { skipped++; continue; }
    if (!/^[0-9]+$/.test(order)) {
      throw new Error(`赛道“${track}”中马甲序号“${order}”不是非负整数，请先修正飞书数据。`);
    }
    const normalizedOrder = BigInt(order).toString();
    const key = JSON.stringify([track.normalize('NFKC').toLowerCase(), normalizedOrder]);
    if (keys.has(key)) throw new Error(`存在重复记录：赛道“${track}”＋马甲号“${normalizedOrder}”，请先在飞书处理。`);
    keys.add(key);
    if (typeof item.record_id !== 'string' || !item.record_id) throw new Error('飞书记录缺少 record_id。');
    records.push({ id: item.record_id, track, order: normalizedOrder,
      appName: cellText(fields['备案名称']), companyName: cellText(fields['所属主体']) });
  }
  records.sort((a, b) => a.track.localeCompare(b.track, 'zh-CN') || a.order.localeCompare(b.order, undefined, { numeric: true }));
  return { records, skipped };
}

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderDocument(html, templateKey, appName, companyName) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error('请选择有效的协议模板。');
  if (!appName?.trim() || !companyName?.trim()) throw new Error('请补全应用名称和主体名称。');
  if (!html.includes(template.app) || !html.includes(template.company)) {
    throw new Error(`内置${template.label}缺少原名称，无法可靠替换。`);
  }
  // A single replacement pass avoids replacing user-supplied names a second time.
  const pattern = new RegExp([template.app, template.company].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return html.replace(pattern, match => escapeHtml(match === template.app ? appName.trim() : companyName.trim()));
}

export function policyUrl(productName, order, key, channel = 'dev') {
  validateChannel(channel);
  const url = new URL('https://www.xingkongweilai.cn/commonPolicy.html');
  url.search = new URLSearchParams({ keyName: key, system: 'android', channel,
    productName, packageName: order, type: `${key}/android/${channel}/${productName}/${order}` }).toString();
  return url.href;
}

export function buildPayload(product, order, doc, html, existingRows, channel = 'dev') {
  validateChannel(channel);
  if (!Number.isInteger(product?.id)) throw new Error('云端产品 ID 无效。');
  const matched = existingRows.filter(row => row.keyName === doc.key);
  if (matched.length > 1) throw new Error(`云端存在多条${doc.label}记录，请先处理重复记录。`);
  const existing = matched[0];
  const payload = { productId: product.id, productName: product.label, system: 'android', pkg: order,
    channel, keyName: doc.key, keyValue: html, versionRange: '0', description: doc.label, isLocked: 0 };
  if (existing) {
    if (!Number.isInteger(existing.id)) throw new Error(`云端${doc.label}缺少有效 ID。`);
    if (Number(existing.isLocked || 0) !== 0) throw new Error(`云端${doc.label}已锁定，请先在后台解锁。`);
    Object.assign(payload, { id: existing.id, versionRange: existing.versionRange || '0',
      description: existing.description || doc.label, isLocked: existing.isLocked ?? 0 });
  }
  return { method: existing ? 'PUT' : 'POST', payload };
}
