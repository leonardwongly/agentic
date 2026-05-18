FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agents/package.json packages/agents/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/execution/package.json packages/execution/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/memory/package.json packages/memory/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/orchestrator/package.json packages/orchestrator/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/repository/package.json packages/repository/package.json
COPY packages/self-improvement-memory/package.json packages/self-improvement-memory/package.json
COPY packages/worker-runtime/package.json packages/worker-runtime/package.json
RUN npm ci

FROM deps AS build
ARG NODE_OPTIONS=--max-old-space-size=4096
ENV NODE_OPTIONS=${NODE_OPTIONS}
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_CACHE=/home/node/.npm
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/package-lock.json ./package-lock.json
COPY --chown=node:node --from=build /app/apps ./apps
COPY --chown=node:node --from=build /app/packages ./packages
COPY --chown=node:node --from=build /app/scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "const req=require('node:http').request({host:'127.0.0.1',port:Number(process.env.PORT||3000),path:'/api/health',timeout:4000},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});req.end();"
CMD ["npm", "run", "start:web:prod", "--", "--hostname", "0.0.0.0", "--port", "3000"]
