FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install --prefer-offline --no-audit --no-fund
COPY . .
RUN npx prisma generate
