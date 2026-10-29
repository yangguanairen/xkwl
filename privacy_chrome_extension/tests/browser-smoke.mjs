// Optional browser integration test. Uses a NEW temporary profile and mocked APIs.
// npm test needs no packages; this test additionally needs an installed Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = path.resolve(tmpdir());
const profile = await mkdtemp(path.join(tempRoot, 'privacy-extension-test-'));
const errors = [];
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.TEST_BROWSER_EXECUTABLE || undefined,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    viewport: { width: 1000, height: 1000 },
  });
  // The only website tab contains a local fixture; no actual login is performed.
  await context.route('https://www.xingkongweilai.cn/**', route => route.fulfill({
    contentType: 'text/html', body: '<html><title>测试登录页</title><body>本地测试页面</body></html>',
  }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const appUrl = `chrome-extension://${extensionId}/app.html`;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(appUrl);
  await page.getByText('首次使用：请打开“连接设置”，配置飞书读取授权。').waitFor();
  assert.equal(await page.locator('#channel').inputValue(), 'dev');
  assert.deepEqual(await page.locator('#channel option').evaluateAll(options => options.map(o => o.value)),
    ['dev', 'xiaomi', 'huawei', 'oppo', 'vivo', 'honor', 'qq', 'baidu']);
  assert.equal(await page.locator('#track option').count(), 1);
  assert.equal(await page.locator('#run').isDisabled(), true);

  // Replace worker HTTP requests before configuring ANY credentials or doing sync.
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.testWrites = [];
    globalThis.testMethods = [];
    globalThis.mockCloudMode = 'success';
    globalThis.fetch = async (raw, options = {}) => {
      const url = new URL(raw);
      if (url.protocol === 'chrome-extension:') return realFetch(raw, options);
      const json = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.origin === 'https://open.feishu.cn') {
        if (url.pathname.endsWith('/auth/v3/tenant_access_token/internal')) return json({ code: 0, tenant_access_token: 'local-fixture-token' });
        if (url.pathname.endsWith('/fields')) return json({ code: 0, data: { items: ['所属主体', '赛道', '马甲序号', '备案名称'].map(field_name => ({ field_name })) } });
        if (url.pathname.endsWith('/records')) return json({ code: 0, data: { items: [
          { record_id: 'rec0', fields: { '所属主体': '待补全主体', '赛道': '倒数日', '马甲序号': 0, '备案名称': '零号应用' } },
          { record_id: 'rec1', fields: { '所属主体': '完整主体有限公司', '赛道': '倒数日', '马甲序号': 1, '备案名称': '一号应用' } },
          { record_id: 'rec2', fields: { '所属主体': '另一主体', '赛道': '计算器', '马甲序号': 2, '备案名称': '计算器应用' } },
        ], has_more: false } });
      }
      if (url.origin === 'https://www.xingkongweilai.cn') {
        if (globalThis.mockCloudMode === 'expired') return json({ code: 401, success: false });
        if (url.pathname.endsWith('/switch/products')) return json({ code: 200, success: true, data: [{ id: 7, label: '倒数日' }, { id: 8, label: '计算器' }] });
        if (url.pathname.endsWith('/info/list')) return json({ rows: [
          { id: 11, keyName: 'privacy_policy', productId: 7, pkg: '0', system: 'android', channel: 'dev', isLocked: 0 },
          { id: 12, keyName: 'privacy_policy', productId: 7, pkg: '0', system: 'android', channel: 'huawei', isLocked: 0 },
        ], total: 2 });
        if (url.pathname === '/prod-api/config-service/info' && ['POST', 'PUT'].includes(options.method)) {
          globalThis.testWrites.push(JSON.parse(options.body));
          globalThis.testMethods.push(options.method);
          return json({ code: 200, success: true });
        }
      }
      throw new Error('Test blocked all unknown HTTP requests');
    };
  });
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/settings.html`);
  await settings.locator('#app-id').fill('cli_fixture');
  await settings.locator('#app-secret').fill('fixture-not-real');
  await settings.locator('#save').click();
  await settings.getByText('已保存。返回工具后点击“刷新列表”验证连接。').waitFor();
  assert.equal(await settings.locator('#app-secret').inputValue(), '');
  const localStored = await worker.evaluate(async () => (await chrome.storage.local.get('feishuCredentials')).feishuCredentials);
  assert.equal(localStored, undefined, 'default credentials must be session-only');

  await page.bringToFront();
  await page.locator('#refresh').click();
  await page.getByText('已读取 3 个应用，请选择赛道和马甲号。').waitFor();
  await page.locator('#track').selectOption({ label: '倒数日' });
  assert.equal(await page.locator('#order option').count(), 3);
  assert.equal(await page.locator('#company-name').inputValue(), '');
  await page.locator('#order').selectOption('rec0');
  assert.equal(await page.locator('#app-name').inputValue(), '零号应用');
  await page.locator('#company-name').fill('已补全的主体科技有限公司');
  await page.locator('#template').selectOption('amap');
  await page.locator('#channel').selectOption('huawei');
  assert.ok((await page.locator('#sync-target').textContent()).includes('Android / huawei'));

  const login = await context.newPage();
  await login.goto('https://www.xingkongweilai.cn/');
  await login.evaluate(() => localStorage.setItem('Admin-Token', 'fixture-website-token'));
  await page.bringToFront();
  await page.locator('#check-login').click();
  await page.getByText('已读取网站登录信息（同步时校验有效性）').waitFor();
  await page.locator('#run').click();
  await page.getByText('两份协议均已同步成功。').waitFor();
  const writes = await worker.evaluate(() => globalThis.testWrites);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(w => w.pkg === '0' && w.productId === 7 && w.system === 'android' && w.channel === 'huawei'));
  assert.equal(writes[0].id, 12);
  assert.deepEqual(await worker.evaluate(() => globalThis.testMethods), ['PUT', 'POST']);
  assert.ok(writes.every(w => w.keyValue.includes('零号应用') && w.keyValue.includes('已补全的主体科技有限公司')));
  assert.equal(await page.locator('#results a').count(), 2);
  for (const href of await page.locator('#results a').evaluateAll(links => links.map(link => link.href))) {
    assert.equal(new URL(href).searchParams.get('channel'), 'huawei');
  }
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#channel').value === 'huawei');
  assert.ok((await page.locator('#sync-target').textContent()).includes('Android / huawei'));

  await page.locator('#track').selectOption({ label: '计算器' });
  assert.equal(await page.locator('#order option').count(), 2);
  assert.equal(await page.locator('#order').inputValue(), '');
  assert.equal(await page.locator('#app-name').inputValue(), '');
  assert.equal(await page.locator('#company-name').inputValue(), '');
  assert.equal(await page.locator('#run').isDisabled(), true);
  await page.locator('#order').selectOption('rec2');
  await worker.evaluate(() => { globalThis.mockCloudMode = 'expired'; });
  await page.locator('#run').click();
  await page.getByText('星空未来登录已失效，请重新登录网站后重试。', { exact: true }).waitFor();
  assert.equal(await worker.evaluate(() => globalThis.testWrites.length), 2);

  await page.locator('#track').selectOption({ label: '倒数日' });
  await page.locator('#order').selectOption('rec1');
  const output = path.join(root, 'test-results');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 960 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile layout overflows');
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('浏览器测试通过：独立加载、飞书联动、0 号、主体编辑、模板、登录读取、8 渠道选择、渠道记忆和隔离写入、访问链接、过期拦截、移动布局。');
  console.log('HTTP API 均为本地模拟，未向生产接口写入数据。');
} finally {
  await context?.close();
  if (path.dirname(path.resolve(profile)) === tempRoot && path.basename(profile).startsWith('privacy-extension-test-')) {
    await rm(profile, { recursive: true, force: true });
  }
}
