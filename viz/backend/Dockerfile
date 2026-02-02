FROM node:18-alpine

WORKDIR /app

# 安装 k6
RUN apk add --no-cache curl && \
    curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz | tar -xz && \
    mv k6-v0.49.0-linux-amd64/k6 /usr/local/bin/k6 && \
    rm -rf k6-v0.49.0-linux-amd64

# 复制 package.json 并安装依赖
COPY package.json ./
RUN npm install

# 复制应用代码
COPY server.js ./

# 创建必要的目录（frontend 将通过 volume 挂载）
RUN mkdir -p /app/viz/frontend /app/viz/reports /app/viz/data /app/k6/tests

EXPOSE 8080

CMD ["node", "server.js"]
