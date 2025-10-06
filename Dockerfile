# Dockerfile
FROM node:18-alpine

# Install sldl
RUN apk add --no-cache wget unzip
RUN wget https://github.com/fiso64/slsk-batchdl/releases/latest/download/sldl-linux-x64.zip \
    && unzip sldl-linux-x64.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/sldl \
    && rm sldl-linux-x64.zip

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

RUN mkdir -p /downloads /config

EXPOSE 3000

CMD ["node", "dist/main"]