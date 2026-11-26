# ICU 病历书写工作台

安卓 DSH Go 本机引擎插件。每次 ICU 入科建一张患者卡，用手机上传照片、口述病情，根据本科 v1.1 模板生成日常病程、上级医师查房记录或临时病情变化记录。医生逐段核对和编辑，确认后复制到跨屏通。

## 手机上安装

1. 在安卓手机登录有权访问本私有仓库的 GitHub 账号，打开 [v0.1.0 下载页](https://github.com/xxxxchaos/icu-chart-workbench/releases/tag/v0.1.0)，下载带依赖的 **local-icu-workbench-0.1.0.tgz**。
2. 在 DSH Go 选择**本机引擎**，把下载的压缩包作为文件交给 DSH Go。可以将下面这段交给本机 DSH 执行：

   > 请将我附上的 local-icu-workbench-0.1.0.tgz 解压至本机引擎的 `$DSH_HOME/dsh-go/plugins/local-icu-workbench-0.1.0`，若 DSH_HOME 未设置则用 ~/.dsh。解压时去掉外层 package 目录。保持解压目录及其 node_modules，然后运行 dsh plugin --profile web add 加上该目录的绝对路径。安装完成后告诉我从哪里打开。

   如果你的 DSH Go 版本无法导入此类文件，可从本机引擎可读目录运行以下命令，将第一行改为已导入文件的实际路径。

   ```sh
   archive=/path/to/local-icu-workbench-0.1.0.tgz
   plugin_dir="${DSH_HOME:-$HOME/.dsh}/dsh-go/plugins/local-icu-workbench-0.1.0"
   mkdir -p "$plugin_dir"
   tar -xzf "$archive" --strip-components=1 -C "$plugin_dir"
   dsh plugin --profile web add "$plugin_dir"
   ```

3. 在 DSH Go **全部功能 → ICU 病历工作台**打开，也可在对话详情的插件页进入。配置本机引擎的默认模型。生成调用 DSH 的模型服务，沿用其凭据及默认路由。

插件需要带原生 v2 面板及 files 能力的 DSH Go 本机引擎，Node ≥22.13。已在 DSH 0.2.1-rc.2 的隔离 web profile 验证安装。引擎选图能力由 App 版本决定。仅支持文字的模型也可以工作，JPEG/PNG 图片在本机通过随包提供的中英文 Tesseract OCR 读取，提取文字交给模型。

## 试写

- 建卡后可直接用手机输入法口述。在“保存补充”后选择文书类型和实际记录时间，查房时填写姓名与职称，再点“生成草稿”。重要事件和采样时间写在补充中；资料按所选日期归档。生成后点“查看进度或草稿”。
- 照片每次最多4张，可多次追加。进入“当日资料”查看识别全文、查看照片或分区放大、修改识别值。图中文字、屏幕反光、波形及单位均可能影响 OCR；未确认关键数据在草稿中应列入疑点。原图保存在本机。
- 草稿支持按段编辑，文首为实际记录时间。已定稿记录可全文或分段复制；超出宿主8000字复制上限时分段。重要变化加记独立保存。患者卡设置可转床、归档或切换日期。
- 患者上下文只读取本次入科资料。默认使用所选日期的资料和截至记录时刻已定稿的历史。长住院取首份和最近12份定稿正文，较早文书保留标题索引并可在历史中打开。上传时间不能代替临床时间，同日补写早前文书请核对时间窗。
- 参考文献有两条核实过的基础条目。相关主题会从 PubMed 查询近期指南或共识的摘要，最多两篇。仅固定英文主题词发往 PubMed。检索以摘要为限，具体推荐、适用人群和模型引用仍需医生核对。
- [虚构双患者、连续两天试写材料](examples/连续两天试写.md)附有两张可选入的测试图片。

## 数据与开发

患者卡及文书保存在本机引擎 `$DSH_HOME/icu-workbench/workbench.db`，照片在同级 photos 目录。卸载插件或换版本时，数据目录独立于代码；清除 App 数据或重置引擎前需自行备份。仓库及发布包仅包含源代码和虚构材料。

```sh
npm ci --ignore-scripts
npm test
node /path/to/dsh-Go/sdk/plugin-kit/bin/check.mjs . --load
npm pack
```

[文书模板](ICU日常病程记录模板.md) · [DSH Go 上游](https://github.com/ccch1mneyyy/dsh-Go)
