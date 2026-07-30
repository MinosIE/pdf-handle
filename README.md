# PDF工具箱

本地 PDF 多功能处理工具，纯浏览器端操作，文件不会上传到任何服务器。

## 功能

| 功能 | 说明 |
|------|------|
| 压缩PDF | 减小文件体积，显示压缩率 |
| PDF转Word | 转换为可编辑的 .docx 文档 |
| 提取图片 | 导出 PDF 中所有嵌入图片，打包为 ZIP |
| 合并PDF | 多个 PDF 合并为一个文件 |
| 拆分PDF | 按页拆分为独立 PDF，打包为 ZIP |
| 提取文字 | 提取纯文本内容，输出 .txt |
| PDF转图片 | 每页渲染为高清 PNG 图片（200 DPI） |
| 旋转页面 | 支持 90° / 180° / 270° 旋转 |

## 技术栈

- 后端：Flask + PyMuPDF + pdf2docx
- 前端：原生 HTML / CSS / JavaScript（无需 Node.js）

## 快速开始

### 环境要求

- Python 3.9+

### 安装与运行

```bash
# 1. 创建虚拟环境
python3 -m venv venv

# 2. 激活虚拟环境
source venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动服务
python app.py

# 5. 打开浏览器访问 http://localhost:8080
```

### 关闭服务

在终端按 `Ctrl + C`，然后执行 `deactivate` 退出虚拟环境。

## 使用说明

1. **上传文件**：拖拽 PDF 到上传区域，或点击选择文件（支持多文件，单文件最大 100MB）
2. **选中文件**：点击文件卡片选中（紫色高亮），功能卡片自动激活
3. **选择功能**：点击功能卡片开始处理，处理完成后可下载结果
4. **合并模式**：上传 2 个以上文件后，点击「进入合并模式」可多选文件进行合并

## 项目结构

```
pdf-handle/
├── app.py                # Flask 后端
├── requirements.txt      # Python 依赖
├── README.md
├── templates/
│   └── index.html        # 前端页面
├── static/
│   ├── css/style.css     # 样式
│   └── js/main.js        # 交互逻辑
├── uploads/              # 上传文件暂存（2小时自动清理）
└── outputs/              # 处理结果输出
```

## 许可证

MIT
