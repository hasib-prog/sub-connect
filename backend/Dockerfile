FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate
RUN npx tsc --skipLibCheck --outDir dist --target ES2022 --module commonjs --esModuleInterop true --resolveJsonModule true --strict false 2>&1 || true
RUN ls -la dist/ && echo "dist folder contents listed above"
