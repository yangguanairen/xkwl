# 隐私文档工具 · Chrome 扩展

独立的 Manifest V3 扩展，适用于 Windows/macOS 上的 Chrome。所有源代码和两套 HTML 模板均在本目录，运行无需 Python、Node.js 或原项目。支持 Chromium 的 Edge 也可按同样方式加载。

浏览器版本要求：Chrome / Edge 123 或更新版本。

## 安装

1. 如果收到的是 ZIP，先解压并保留整个目录。
2. 打开 Chrome 的 `chrome://extensions`，启用右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的 `privacy_chrome_extension` 目录。
4. 点击工具栏中的扩展图标，打开工具页面。建议固定扩展图标。

本版本没有发布到 Chrome 应用商店。加载后不要移动或删除该目录；更新源码后，在扩展管理页面点击“重新加载”即可。

### 1.0.2 更新

新增渠道下拉框：`dev`、`xiaomi`、`huawei`、`oppo`、`vivo`、`honor`、`qq`、`baidu`。默认 `dev`，记住上次选择。配置列表查询、协议写入、运行日志及协议访问链接均使用所选渠道；其他渠道的记录不会更新。无需新增浏览器权限。

### 1.0.1 更新

修复云端列表返回没有 `code/success` 时被误判为“code=未知”的问题。产品与配置读取按各自数据结构校验，仍拒绝明确的失败码；协议写入必须返回明确的成功标记。运行详情会标出 `/switch/products`、`/info/list`、`/info` 对应阶段，方便定位返回格式问题，且不会输出 Token 或完整响应体。

## 首次连接飞书

预设数据源：

https://ycnqla2x5k7g.feishu.cn/base/KJfdbKDmiaNPrXs0a8dcICDMnke?table=tbl5vcVjOQwjPRLh&view=vewc5eDYwM

采用飞书官方 OpenAPI 分页读取整张指定数据表，且仅请求以下四列。勾选连接设置中的“只读取当前视图”才应用链接中的 `view` 筛选。

| 飞书字段 | 扩展用途 |
| --- | --- |
| 所属主体 | 主体名称，允许补全和编辑 |
| 赛道 | 赛道下拉列表，以及星空未来后台的中文产品名 |
| 马甲序号 | 当前赛道下的马甲号下拉列表；支持 0 |
| 备案名称 | 应用名称，允许编辑 |

字段通过名称匹配，不依赖列顺序。没有赛道或马甲序号的空行会跳过并显示数量；马甲序号须为非负整数。“赛道＋马甲序号”重复会阻止整次刷新，避免选错应用。00/0、大小写或全半角差异视为同一键。缺失备案名称、所属主体的记录仍可选择，生成前需补齐。

点击“连接设置”，选择一种授权方式：

- **自建应用**：由有权限的人员在飞书开放平台创建企业自建应用，开通接口所需的多维表格字段和记录读取权限并发布；再把应用加入该表格的“文档应用”，授予可阅读权限。在设置中填写 App ID、App Secret，扩展在刷新时自动换取 tenant_access_token。
- **已有访问凭证**：填写有目标表格权限的 user_access_token 或 tenant_access_token；过期后需要更新。

飞书网页的 Cookie 登录和开放平台 API 授权不是一回事，仅在浏览器登录飞书不能完成这里的 API 授权。App ID/App Secret **没有内置在源码或分发包中**。首次实际联调需要你配置有权限的凭证。

凭证默认仅存储于 `chrome.storage.session`，关闭浏览器或重新加载扩展后需重新填写。可以主动勾选“在此浏览器记住飞书凭证”，改为扩展的本机 `storage.local`；此存储不等同于操作系统安全凭据库，也不会通过 `storage.sync` 同步到其他设备。设置页不会回显已保存的密钥。清除连接会一并删除本地应用列表。

## 日常使用

1. 在同一 Chrome 用户配置中打开并登录 https://www.xingkongweilai.cn/ ，保留标签页。
2. 打开扩展，点击“刷新列表”加载飞书最新应用。已成功读取的列表会缓存在本机，并显示更新时间；不会在刷新失败时伪装成最新数据。
3. 选择赛道，再选择马甲号，自动带入应用名称与主体名称。切换赛道会清空马甲号和名称，防止沿用上一条资料。
4. 补全名称，选择普通模板或高德模板，以及本次要同步的渠道，点击“生成并同步”。
5. 查看两份协议各自的同步结果和访问链接；展开“运行详情”可查看过程。

赛道名称须与星空未来产品列表中的中文 `label` 完全匹配。此版本的赛道来自飞书，不依赖桌面版的英文赛道映射，也不需要新增赛道按钮或 `product_track_map.json`。

星空未来 Token 每次检测/同步时从站点 `localStorage['Admin-Token']` 读取，兼容旧 `sessionStorage` 存储；不在扩展中持久化，不显示完整 Token。读取到 Token 不代表它仍有效，接口会在同步时校验；登录过期请重新登录站点。扩展不读取其他网站的凭证。

## 模板和同步行为

- `templates/normal/`：复制自原 `site/pension_fund/2`。
- `templates/amap/`：复制自原 `site/bus/8`，含高德 SDK 条款。
- 两份文档在内存中生成，名称进行 HTML 转义；无需下载、不操作 Git、不回写飞书。
- 同步目标：`system=android`、`channel=所选渠道`（默认 `dev`）、`pkg=所选马甲号`。
- 查询云端配置后，已有记录使用 PUT，缺失记录使用 POST。两份文档先一起完成重复项/锁定项等检查，再开始写入。
- 飞书只调用读取接口，星空未来只在点击“生成并同步”后写入协议。
- 两个接口不构成事务：其中一份失败时会分别显示成功和失败，不自动回滚或自动重试。任务意外中断时先查看后台记录再决定是否重试。

## 源码

```text
manifest.json       扩展配置及最小站点权限
background.js       消息入口、凭证存储、网站登录读取、任务互斥
core.js             字段转换、重复校验、模板替换、云端请求构造
api.js              飞书分页读取和星空未来协议同步
app.html / app.js   已确认的精简主界面
settings.*          首次连接配置
styles.css          自适应浅色/深色界面
templates/          两套独立文档模板
tests/              模拟接口及数据逻辑测试
package.ps1         分发打包脚本
```

本源码使用浏览器原生模块，没有远程脚本、CDN 或 npm 运行依赖。开发者可用 Node.js 22+ 执行 `npm test`。分发时在 PowerShell 中执行 `./package.ps1` 生成 `release/privacy-chrome-extension.zip`；ZIP 仅含扩展运行文件和说明，不含测试输出或本机凭证。

安装了 Playwright 的开发环境也可执行 `node tests/browser-smoke.mjs`。可用 `PLAYWRIGHT_MODULE_PATH` 指定已有的 Playwright 包目录，用 `TEST_BROWSER_EXECUTABLE` 指定 Chromium 或 Edge 可执行文件。该测试只启动隔离的临时浏览器配置，所有 HTTP API 都被测试替身拦截。

## 验证范围

自动化测试使用本地模板、模拟飞书与云端响应以及隔离浏览器环境，不依赖生产凭证。真实飞书数据读取和云端更新，需要配置授权并由使用者执行后才能确认；本次开发没有向生产接口写入测试协议。

官方文档：[加载扩展](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)、[Chrome 脚本权限](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[Chrome 存储](https://developer.chrome.com/docs/extensions/reference/api/storage)、[飞书记录接口](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list)、[飞书字段接口](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list)、[飞书应用凭证](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)。
