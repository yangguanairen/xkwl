import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cellText, normalizeRecords, parseBaseUrl, renderDocument, buildPayload, policyUrl, DOCS, TEMPLATES, FEISHU_URL } from '../core.js';

const row = (id, order, extra = {}) => ({ record_id: id, fields: { '所属主体': '测试公司', '赛道': '倒数日', '马甲序号': order, '备案名称': '测试应用', ...extra } });
test('飞书字段转换保留 0，支持富文本与公式结果', () => {
  assert.equal(cellText(0), '0');
  assert.equal(cellText([{ type: 'text', text: '公司' }, { type: 'text', text: '全称' }]), '公司全称');
  assert.equal(cellText({ value: ['主体名称'] }), '主体名称');
  assert.throws(() => cellText({ record_ids: ['rec1'] }), /字段类型/);
});
test('赛道与马甲号组合去重；相同序号可属于不同赛道', () => {
  const data = normalizeRecords([row('a', 0), row('b', '2'), row('c', '0', { '赛道': '计算器' })]);
  assert.equal(data.records.length, 3);
  assert.ok(data.records.some(r => r.order === '0'));
  assert.throws(() => normalizeRecords([row('a', 0), row('b', '00')]), /重复记录/);
  assert.throws(() => normalizeRecords([row('a', '1', { '赛道': 'Track' }), row('b', '1', { '赛道': 'track' })]), /重复记录/);
});
test('跳过空行，但保留待补全主体的记录', () => {
  const data = normalizeRecords([row('a', '0', { '所属主体': '' }), row('b', ''), { fields: {} }]);
  assert.equal(data.skipped, 2);
  assert.equal(data.records[0].companyName, '');
  assert.throws(() => normalizeRecords([row('c', '../1')]), /非负整数/);
});
test('解析表格链接并限制来源；app_token 不等同访问凭证', () => {
  const source = parseBaseUrl(FEISHU_URL);
  assert.equal(source.tableId, 'tbl5vcVjOQwjPRLh');
  assert.equal(source.viewId, 'vewc5eDYwM');
  assert.throws(() => parseBaseUrl(FEISHU_URL.replace('.feishu.cn', '.evil.example')), /仅支持/);
  assert.throws(() => parseBaseUrl('https://example.feishu.cn/wiki/a?table=tbl1'), /缺少/);
});
for (const key of Object.keys(TEMPLATES)) {
  for (const doc of DOCS) {
    test(`${key}/${doc.file} 使用真实模板完成替换和 HTML 转义`, async () => {
      const html = await readFile(new URL(`../templates/${key}/${doc.file}`, import.meta.url), 'utf8');
      const generated = renderDocument(html, key, '应用 <A & B>', '主体 "公司"');
      assert.ok(generated.includes('应用 &lt;A &amp; B&gt;'));
      assert.ok(generated.includes('主体 &quot;公司&quot;'));
      assert.ok(!generated.includes(TEMPLATES[key].app));
      assert.ok(!generated.includes(TEMPLATES[key].company));
    });
  }
}
test('替换只执行一遍，不破坏用户名称中包含的模板原主体', () => {
  const t = TEMPLATES.normal;
  const html = `${t.app} ${t.company}`;
  assert.equal(renderDocument(html, 'normal', t.company, '新公司'), `${t.company} 新公司`);
});
test('云端新增和更新保留已有配置；重复与锁定项停止写入', () => {
  const product = { id: 1, label: '倒数日' }, doc = DOCS[0];
  assert.equal(buildPayload(product, '0', doc, 'html', []).method, 'POST');
  const existing = { id: 23, keyName: doc.key, versionRange: '1-9', description: '保留描述', isLocked: 0 };
  const update = buildPayload(product, '0', doc, 'html', [existing]);
  assert.equal(update.method, 'PUT');
  assert.equal(update.payload.versionRange, '1-9');
  assert.equal(update.payload.pkg, '0');
  assert.equal(update.payload.id, 23);
  assert.throws(() => buildPayload(product, '0', doc, 'html', [existing, existing]), /多条/);
  assert.throws(() => buildPayload(product, '0', doc, 'html', [{ ...existing, isLocked: 1 }]), /锁定/);
});
test('协议链接参数与原系统保持一致', () => {
  const url = new URL(policyUrl('社保/公积金', '0', 'privacy_policy'));
  assert.equal(url.searchParams.get('type'), 'privacy_policy/android/dev/社保/公积金/0');
  assert.equal(url.searchParams.get('productName'), '社保/公积金');
});
