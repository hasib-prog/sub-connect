
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./

RUN npm install

RUN npm install -g ts-node

COPY . .

RUN npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && ts-node --esModuleInterop src/server.ts"]

