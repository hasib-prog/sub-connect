FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN node -e "require('./dist/server.js')" 2>&1 || true
