# 开发指南

[返回 README](../README.md)

## 功能调研

- [实时视频翻译可行性调研](research/realtime-video-translation.md)：字幕与音频路线、服务接入、资源预算、实现难点及分阶段验收计划。

## 开发

### 从源码构建

需要 Node.js 22 或更高版本，以及 npm。

```bash
git clone https://github.com/mr-wuliu/wupage.git
cd wupage
npm ci
npm run build
```

构建完成后，按照 [README 中的手动安装说明](../README.md) 加载 `dist/` 目录。

### 日常开发

```bash
npm run dev        # 监听源码并持续构建
npm run typecheck  # TypeScript 类型检查
npm test           # 运行 Vitest 测试
npm run build      # 生成生产构建到 dist/
```

### 快捷键实现与验证

`shortcutWarning()` 对常用浏览器、编辑和 Ctrl＋Alt 组合给出非阻断警告。警告只显示在对应录入框下方，不设置 `aria-invalid`，不会阻止保存或在设置规范化时重置绑定；重开设置页仍会显示。格式错误和扩展内重复绑定保持原有校验。

`shortcutEnabled` 为四项翻译快捷键与四项局部操作分别保存布尔开关。缺失的旧设置默认启用，原先清空的翻译键迁移为关闭；关闭只改变开关，不清空 `shortcuts`。设置页将两者作为同一份草稿保存，恢复全部默认会重置按键及开关。内容脚本、悬浮球、段落点击和划词卡片通过同一个存储事件同步配置；局部键关闭后仍可使用鼠标按钮。

快捷键保存在扩展设置的 `shortcuts` 中，在设置页直接录入、清空或恢复默认，与其他表单字段一起保存。`src/shared/shortcuts.ts` 统一定义默认值、组合键规范化、事件匹配和已知冲突校验。未配置的新字段补齐默认值，明确清空的值保留为空，非法或重复绑定在读取设置时修复。Chrome / Edge 不提供扩展内改写浏览器快捷键的接口，因此不再声明 Manifest `commands`，避免旧原生绑定与自定义按键同时触发。相关接口范围参见 [Chrome Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)。

`src/content/keyboard-shortcuts.ts` 在顶层网页捕获按键，根据已加载的配置触发 `src/content/shortcuts.ts` 中共用的翻译动作。使用 `KeyboardEvent.code` 匹配字母和数字物理键；忽略 IME、AltGr、输入和编辑区域、已处理事件与重复执行；仅在匹配时阻止网页默认行为。配置变更通过存储事件同步，初始读取不会覆盖较新的存储变更。快捷键仅作用于普通网页正文，不作用于地址栏、嵌入框架或 PDF 查看器。全文开始前的异步读取可被再次按键取消，过期结果不覆盖恢复原文后的提示，连续切换显示模式按保存顺序处理。

相关单元回归覆盖录入、取消、清空、默认值、重复及保留组合键校验、设置保存和分类草稿、即时改键与输入保护、快速启停、显示模式顺序和划词翻译。

`npm run test:shortcuts` 在构建后加载真实扩展，使用独立浏览器资料和本地模拟服务验证设置页录入与保存、无需刷新网页的改键和停用、实际键盘事件触发全文与选区翻译、译文模式复用、段落模式、输入保护与窄屏布局。支持 `PLAYWRIGHT_MODULE`、`CHROME_TEST_BROWSER` 和 `PDF_TEST_BROWSER`，报告及截图写入 `.npm-cache/shortcuts/`。浏览器和系统保留快捷键不由网页拦截，跨系统组合仍需在目标环境确认。

### Firefox 构建与验证

Firefox 需要 154 或更新版本。两种浏览器共用业务源码，分别生成安装目录：

```bash
npm run build          # Chrome / Edge：dist/
npm run build:firefox  # Firefox：dist-firefox/
npm run dev:firefox    # 监听修改并重新生成 Firefox 构建
```

在 `about:debugging#/runtime/this-firefox` 中临时加载 `dist-firefox/manifest.json`。源码修改后先完成构建，再点击该页的「重新载入」，并刷新普通网页。临时扩展退出浏览器后失效；正式安装需要 Mozilla 签名。

`public/manifest.json` 是共享配置；`build/manifest.ts` 生成 Firefox 的后台脚本、扩展 ID、最低版本和数据传输声明。版本号保持与共享 Manifest 一致。Firefox 154 提供 OCR 依赖的扩展沙箱。两种浏览器均使用专用 OCR 运行库，OpenCV WASM 独立保存，避免将二进制编码到 JavaScript 中。

Firefox 的后台事件页通过隐藏 iframe 托管 OCR 和 Bergamot。仅在模型下载期间发送内部心跳，防止关闭界面后后台空闲卸载；任务结束立即停止。Firefox 的 Bergamot 适配从扩展页面读取随包附带的 WASM 并转交 Worker，支持首次断网启动。Chrome / Edge 继续使用 offscreen 文档与原始 Worker。

```bash
npm run test:firefox
npx web-ext lint --source-dir dist-firefox
```

`test:firefox` 使用本机 Firefox 的 Marionette 测试接口和独立资料目录，不依赖浏览器驱动，不访问日常浏览数据。Windows 默认查找标准安装位置；其他位置或系统可通过 `FIREFOX_BINARY` 指定可执行文件。运行前先构建 Firefox 包。

测试使用本地网页、PDF 与模拟翻译服务，验证设置持久化、三种译文模式、Ollama 请求头、本地和在线 PDF、真实 OCR 识别与缓存、模型删除，以及关闭所有扩展界面超过 30 秒后继续下载模型、首次断网英译中和自动检测。模型从官方地址下载并缓存；Bergamot 也可通过 `LOCAL_MODEL_FIXTURE_DIR` 使用已保存的模型文件。只有临时测试包中的模型下载地址会重定向到本地服务器，生产校验和推理实现保持不变。报告和截图保存在 `.npm-cache/firefox/`。

项目主要目录：

```text
src/
├── background/  # 服务商适配、任务调度、缓存与消息处理
├── content/     # 网页文本识别、译文渲染、段落模式与悬浮球
├── local/       # Bergamot 模型目录、续传缓存、离线导入、Worker 与管理界面
├── options/     # 设置与服务商配置界面
├── pdf/         # PDF 加载、布局、编辑、渲染与导出
├── popup/       # 扩展弹窗交互
└── shared/      # 类型、默认设置、语言与跨上下文工具
tests/           # Vitest 测试
public/          # Manifest 与扩展图标
```

LLM 高级请求模板由 `src/shared/request-template.ts` 统一解析、校验并应用于 OpenAI、Anthropic、DeepSeek、智谱及视觉请求。模板先解析 JSON，再在值中替换变量，防止原文中的引号或换行改变请求结构；请求体采用 JSON Merge Patch 语义，请求头按名称大小写无关地覆盖或删除。配置保存在各服务的 `requestTemplate` 中，未配置或禁用时沿用原请求。设置页的选项卡与模板编辑位于 `src/options/provider-advanced.ts`。相关回归覆盖模板合并、变量转义、保存与禁用、实际请求参数、校验失败和键盘切换。

默认文本请求和设置页模板共用 `defaultLlmRequestTemplate`，运行时通过 `defaultLlmRequest` 替换变量，避免预览与实际请求的字段漂移。空配置在编辑框内展示默认模板，未编辑的展示内容不会持久化为覆盖参数；「载入默认模板」启用并复制模板，「恢复默认请求」清除覆盖并恢复默认展示。认证头按常规设置中的凭据是否存在生成，展示和载入时只使用密钥占位符。

`npm run test:templates` 在构建后加载真实扩展，通过本地 HTTP 服务检查四类 LLM 的自定义请求头和请求体、设置重载、关闭与恢复、校验错误、HTTP 模板兼容及窄屏布局。支持 `PLAYWRIGHT_MODULE`、`PDF_TEST_BROWSER`，报告与截图保存在 `.npm-cache/request-templates/`，不访问真实付费接口。

提交改动前建议依次运行：

```bash
npm run typecheck
npm test
npm run build
```

### 网页翻译回归验证

本机 Chrome 可通过 `CHROME_TEST_BROWSER` 指定路径运行同一套网页翻译回归。测试使用独立资料目录、本地网页与模拟服务，不读取日常浏览资料。先运行 `npm run build`，再在 PowerShell 中执行：

```powershell
$env:CHROME_TEST_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:page
```

需要可导入的 Playwright（也可用 `PLAYWRIGHT_MODULE` 指定模块路径）。Chrome 通过扩展调试接口加载 `dist/`，报告与截图写入 `.npm-cache/chrome-translation/`。

- 自动翻译由 `src/shared/auto-translation.ts` 归一化并匹配站点规则，`src/content/auto-translation.ts` 在前台 HTML 页面触发现有渐进翻译。弹窗和悬浮菜单的「＋」复用站点添加逻辑，只从 HTTP/HTTPS 地址提取域名和非默认端口，不保留路径、查询参数或片段；已有整站规则会复用，同站点的已停用规则会启用。「✓」再次点击后将当前域名写入可选的 `excludedSites`，优先于站点及语言规则；保留正向规则以继续服务其他子域名，重新加入时清除该域名的排除。设置页草稿读写保留排除项，并可单独取消排除。语言检测仅使用本机浏览器接口；路由、配置与手动停止会使过期检测结果失效。回归覆盖域名边界、通配与路径、旧设置默认关闭、动态内容、手动停止和单页导航。
- `npm run test:auto`：构建后加载实际扩展，使用本地网页和模拟翻译服务验证规则保存、窄屏、自动触发、手动恢复原文、单页导航、目标语言跳过和异步加载的正文；另检查弹窗和悬浮菜单加入、排除及重新加入当前网站、重复规则限制、设置页持久化与保存后保留排除项、排除优先于语言规则且刷新后有效，以及新增站点立即触发翻译。报告保存在 `.npm-cache/auto-translation/`。
- 六个预置在线翻译服务通过 `serviceMode` 区分 `free`（默认）和 `api`，凭据保存在对应配置的 `api` 中。免费分支不读取或发送这些凭据；切换方式会保留已有配置。旧版内置 Azure / Google Cloud 配置在规范化设置时迁移至对应服务商，存在不同凭据时保留独立配置。火山 API 在后台通过 Web Crypto 生成 V4 签名；腾讯 API 使用 TokenHub 的翻译模型。
- `npm run test:services`：构建后加载实际扩展，以模拟网络响应验证六家服务的免费/API 切换、设置保存、凭据保留、实际请求分支和窄屏布局，不访问真实付费服务。支持 `PLAYWRIGHT_MODULE`、`PDF_TEST_BROWSER`，报告保存在 `.npm-cache/service-modes/`。
- 服务额度资料保存在 `src/shared/provider-usage.ts`，设置页在切换服务、使用方式、模型或地址时更新。维护数值时须核对所链接的官方资料并更新核对日期；匿名接口与云 API 分开，官方未公开的数字不以经验值代替。`src/options/provider-usage.ts` 单独显示插件调度设置，不能将 RPM、QPS 和并发混用。说明仅使用随扩展打包的资料，不查询账号余额或额外请求第三方接口。
- 另外预置 `tencent-transmart`、`yandex-web-translate`、`volcengine-web-translate` 与 `mymemory`。免费模式下，腾讯使用批量请求，Yandex 与火山逐项处理以保留段落对应关系；MyMemory 在本机检测源语言，并按 500 UTF-8 字节分段，保留空白、Unicode 字符、占位符及实体字面量。回归测试覆盖错误响应、额度限制、取消和旧配置兼容。
- 服务图标随扩展内联打包，弹窗、悬浮菜单和 PDF 共用带图标的服务选择器；设置页复用同一图标映射。图标来源与 MIT 许可保存在 `public/licenses/lobe-icons.txt`，显示时无需访问外部图片服务器。
- `npm run test:page`：先运行 `npm run build`，再使用可选的 Playwright 与 Chromium 加载真实 MV3 扩展。支持 `PLAYWRIGHT_MODULE` 与 `PDF_TEST_BROWSER` 环境变量。
- 使用本地页面和本地模拟翻译服务，覆盖两种窗口宽度、三种显示模式、代码占位符损坏恢复、隐藏内容与草稿排除、Ctrl 点击段落翻译、清除还原，以及动态原文更新后的迟到响应。切换显示模式不得新增翻译请求。
- YouTube 新旧评论结构按整条正文翻译，双语译文另起一行；同时检查短评论、带链接的富文本、长译文自动折行及网页 `white-space: nowrap` 的继承隔离。
- 同时检查 `dist/content.js` 能作为普通脚本解析，防止公共工具被拆成模块导入而导致内容脚本无法加载。报告保存在 `.npm-cache/page-translation/report.json`。
- `npm run test:cards`：使用实际扩展和本地模拟服务，检查中英文界面下的混合语言卡片。覆盖 Flex/Grid 字段分离、标题字号与字重、作者链接、两种窗口宽度、三种显示模式和清除还原；匿名服务将整批判为目标语言时，未翻译项应独立重试。报告保存在 `.npm-cache/card-layout/`。
- `npm run test:floating`：加载实际扩展，覆盖真实指针的 500 毫秒悬停延迟、离开取消、拖动与位置保存、悬浮球和弹窗的翻译中停止、迟到响应、原译文切换与缓存复用、动态列表、状态同步、缓存清理、失败重试、Debug、设置入口、键盘操作和小窗口。另检查紧凑菜单布局、划词开关与弹窗的双向同步、缺少 OCR 模型时禁用图片翻译，以及说明弹层的边界。报告保存在 `.npm-cache/floating-interactions/`。
- `npm run test:floating-responsive`：使用实际扩展和触屏仿真，覆盖 iPad Pro 13 的 1032 × 1376 竖屏与横屏。检查长按打开菜单、松手保持、外部轻点关闭、拖动取消长按、轻点翻译，以及首次翻译失败自动打开菜单的服务、语言与显示模式、菜单边界和触屏选择操作；另验证纯触屏隐藏段落模式及说明、鼠标环境保留入口，以及弹窗隐藏后的紧凑布局。报告与截图保存在 `.npm-cache/floating-responsive/`，支持 `PLAYWRIGHT_MODULE` 与 `PDF_TEST_BROWSER`。
- `npm run test:settings`：延迟返回设置，逐帧检查弹窗和设置页重开时的图片翻译开关；保存为开启或关闭的状态都不得闪现错误位置或启动动画。报告保存在 `.npm-cache/settings-initialization/`。
- 网页回归还包含明暗背景、现代 CSS 颜色和网页强制文字颜色下的实际颜色检查，切换原色、双色和替换模式时不得新增翻译请求。
- 翻译链路的审视结论与兼容处理边界见 [翻译系统审视](translation-review.md)。

### 外观配置与验证

`src/shared/appearance.ts` 管理内置方案、自定义颜色校验和明暗方案选择；`appearance-runtime.ts` 监听系统明暗及本地设置变化，通过 `--wp-*` 变量应用到扩展界面。网页中只注入扩展专用变量，不修改宿主页面的 `color-scheme`；划词卡片在 Shadow DOM 中继承同一组变量。`src/options/appearance.ts` 保存独立表单草稿，与其他设置分类一起提交。

配色按界面、悬浮球、译文与段落、划词翻译、图片入口分组。`src/shared/translation-colors.ts` 共用网页背景识别和对比度处理；内容脚本在方案或系统明暗变化时原地更新已渲染的双色译文，包括段落翻译和图片段落，不重新发送翻译请求。旧自定义方案缺少组件颜色时从原有界面色补齐。

`appearance.floatingOpacity` 独立于配色方案，保存 0–100 的整数百分比，旧配置默认 100。滑块与数字输入共用草稿并即时更新预览，数值超出范围或为空时阻止保存；导入设置会将有限数值取整并限制范围。运行时映射为 `--wp-floating-opacity`，作用于球体和预览，拖动时以该值乘原有的 0.92 系数，展开菜单保持正常不透明度。

`tests/appearance.test.ts`、`tests/options-appearance.test.ts` 和 `tests/translation-appearance.test.ts` 覆盖旧设置兼容、异常色值、系统切换、方案复制与删除、草稿保存、透明度联动、数值校验及双色译文更新。`npm run test:appearance` 构建后使用可选 Playwright 与 Chromium 检查实际组件配色、透明度键盘操作与拖动、数字输入与预览、保存后球体及拖动透明度、菜单可读性、保存重开、译文换色不增加请求以及窄屏布局，支持 `PLAYWRIGHT_MODULE`、`PDF_TEST_BROWSER`，报告保存在 `.npm-cache/appearance/`。

### 划词翻译回归验证

划词设置在 `src/shared/dictionary.ts` 归一化，`src/content/selection-translation.ts` 负责选区入口与隔离样式的结果卡片。简单规则只将不超过 100 字符的单个字母词（允许词内连字符和撇号）交给词典；空释义、多词、句子及中日韩文本使用现有 `TRANSLATE_BATCH`，沿用当前服务、语言、缓存及本地翻译设置，选区上限为 5,000 字符。词典请求失败保留重试，不能作为未收录结果回退。后台固定访问有道和 Bing 的词典端点，词条适配在 `src/dictionary/parsers.ts`；Bing HTML 在共享扩展运行页的惰性模板中解析，不执行或挂载远程页面内容。发音下载有来源、类型、大小和超时限制，由扩展运行页播放；词典请求不携带网页上下文或 Cookie，查词结果不写入翻译缓存。

- 原文使用卡片内的文本框编辑，按钮或 `Ctrl+Enter` 提交，普通回车保留换行。输入立即使旧请求结果失效并停止发音，但不发起新请求；重新提交沿用当前词典及翻译服务分流，不修改网页正文。文本框聚焦时展开，内部滚动不关闭卡片。
- 单元测试覆盖旧配置兼容、两种词条结构、单词分流、未收录回退、直接翻译、当前语言与本地服务复用、长文本与换行、原文编辑与重新提交、输入校验、无效响应、音频来源限制、跨行入口、编辑区域排除和异步结果失效。
- `npm run test:selection`：构建后加载实际 Chromium MV3 扩展，使用本地网页、模拟词典和有效音频验证两家服务、设置保存、原生鼠标划词、跨行下划线、窄屏定位、失败状态，以及页面禁止音频时的扩展内播放。使用独立浏览器资料目录，支持 `PLAYWRIGHT_MODULE`、`PDF_TEST_BROWSER`，报告与截图保存在 `.npm-cache/selection-translation/`。

### 图片翻译回归验证

OCR 使用 `vendor/ocr/` 内的专用 OpenCV 4.10.0 和 ONNX Runtime 1.30.0。普通 `npm ci` 与扩展构建直接使用这些已编译文件，不要求本机安装 C++ 编译器。构建会校验每个文件的 SHA-256、裁剪配置、SDK 版本和模型固定值；模型或运行库版本更新后必须重新编译，不能直接替换通用 WASM。

`src/shared/ocr-control-core.ts` 共用模型状态、安装、删除与帮助交互；弹窗和设置页通过 `ocr-control.ts` 加载样式，内容脚本通过 `src/content/styles.ts` 提供菜单内的限定样式。悬浮菜单显式传入控件和独立帮助 ID，避免匹配网页自身的元素；首次打开时查询模型状态，关闭或移出文档后停止轮询，再次打开时恢复。

专用运行库的源码提交与工具链版本在 `build/ocr/runtime.json`，依赖在 `build/ocr/requirements.txt`。Linux 或 WSL 下重新构建：

```bash
python3 -m venv .npm-cache/ocr-venv
. .npm-cache/ocr-venv/bin/activate
pip install -r build/ocr/requirements.txt
python3 build/ocr/build.py --work-dir .npm-cache/ocr-build-native --jobs 4
```

首次构建需要联网获取固定提交的上游源码、Emscripten 4.0.23 及两个 OCR 模型。脚本校验模型大小与摘要，从 ONNX 图生成所需操作清单，保留 ONNX 格式支持。OpenCV 仅保留 `core`、`imgproc` 和 `build/ocr/opencv.config.py` 中的接口，关闭文件系统；ONNX Runtime 保留 SIMD、单线程推理，裁剪模型未用到的操作与扩展功能。浏览器加载器仍使用标准 `ort-wasm-simd-threaded.*` 文件名，但这对文件来自同一次单线程构建。

OpenCV 4.10 的构建文件还会移除旧 Emscripten 的 demangler 选项及文件系统预加载标志，并适配 C++17 和异步工厂包装器。ONNX Runtime 通过操作裁剪与 LTO 缩小体积，保留 `-O3` 优化以兼顾模型推理速度。完整变换由 `build/ocr/build.py` 记录；生成的许可、第三方声明、操作清单与文件摘要随 `vendor/ocr/` 提交。重新生成文件后运行下列真实 OCR 回归，比较识别文字、坐标与运行时间，再提交运行库更新。`npm test` 排除 `.npm-cache/`，避免将下载的上游源码或旧测试资料目录纳入项目单元测试。

生产构建默认不生成源码映射。调试时可设置 `WUPAGE_SOURCEMAP=1` 后构建；PowerShell 使用 `$env:WUPAGE_SOURCEMAP = '1'`。源码映射仅用于本地排查，不属于浏览器执行所需资源。

- 本地视觉回归页：运行开发预览服务后打开 `tests/fixtures/image-preview.html`，使用固定模型结果检查覆盖、切换、缩放与内部滚动，不调用外部 API。
- `npm run test:ocr`：加载真实扩展，下载并校验公开 OCR 模型到独立测试资料目录，验证沙箱初始化、图片识别、覆盖显示、三次原译图切换、重新打开后的缓存、模型删除和设置持久化。翻译使用本地模拟服务，不使用真实 API 密钥。需要网络下载约 20.5 MB 模型及可选的 Playwright 与 Chromium；报告保存在 `.npm-cache/ocr-flow/`。
- `npm run test:ocr-runtime`：使用实际沙箱、模型和运行库识别中、英、日文，以及透明底、白字和旋转文字。支持 `PLAYWRIGHT_MODULE`、`PDF_TEST_BROWSER` 和缓存模型目录 `OCR_MODEL_FIXTURE_DIR`。可用 `OCR_BASELINE_DIR` 指向保留的旧构建目录，对比文字及坐标（最多允许 2 像素差异），报告记录初始化与识别用时，保存到 `.npm-cache/ocr-runtime/report.json`。
- OCR 实测页：先 `npm run build`，再 `node tests/fixtures/ocr-preview-server.mjs`，打开 `http://127.0.0.1:5175`，验证真实下载、安装、识别、状态持久化和删除。仅模拟扩展消息，OCR 模型、沙箱和校验使用生产实现。日文透明文字样例还支持真实翻译，以及使用固定译文的符号覆盖与断句回归。
- `npm run test:image-resolution`：需要可选的 Playwright 与 Chromium，支持 `PLAYWRIGHT_MODULE` 和 `PDF_TEST_BROWSER` 环境变量。使用只有 viewBox 的 SVG 与固定译文，检查 1、1.25、2 倍屏幕像素密度下的清晰度、放大后重绘与译文复用；未翻译区域逐像素对照直接绘制的 SVG。脚本也接受本地 SVG 路径，报告保存在 `.npm-cache/image-resolution/`。

### 本地翻译实验与验证

- `firefox-local` 使用固定版本 `@browsermt/bergamot-translator@0.4.9` 的 Worker、JavaScript 和 WASM，构建时复制到对应产物的 `bergamot-runtime/`。Firefox 仅调整 Worker 的 WASM 输入方式，保留相同的引擎与模型字节。执行代码全部随扩展打包，不在运行时加载远程代码。Manifest 的 `wasm-unsafe-eval` 仅允许 WebAssembly 编译。
- `src/local/catalog.json` 固定 Mozilla Remote Settings 模型目录中的语言方向、版本、官方附件 URL、大小与 SHA-256。运行时无需访问模型目录。更新记录时需同时核对模型、词表和 shortlist，并使用真实模型验证运行库兼容性。
- OCR 与翻译复用同一个运行文档：Chrome / Edge 使用 offscreen，Firefox 使用后台事件页内的隐藏 iframe。翻译引擎仅在有请求且模型就绪时创建独立 Worker，串行处理任务，切换模型路线时释放旧 Worker，空闲 60 秒后释放运行内存。
- Cache Storage 按文件摘要保存模型与 1 MB 续传片段。网络请求省略凭据；下载、离线导入和推理读入均校验 SHA-256。写操作使用 Web Locks 避免跨设置窗口冲突，清理翻译缓存不影响模型。
- `npm test` 覆盖没有隐式下载、下载中断与续传、服务器忽略 Range、已完成文件复用、损坏文件拒绝、离线导入、共享文件保留、语言映射、英语中转、自动检测失败提示与单线程限制。
- `npm run test:local` 使用可选的 Playwright 与 Chromium 加载真实 MV3 扩展，默认从官方 CDN 下载约 51.9 MB 的英译中模型，然后断网验证翻译、自动语言识别、模型持久化和删除。支持 `PLAYWRIGHT_MODULE`、`PDF_TEST_BROWSER`；`LOCAL_MODEL_FIXTURE_DIR` 可指向事先保存的模型文件目录，此时仅在临时测试构建中将该模型的下载地址改为本地 HTTP 服务器，实际制造断流并验证 Range 续传，随后验证断网翻译和离线导入。生产源码、模型字节、校验值与推理引擎均保持原样。报告与截图保存在 `.npm-cache/local-translation/`。
- 单元测试不衡量模型质量。真实模型回归至少检查英译中；其他方向、英语中转及低内存设备仍需人工比较质量、速度和资源占用。

### PDF 排版回归

复杂 PDF 的浏览器回归样本、执行方式和覆盖边界见 [PDF 排版回归](pdf-regression.md)。

构建后运行 `npm run test:pdf-scope` 可验证阅读范围调度。需要可选的 Playwright 与 Chromium，支持以下 GitHub 排版测试相同的环境变量。测试加载真实扩展，使用本地 40 页 PDF 和模拟翻译服务，验证选择文件、拖放、输入地址及切换文档后的默认自动翻译、滚动自动补译、快速跳页、重叠范围与手动编辑保留、设置切换，以及下载前补全全文翻译、直接下载与重复导出复用。手动调度与直接下载场景显式使用 `translate=0` 隔离自动启动。`tests/pdf-download.test.ts` 另覆盖切换语言、空白页、翻译失败或响应不完整后的下载拦截与重试，以及切换文档时取消下载。报告保存在 `.npm-cache/pdf-scope/`。

### GitHub 代码注释排版回归

安装可选的 Playwright 与 Chromium 后运行 `npm run test:github-code`。测试使用本地代码视图样本，不访问 GitHub 或翻译服务，覆盖普通行、固定位置行和旧版表格，以及两种窗口宽度、三种显示模式、加载占位、长译文横向滚动和清除还原。所有阶段都要求代码行位置与行号保持对齐，译文字形不能跨入下一行。

可通过 `PLAYWRIGHT_MODULE` 指定外部 Playwright 的 `index.mjs`，通过 `PDF_TEST_BROWSER` 指定现有 Chromium 或 Edge 的可执行文件；测试报告保存在被 Git 忽略的 `.npm-cache/github-code-comments/`。
