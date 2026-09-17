FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_ADMIN_URL=http://localhost:4300
ARG VITE_STOREFRONT_URL=http://localhost:4301
ENV VITE_ADMIN_URL=$VITE_ADMIN_URL VITE_STOREFRONT_URL=$VITE_STOREFRONT_URL
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4300
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
USER node
EXPOSE 4300
CMD ["npm", "start"]
