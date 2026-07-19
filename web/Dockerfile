FROM node:22-alpine AS build
WORKDIR /app
RUN printf '%s\n' '{"name":"brank","private":true,"workspaces":["web"]}' > package.json
COPY web/package.json web/
RUN npm install
COPY web web
RUN npm run build -w web

FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
