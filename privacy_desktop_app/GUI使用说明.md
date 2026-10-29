# 隐私文档工具（桌面版）

本目录是独立版本，运行和构建均不依赖上级项目中的文件。请保持本目录内的 `site`、`product_track_map.json` 和 Python 文件结构不变。

桌面版提供以下功能：

- 编辑 `track`、`order`、应用名称、公司名称和 API Token。
- 可在赛道下拉框旁新增赛道，填写英文标识和中文产品名后立即使用。
- 可选择普通模板或包含高德 SDK 相关条款的高德模板。
- 选择是否覆盖已存在的目标目录。
- 一键生成文档并同步云端，也可只执行其中一个阶段。
- 整个过程不会执行 Git 提交或推送。
- 默认记住 API Token，Windows 中安全保存到“凭据管理器”，macOS 中安全保存到“钥匙串”，不会明文写入项目文件。

## 直接运行源码

安装 Python 3.10 或更高版本，然后在项目目录执行：

```powershell
python -m pip install requests
python privacy_gui.py
```

## 构建 Windows 程序

在 Windows PowerShell 中执行：

```powershell
.\build_windows.ps1
```

生成文件为 `dist\PrivacyDocumentTool.exe`，复制这一个文件即可运行。

## 构建 macOS 程序

Windows 无法直接生成 macOS 应用，需要在 macOS 电脑上执行：

```bash
chmod +x build_macos.sh
./build_macos.sh
```

生成文件为 `dist/PrivacyDocumentTool.app`。首次打开未经签名的应用时，可在 Finder 中按住 Control 点击应用并选择“打开”。如需分发给其他用户，建议再使用 Apple Developer 证书签名和公证。

## 工作目录

源码运行时默认使用当前项目目录。打包后的程序默认使用用户“文稿/Documents”下的“隐私文档工具”目录，也可在界面中选择其他目录。

程序内置以下两套文档模板和赛道映射：

- 普通模板：`site/pension_fund/2`
- 高德模板：`site/bus/8`

内置赛道列表默认只有一条：英文赛道 `test`，中文产品名 `test`。

如果所选工作目录中存在对应路径的模板或 `product_track_map.json`，会优先使用工作目录中的版本。

点击“新增赛道…”后，新记录会写入当前工作目录的 `product_track_map.json`。英文赛道名是唯一键，不区分大小写，不能重复；只允许小写英文字母、数字和下划线，并且必须以字母开头。中文产品名不作为唯一键。

程序内置的原始映射不会被修改；重新打开程序时，只要选择同一个工作目录，新赛道仍会显示在下拉列表中。执行云端同步前，程序还会再次检查所选赛道是否已经存在于映射表中。

## API Token 缓存

保持“记住 API Token”勾选时，点击任一执行按钮会将当前 Token 保存到操作系统的安全凭据库，下次启动程序会自动回填。取消勾选并执行任务会删除已有缓存，也可以随时点击“清除缓存”。
