FROM node:24-bookworm AS deps

WORKDIR /app

COPY .yarn ./.yarn
COPY yarn.lock package.json .yarnrc.yml tsconfig.json ./
COPY packages/finance-engine/package.json packages/finance-engine/package.json

RUN yarn install --immutable

FROM deps AS builder

WORKDIR /app

COPY packages/finance-engine ./packages/finance-engine

RUN yarn workspace @actualforge/finance-engine build
RUN yarn workspaces focus @actualforge/finance-engine --production

FROM node:24-bookworm-slim AS prod

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ARG USERNAME=finance
ARG USER_UID=1001
ARG USER_GID=1001

RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home ${USERNAME} \
    && mkdir -p /data \
    && chown -R ${USERNAME}:${USERNAME} /data

WORKDIR /app

ENV NODE_ENV=production
ENV FINANCE_ENGINE_HOST=0.0.0.0
ENV FINANCE_ENGINE_PORT=5010
ENV FINANCE_ENGINE_DATA_DIR=/data

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/finance-engine/package.json ./package.json
COPY --from=builder /app/packages/finance-engine/build ./build

USER ${USERNAME}

EXPOSE 5010
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5010/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "build/index.js"]
