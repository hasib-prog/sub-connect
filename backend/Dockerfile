FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install
RUN npm install -g ts-node typescript
COPY . .
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && ts-node --transpile-only --esModuleInterop src/server.ts"]
