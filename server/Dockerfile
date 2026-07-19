FROM node:22-alpine AS build
WORKDIR /app
RUN printf '%s\n' '{"name":"brank","private":true,"workspaces":["sdk","server"]}' > package.json
COPY sdk/package.json sdk/
COPY server/package.json server/
RUN npm install
COPY sdk sdk
COPY server server
RUN npm run build -w @brank/llm-logger && npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN printf '%s\n' '{"name":"brank","private":true,"workspaces":["sdk","server"]}' > package.json
COPY sdk/package.json sdk/
COPY server/package.json server/
RUN npm install --omit=dev
COPY --from=build /app/sdk/dist sdk/dist
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
