FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY app.js server.js ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
