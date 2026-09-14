#!/bin/bash
# 一键启动 PDF 处理服务
cd "$(dirname "$0")"

# 检查虚拟环境是否存在，不存在则创建并安装依赖
if [ ! -d "venv" ]; then
    echo "未检测到虚拟环境，正在创建..."
    python3 -m venv venv
    ./venv/bin/pip install -r requirements.txt
fi

# 启动服务
./venv/bin/python3 app.py
