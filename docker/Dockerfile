FROM grafana/k6:latest

# 设置工作目录
WORKDIR /app

# 安装必要的工具
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 安装Python依赖
RUN pip3 install \
    pandas \
    matplotlib \
    jinja2

# 复制项目文件
COPY . /app

# 创建目录结构
RUN mkdir -p /app/reports \
    && mkdir -p /app/logs \
    && mkdir -p /app/data

# 设置环境变量
ENV K6_WEB_DASHBOARD=true
ENV K6_WEB_DASHBOARD_EXPORT=report.html
ENV K6_OUT=json=/app/reports/output.json

# 设置执行权限
RUN chmod +x /app/scripts/run.sh

# 设置默认命令
CMD ["/app/scripts/run.sh", "--help"]
