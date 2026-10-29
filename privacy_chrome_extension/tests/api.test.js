import test from 'node:test';
import assert from 'node:assert/strict';
import { getFeishuToken, readFeishuRecords, requestJson, synchronize } from '../api.js';
import { FEISHU_URL, FIELD_NAMES, DOCS, CHANNELS } from '../core.js';

const json = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
const record = { id: 'rec1', track: '倒数日', order: '0' };
const documents = { privacy_policy: '<html>privacy</html>', user_agreement: '<html>user</html>' };
const cloudRow = (key, id) => ({ id, keyName: key, productId: 7, pkg: '0', system: 'android', channel: 'dev', isLocked: 0 });

test('飞书授权换取应用 token；不持久化或输出密钥', async () => {
  const token = await getFeishuToken({ mode: 'app', appId: 'cli_test', appSecret: 'not-a-real-secret' }, async (url, options) => {
    assert.equal(url, 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).app_id, 'cli_test');
    assert.equal(options.redirect, 'error');
    return json({ code: 0, tenant_access_token: 'fake-token' });
  });
  assert.equal(token, 'fake-token');
});
test('飞书全表分页直到结束，仅请求指定四列；0 号可用', async () => {
  const requested = [];
  const fetcher = async raw => {
    const url = new URL(raw); requested.push(url);
    if (url.pathname.endsWith('/fields')) return json({ code: 0, data: { items: FIELD_NAMES.map(field_name => ({ field_name })), has_more: false } });
    assert.equal(url.searchParams.get('view_id'), null);
    assert.deepEqual(JSON.parse(url.searchParams.get('field_names')), FIELD_NAMES);
    const second = url.searchParams.get('page_token') === 'next';
    return json({ code: 0, data: { items: [{ record_id: second ? 'rec1' : 'rec0', fields: {
      '所属主体': [{ text: '测试公司' }], '赛道': '倒数日', '马甲序号': second ? 1 : 0, '备案名称': '测试应用',
    } }], has_more: !second, ...(second ? {} : { page_token: 'next' }) } });
  };
  const result = await readFeishuRecords({ baseUrl: FEISHU_URL, viewOnly: false }, { mode: 'token', token: 'fake-token' }, fetcher);
  assert.deepEqual(result.records.map(r => r.order), ['0', '1']);
  assert.equal(requested.length, 3);
});
test('当前视图模式传递 view_id；空表也检查字段', async () => {
  const result = await readFeishuRecords({ baseUrl: FEISHU_URL, viewOnly: true }, { mode: 'token', token: 'fake' }, async raw => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/fields')) return json({ code: 0, data: { items: FIELD_NAMES.map(field_name => ({ field_name })) } });
    assert.equal(url.searchParams.get('view_id'), 'vewc5eDYwM');
    return json({ code: 0, data: { items: [], has_more: false } });
  });
  assert.equal(result.records.length, 0);
  await assert.rejects(readFeishuRecords({ baseUrl: FEISHU_URL }, { mode: 'token', token: 'fake' }, async () => json({ code: 0, data: { items: [] } })), /缺少字段/);
});
test('飞书重复游标不能产生无限循环；错误响应不泄露凭证', async () => {
  await assert.rejects(readFeishuRecords({ baseUrl: FEISHU_URL }, { mode: 'token', token: 'fake' }, async raw => {
    if (new URL(raw).pathname.endsWith('/fields')) return json({ code: 0, data: { items: FIELD_NAMES.map(field_name => ({ field_name })) } });
    return json({ code: 0, data: { items: [], has_more: true, page_token: 'same' } });
  }), /分页游标异常/);
  await assert.rejects(getFeishuToken({ mode: 'app', appId: 'cli_test', appSecret: 'test-secret' }, async () => json({ code: 999, msg: 'test-secret' })), error => !error.message.includes('test-secret'));
});
function cloudMock(rows = [], writes = [], failKey = '') {
  return async (raw, options) => {
    const url = new URL(raw);
    assert.equal(url.origin, 'https://www.xingkongweilai.cn');
    if (url.pathname.endsWith('/switch/products')) return json({ code: 200, success: true, data: [{ id: 7, label: '倒数日' }] });
    if (url.pathname.endsWith('/info/list')) return json({ code: 200, success: true, rows, total: rows.length });
    assert.equal(url.pathname, '/prod-api/config-service/info');
    const body = JSON.parse(options.body); writes.push({ method: options.method, body });
    return json({ code: body.keyName === failKey ? 500 : 200, success: body.keyName !== failKey });
  };
}
test('云端两个协议分别使用 PUT/POST，且提交编辑后的生成文档', async () => {
  const writes = [];
  const result = await synchronize({ record, documents, token: 'fake', fetcher: cloudMock([cloudRow(DOCS[0].key, 10)], writes) });
  assert.equal(result.complete, true);
  assert.deepEqual(writes.map(w => w.method), ['PUT', 'POST']);
  assert.equal(writes[0].body.id, 10);
  assert.equal(writes[1].body.pkg, '0');
  assert.equal(writes[1].body.keyValue, documents.user_agreement);
});
test('第二份文档有重复项时，第一份也不能开始写入', async () => {
  const writes = [];
  await assert.rejects(synchronize({ record, documents, token: 'fake', fetcher: cloudMock([
    cloudRow(DOCS[1].key, 1), cloudRow(DOCS[1].key, 2),
  ], writes) }), /多条/);
  assert.equal(writes.length, 0);
});
test('登录过期时无写入；部分同步失败逐项报告，不假报全部成功', async () => {
  await assert.rejects(synchronize({ record, documents, token: 'fake', fetcher: async () => json({ code: 401, success: false }) }), /登录已失效/);
  const result = await synchronize({ record, documents, token: 'fake', fetcher: cloudMock([], [], DOCS[1].key) });
  assert.equal(result.complete, false);
  assert.deepEqual(result.results.map(r => r.ok), [true, false]);
});
test('云端返回其他马甲的记录时停止，避免更新错误记录', async () => {
  const writes = [];
  await assert.rejects(synchronize({ record, documents, token: 'fake', fetcher: cloudMock([
    { ...cloudRow(DOCS[0].key, 1), pkg: '9' },
  ], writes) }), /不符/);
  assert.equal(writes.length, 0);
});
test('网络错误和鉴权失败使用不含响应体的清晰提示', async () => {
  await assert.rejects(requestJson('https://example.test', { fetcher: async () => { throw new Error('secret'); } }), /连接失败或超时/);
  await assert.rejects(requestJson('https://example.test', { fetcher: async () => new Response('secret', { status: 403 }) }), error => /拒绝访问/.test(error.message) && !error.message.includes('secret'));
});

test('配置列表仅返回 rows/total 时仍可同步已有协议，不误创建重复项', async () => {
  const writes = [], log = [];
  const underlying = cloudMock([cloudRow(DOCS[0].key, 10)], writes);
  const fetcher = async (raw, options) => {
    if (new URL(raw).pathname.endsWith('/info/list')) return json({ rows: [cloudRow(DOCS[0].key, 10)], total: 1 });
    return underlying(raw, options);
  };
  const result = await synchronize({ record, documents, token: 'fake', fetcher, log: text => log.push(text) });
  assert.equal(result.complete, true);
  assert.deepEqual(writes.map(w => w.method), ['PUT', 'POST']);
  assert.equal(writes[0].body.id, 10);
  assert.ok(log.some(line => line.includes('GET /info/list')));
  assert.ok(log.some(line => line.includes('code=未提供，success=未提供')));
});

test('读取兼容省略状态字段，写入兼容 code=200 或 success=true', async () => {
  let writes = 0;
  const fetcher = async (raw, options) => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/switch/products')) return json({ data: [{ id: 7, label: '倒数日' }] });
    if (url.pathname.endsWith('/info/list')) return json({ code: '200', rows: [], total: 0 });
    assert.equal(options.method, 'POST');
    writes++;
    return json(writes === 1 ? { code: 200 } : { success: true });
  };
  const result = await synchronize({ record, documents, token: 'fake', fetcher });
  assert.equal(result.complete, true);
  assert.equal(writes, 2);
});

test('配置列表有明确失败标记时，不能因包含 rows 就跳过错误', async () => {
  for (const response of [
    { code: 500, rows: [] }, { code: '403', rows: [] }, { success: false, rows: [] }, { code: 0, rows: [] },
  ]) {
    const writes = [];
    const underlying = cloudMock([], writes);
    await assert.rejects(synchronize({ record, documents, token: 'fake', fetcher: async (raw, options) => {
      if (new URL(raw).pathname.endsWith('/info/list')) return json(response);
      return underlying(raw, options);
    } }), /配置列表读取/);
    assert.equal(writes.length, 0);
  }
});

test('错误格式提示定位到接口；写入没有明确成功标记时不能假报成功', async () => {
  await assert.rejects(synchronize({ record, documents, token: 'fake', fetcher: async () => json({ message: 'private-server-details' }) }), error =>
    error.message.includes('GET /switch/products') && error.message.includes('缺少产品列表') && !error.message.includes('private-server-details'));
  const underlying = cloudMock();
  const result = await synchronize({ record, documents, token: 'fake', fetcher: async (raw, options) => {
    if (new URL(raw).pathname.endsWith('/info')) return json({});
    return underlying(raw, options);
  } });
  assert.equal(result.complete, false);
  assert.ok(result.results.every(item => !item.ok && item.error.includes('POST /info') && item.error.includes('缺少明确的成功标记')));
});

for (const channel of CHANNELS) {
  test(`渠道 ${channel}：查询、更新、新建及访问链接一致，不触碰其他渠道`, async () => {
    const otherChannel = channel === 'dev' ? 'huawei' : 'dev';
    const rows = [
      { ...cloudRow(DOCS[0].key, 10), channel },
      { ...cloudRow(DOCS[0].key, 20), channel: otherChannel, isLocked: 1 },
      { ...cloudRow(DOCS[0].key, 21), channel: otherChannel, isLocked: 1 },
      { ...cloudRow(DOCS[1].key, 22), channel: otherChannel, isLocked: 1 },
    ];
    const writes = [];
    const underlying = cloudMock(rows, writes);
    const result = await synchronize({ record, documents, token: 'fake', channel, fetcher: async (raw, options) => {
      const url = new URL(raw);
      if (url.pathname.endsWith('/info/list')) assert.equal(url.searchParams.get('channel'), channel);
      return underlying(raw, options);
    } });
    assert.equal(result.complete, true);
    assert.deepEqual(writes.map(w => w.method), ['PUT', 'POST']);
    assert.equal(writes[0].body.id, 10);
    assert.equal(writes[1].body.id, undefined);
    assert.ok(writes.every(w => w.body.channel === channel));
    for (const item of result.results) {
      const url = new URL(item.url);
      assert.equal(url.searchParams.get('channel'), channel);
      assert.equal(url.searchParams.get('type'), `${item.key}/android/${channel}/倒数日/0`);
    }
  });
}

test('非法渠道在请求云端之前被拒绝，不能静默改用 dev', async () => {
  for (const channel of ['unknown', '', 'Huawei', null, '../dev']) {
    let calls = 0;
    await assert.rejects(synchronize({ record, documents, token: 'fake', channel, fetcher: async () => { calls++; } }), /有效的渠道/);
    assert.equal(calls, 0);
  }
});
