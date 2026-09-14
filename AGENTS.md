# AGENTS.md

> 面向 AI Agent 的 PDF工具箱开发指南。最后更新：2026-09-14 · 适用分支：main
> 维护约定：改动接口/水印逻辑/上传限制/前端架构后，必须同步更新本文件第 3、5 节。

## 0. 快速上手（30 秒版）
- 项目一句话：本地运行的 PDF 多功能处理工具箱，纯本地处理不上传服务器。
- 技术栈：Flask(>=3.0) + PyMuPDF(>=1.24) + pdf2docx(>=0.5.8) + Pillow(>=10)；前端为原生 HTML/CSS/JS（无 Node）。
- 启动：`bash ./start.sh`（自动建 venv、装依赖、起服务，端口 8080，Debug 模式）。
- 访问：http://localhost:8080
- 改代码前必读：[第 3 节 禁止与坑位](#3-ai-agent-开发指导-最高优先级)

## 1. 项目全局认知
### 1.1 目标与定位
浏览器端操作的本地 PDF 工具集（压缩/转Word/提取图片/合并/拆分/提取文字/转图片/旋转/排序/删页/水印）。所有处理在本地完成，不上传。

### 1.2 整体架构
```
浏览器 (templates/index.html + static/)  ──HTTP/JSON──▶  Flask (app.py)  ──▶  PyMuPDF/pdf2docx
       前端状态 state / callAPI                           读写 uploads/ outputs/  处理 PDF 文件
```
- 前端：单页、原生 JS，无构建步骤，直接由 Flask 静态托管。
- 后端：单文件 `app.py`，每个功能一个 `/api/*` 路由，处理后落盘到 `outputs/`，前端再 `/api/download` 拉取。

### 1.3 技术栈（版本来自 requirements.txt）
- 后端：Flask>=3.0.0、PyMuPDF>=1.24.0、pdf2docx>=0.5.8、Pillow>=10.0.0；Python 3.9+。
- 前端：原生 HTML/CSS/JS（无框架、无打包器）。

### 1.4 核心模块职责
| 模块 | 路径 | 负责 | 不负责 |
|------|------|------|--------|
| 后端服务 | `app.py` | 全部 API、文件 IO、PDF 处理、413 处理 | 任何前端渲染 |
| 页面结构 | `templates/index.html` | DOM 结构、弹窗、SVG 图标 | 交互逻辑、样式 |
| 交互逻辑 | `static/js/main.js` | 状态管理(state)、callAPI、loading/toast、弹窗 | 后端计算、样式 |
| 样式 | `static/css/style.css` | 视觉、布局（`.app` max-width:1440px）、变量 | 行为逻辑 |
| 启动脚本 | `start.sh` | 建 venv、装依赖、起服务 | 业务逻辑 |

### 1.5 数据流
上传：`uploadFiles()` → `POST /api/upload`（FormData 多文件）→ 返回 `{filename,size,pages}` → 写入 `state.files`。
处理：点功能 → `handleFeature()` → `callAPI(url,body,label)`（showLoading + fetch JSON）→ 结果写 `outputs/` → 返回 `{filename}` → 前端 `/api/download/<filename>` 下载。

### 1.6 关键设计原则
- 所有请求走统一封装 `callAPI(url, body, actionLabel)`，自带 loading 与错误 toast，禁止在别处裸写 `fetch`。
- 文件先落 `uploads/` 再处理，结果落 `outputs/`，二者 2 小时自动清理（`cleanup_old_files`，首页访问时触发）。
- 前端与后端通过 JSON 字段约定（如 `filename`/`text`/`opacity`/`fontSize`/`color`/`rotation`/`spacing`），改字段必须前后端同步。

## 2. 开发规则
- 2.1 目录约定：后端逻辑只在 `app.py`；前端逻辑只在 `main.js`；结构只在 `index.html`；样式只在 `style.css`。不要跨文件塞逻辑。
- 2.2 命名：Python 函数 `snake_case`；JS 函数 `camelCase`；CSS class `kebab-case`；新增 API 路径统一 `/api/<action>`（POST）。
- 2.3 新增功能套路：① `app.py` 加 `@app.route("/api/xxx")`；② `index.html` 加 `feature-card[data-feature=xxx]`（默认 `disabled`）；③ `main.js` 的 `handleFeature` 加分支；④ 若需参数用现有弹窗或在 `index.html` 加 modal。
- 2.4 错误处理：后端返回 `jsonify({"error": "..."})` + HTTP 码；前端 `callAPI` 已统一 catch 并 `showToast`。新增接口务必返回 `{error}` 而非抛裸异常。
- 2.5 日志：Flask Debug 模式自带请求日志；新增处理建议用 `print` 仅用于本地调试，不要提交敏感路径日志。
- 2.6 测试：无自动化测试。改后端后务必用 `curl` 或浏览器实际跑一遍对应功能。

## 3. AI Agent 开发指导 ★最高优先级★
### 3.1 改动前必看
- 改水印 → 读 `app.py` 的 `add_watermark`（含 CJK 检测、旋转取整、间距公式）。
- 改上传限制 → 读 `app.py:26-34`（`MAX_FILE_SIZE` 与 413 handler）。
- 改前端交互 → 读 `main.js` 的 `state`、`callAPI`、`showLoading/hideLoading`、`applyWatermark`。
- 改布局 → 读 `style.css` 的 `:root` 变量与 `.app`（max-width:1440px）。

### 3.2 禁止随意修改
- `app.py` 顶部 `MAX_CONTENT_LENGTH` 与 413 handler：随意调小会再次触发 413；调大需确认磁盘/内存（PDF 处理吃内存）。
- 水印字体分支 `has_cjk → "china-ts"`：不能改回 `"helv"`，否则中文水印变灰块（见 3.4）。
- `.app { max-width: 1440px }`：这是用户明确要求的页面宽度上限，不要改回 960px 或去除。
- `start.sh` 的 venv 逻辑：删除会导致 `flask` 模块找不到。

### 3.3 强依赖关系（改 A 必改 B）
- 前端 `feature-card[data-feature]` ↔ `main.js:handleFeature` 分支 ↔ `app.py` 路由：三者命名必须一致。
- 水印参数 `rotation/spacing/fontSize/opacity/color/text`：弹窗输入(`index.html`) ↔ `applyWatermark` 收集(`main.js`) ↔ `add_watermark` 解析(`app.py`) 字段名必须一致。
- 上传文案「单个文件最大 300MB」(`index.html:upload-limit`) 与 `MAX_FILE_SIZE`(300MB) 必须同步。

### 3.4 常见错误模式（真实踩坑）
- **现象**：水印中文显示成灰色方块。**根因**：`insert_text` 用 `fontname="helv"`，Helvetica 无中文字形。**正确做法**：CJK 字符检测后改用 `"china-ts"`（已在 `add_watermark` 实现，勿删）。
- **现象**：`POST /api/watermark` 报 `bad rotate value`。**根因**：PyMuPDF `rotate` 只支持 0/90/180/270，任意角度报错。**正确做法**：后端 `rotation = round(rotation/90)*90 % 360` 已做归整。
- **现象**：`413` 上传失败。**根因**：请求体超 `MAX_FILE_SIZE`(300MB)。**正确做法**：调大常量或走 413 handler 提示；不要去掉限制。
- **现象**：`ModuleNotFoundError: No module named 'flask'`。**根因**：未进 venv。**正确做法**：必须 `./start.sh` 或 `source venv/bin/activate`。
- **现象**：loading 转圈看不到 / 水印弹窗点完无反馈。**根因**：loading overlay `z-index:200` 必须高于弹窗 `z-index:150`；且 `applyWatermark()` 必须 `await` 完再关弹窗。**正确做法**：保持该顺序与 z-index。
- **现象**：localhost:8080 显示成别的项目页面。**根因**：8080 被其他 dev server 占用（如 clipbench）。**正确做法**：`lsof -i :8080` 查占用进程并关掉，而非改端口。

### 3.5 推荐开发流程
1. 改 `app.py` 或前端文件 → 2. `Ctrl+C` 停服再 `./start.sh` 重启（或靠 Debug 热重载）→ 3. 浏览器实际跑一遍目标功能 → 4. 确认无控制台报错与后端 500 → 5. 展示改动摘要，等用户确认再 `git commit`（不要主动提交）。

### 3.6 Debug 排查顺序
- 看 Flask 终端日志（路由 + 500 traceback）→ 看浏览器 Network/Console → 复现用 `curl -X POST` 直接打接口 → 检查 `uploads/`/`outputs/` 是否生成文件。
- 端口问题：`lsof -i :8080`。依赖问题：`source venv/bin/activate && pip list | grep -i flask,pymupdf`。

### 3.7 避免破坏已有功能
回归清单：上传多文件 → 压缩 → 转Word → 合并 → 拆分 → 水印（中文+英文+旋转+间距）→ 页面排序/删页。改 CSS 变量或 `.app` 宽度后，确认各弹窗（rotate/pageEdit/watermark）在 1440px 与窄屏都正常。

## 4. 文档索引
| 文档 | 路径 | 用途 | 重要度 | 何时查看 |
|------|------|------|--------|----------|
| README | `README.md` | 功能列表与人眼使用说明 | 🟡常用 | 了解功能范围/给用户看 |
| 本文件 | `AGENTS.md` | AI 改代码的操作手册 | 🔴必读 | 任何代码改动前 |
| 依赖 | `requirements.txt` | Python 依赖与版本 | 🟢参考 | 加依赖/环境出问题 |

快捷路由：功能说明 → README；接口/坑位 → 本文件第 3 节；环境/启动 → `start.sh`+README。

## 5. 当前项目状态
- 5.1 已完成：上传(多文件)、压缩、转Word、提取图片(ZIP)、合并、拆分(ZIP)、提取文字(TXT)、转图片(PNG 200DPI)、旋转、页面排序、删页、文字水印(中文CJK字体/任意角度归整/间距/透明度/字号/颜色)、413 友好提示、favicon、一键启动脚本 `start.sh`、页面宽度 1440px。
- 5.2 开发中：无。
- 5.3 未完成计划：无明确规划。
- 5.4 技术债务：`app.py` 单文件承载所有路由与处理逻辑（~770 行），后续可按功能拆分 blueprint；前端无构建/无类型检查。
- 5.5 已知问题：PDF转Word 依赖 pdf2docx，复杂排版可能失真；大文件处理消耗内存，受 300MB 上限与本地内存限制。
- 5.6 后续规划：未定。

## 6. 变更记录（本文件）
- 2026-09-14：初版生成。覆盖架构、11 个 API 路由、水印 CJK/旋转/间距约束、300MB 上传上限与 413、venv/端口冲突等真实踩坑、1440px 宽度约束。
