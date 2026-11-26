# ICU 病历书写工作台

安卓 DSH Go 本机引擎插件。每次 ICU 入科建一张患者卡，用手机上传照片、口述病情，按科室确认的 v1.1 文书模板生成日常病程、上级医师查房记录或临时病情变化记录。医生逐段核对和编辑，确认后复制到跨屏通。

**当前公开试用版为 v0.1.2。** v0.1.2 新增聊天输入框上方的「ICU 病历」胶囊和右侧信息栏的「ICU 病历工作台」入口；未配置默认模型时也能打开工作台、建卡和录资料。已在桌面 DSH 本机引擎验证安装，并用虚构病例调用 DeepSeek 生成查房草稿。安卓真机选图、手机编辑体验及跨屏通传输仍待验收。维护者请先读[项目交接](https://github.com/xxxxchaos/icu-chart-workbench/blob/main/HANDOFF.md)。

## 手机上安装

1. 在安卓手机浏览器打开 [v0.1.2 下载页](https://github.com/xxxxchaos/icu-chart-workbench/releases/tag/v0.1.2)，下载带依赖的 **local-icu-workbench-0.1.2.tgz**。
2. 在 DSH Go 选择**本机引擎**，把下载的压缩包作为文件交给 DSH Go。可以将下面这段交给本机 DSH 执行：

   > 请将我附上的 local-icu-workbench-0.1.2.tgz 解压至本机引擎的 `$DSH_HOME/dsh-go/plugins/local-icu-workbench-0.1.2`，若 DSH_HOME 未设置则用 ~/.dsh。解压时去掉外层 package 目录。保持解压目录及其 node_modules，然后运行 dsh plugin --profile web add 加上该目录的绝对路径。安装完成后先不要退出，告诉我从哪里打开，以及「设置 → 插件」里是否看到 ICU 病历书写工作台。

   如果你的 DSH Go 版本无法导入此类文件，可从本机引擎可读目录运行以下命令，将第一行改为已导入文件的实际路径。

   ```sh
   archive=/path/to/local-icu-workbench-0.1.2.tgz
   plugin_dir="${DSH_HOME:-$HOME/.dsh}/dsh-go/plugins/local-icu-workbench-0.1.2"
   mkdir -p "$plugin_dir"
   tar -xzf "$archive" --strip-components=1 -C "$plugin_dir"
   dsh plugin --profile web add "$plugin_dir"
   ```

3. 安装后先启用，再找入口：

   - 打开 **DSH Go → 设置 → 插件**（也可从「全部功能 → 插件」进入），找到 **ICU 病历书写工作台**，确认右侧开关是打开的；如果列表里没有它，说明装到了别的引擎/profile，回到上一步检查 `DSH_HOME`。
   - 点进插件详情，展开 **原生界面**，确认「全部功能」「对话详情」「聊天页」至少有一个显示位置没有被关掉。
   - 回到本机引擎页，**重启引擎**。首次安装或更新后重启一次最稳妥。

   然后从以下任一入口打开：

   - 聊天输入框上方的 **ICU 病历** 胶囊（最直接，进入任意对话即可看到）；
   - **全部功能 → 插件 → ICU 病历工作台**；
   - **对话详情 → 插件 → ICU 病历工作台**；
   - 对话右侧信息栏的 **ICU 病历工作台**。

   工作台不要求先配模型：没有默认模型时也能建卡、记录资料和看历史，生成草稿前会提示去 DSH 设置选择默认模型。生成调用 DSH 的模型服务，沿用其凭据及默认路由。

插件需要带原生 v2 面板的 DSH Go 本机引擎；选图还需宿主提供 files 能力，Node ≥22.13。已在 DSH 0.2.1-rc.2 的隔离 web profile 验证安装。引擎选图能力由 App 版本决定。仅支持文字的模型也可以工作，JPEG/PNG 图片在本机通过随包提供的中英文 Tesseract OCR 读取，提取文字交给模型。

### 还是没有入口

按顺序做这四步，基本能定位：

1. **确认装在同一台本机引擎。** 在 DSH Go 本机引擎里执行：

   ```sh
   echo "DSH_HOME=$DSH_HOME"
   dsh --version
   dsh plugin --profile web list | grep -i icu
   dsh web --dump-config | grep -A4 local-icu-workbench
   ls -la "${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/local-icu-workbench/package.json"
   ```

   四项里至少 `plugin list`、`--dump-config` 和 `ls` 应能看到 `local-icu-workbench`。如果都没有，说明压缩包解到了另一个 `DSH_HOME` 或另一个 profile；重新按上面的绝对路径安装。

2. **确认启用。** **设置 → 插件** 里找到插件，开关打开；**插件详情 → 原生界面** 里看有没有 `plugin-error`、`needs-app` 或某处显示位置被关掉。原生日志会写在插件详情页，不是所有错误都会弹窗。

3. **重启引擎。** 改完开关或更新包后，回到本机引擎页停止再启动；只刷新页面不一定重新加载插件。

4. **看诊断。** **设置 → 诊断** 里导出诊断包，或点「让 AI 看诊断」；把插件详情里的错误行截图给维护者。没有入口但插件已启用，通常是 `dshGo` 桥接没加载、App 版本不支持某个位置，或引擎仍在安全模式。

   安全模式下 App 不加载自装插件；确认本机引擎页不是在**安全模式**，并且当前主机是**本机**而不是远程主机。

## 试写

首次使用可按[两天试写脚本](examples/连续两天试写.md)建卡，依次选择[血气单](examples/虚构血气单.png)和[监护仪](examples/虚构监护仪.png)。先核对住院日、泵药剂量、计量单位和诊疗计划，然后把确认稿复制到跨屏通 App 或小程序发送。

- 建卡后可直接用手机输入法口述。在“保存补充”后选择文书类型和实际记录时间，查房时填写姓名与职称，再点“生成草稿”。重要事件和采样时间写在补充中；资料按所选日期归档。生成后点“查看进度或草稿”。
- 照片每次最多4张，可多次追加。进入“当日资料”查看识别全文、查看照片或分区放大、修改识别值。图中文字、屏幕反光、波形及单位均可能影响 OCR；未确认关键数据在草稿中应列入疑点。原图保存在本机。
- 草稿支持按段编辑，文首为实际记录时间。已定稿记录可全文或分段复制；超出宿主8000字复制上限时分段。重要变化加记独立保存。患者卡设置可转床、归档或切换日期。
- 患者上下文只读取本次入科资料。默认使用所选日期的资料和截至记录时刻已定稿的历史。长住院取首份和最近12份定稿正文，较早文书保留标题索引并可在历史中打开。上传时间不能代替临床时间，同日补写早前文书请核对时间窗。
- 参考文献有两条核实过的基础条目。相关主题会从 PubMed 查询近期指南或共识的摘要，最多两篇。仅固定英文主题词发往 PubMed。检索以摘要为限，具体推荐、适用人群和模型引用仍需医生核对。
- [虚构双患者、连续两天试写材料](examples/连续两天试写.md)附有两张可选入的测试图片。

## 数据与开发

患者卡及文书保存在本机引擎 `$DSH_HOME/icu-workbench/workbench.db`，照片在同级 photos 目录。卸载插件或换版本时，数据目录独立于代码；清除 App 数据或重置引擎前需自行备份。发布包内附运行依赖、OCR 语言包及虚构材料。生成时会将本次入科的相关文字资料和历史定稿发给 DSH 配置的模型服务；请按所在机构对病历数据的授权使用。

```sh
npm ci --ignore-scripts
npm test
node /path/to/dsh-Go/sdk/plugin-kit/bin/check.mjs . --load
npm pack
```

[文书模板](ICU日常病程记录模板.md) · [DSH Go 上游](https://github.com/ccch1mneyyy/dsh-Go)
