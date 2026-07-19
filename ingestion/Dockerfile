FROM node:22-alpine AS build
WORKDIR /app
RUN printf '%s\n' '{"name":"brank","private":true,"workspaces":["sdk","ingestion"]}' > package.json
COPY sdk/package.json sdk/
COPY ingestion/package.json ingestion/
RUN npm install
COPY sdk sdk
COPY ingestion ingestion
RUN npm run build -w @brank/llm-logger && npm run build -w ingestion

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN printf '%s\n' '{"name":"brank","private":true,"workspaces":["sdk","ingestion"]}' > package.json
COPY sdk/package.json sdk/
COPY ingestion/package.json ingestion/
RUN npm install --omit=dev
COPY --from=build /app/sdk/dist sdk/dist
COPY --from=build /app/ingestion/dist ingestion/dist
WORKDIR /app/ingestion
EXPOSE 4001
CMD ["node", "dist/index.js"]
