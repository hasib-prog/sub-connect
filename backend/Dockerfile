FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate
CMD ["node", "-e", "const express = require('express'); const app = express(); app.get('/health', (req, res) => res.json({status:'ok'})); app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('Server running on port ' + (process.env.PORT || 8080)));"]
