
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./

RUN npm install

RUN npm install -g ts-node

COPY . .

RUN npx prisma generate

EXPOSE 8080

CMD ["ts-node", "--esModuleInterop", "src/server.ts"]

