FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npx tsc --skipLibCheck --noEmit false --outDir dist --target ES2022 --module commonjs --esModuleInterop true --resolveJsonModule true || true
