FROM node:24-bookworm AS deps

# Install required packages
RUN apt-get update && apt-get install -y openssl

WORKDIR /app

# Keep the complete workspace graph available during dependency resolution.
# ActualForge adds its own workspaces and several upstream packages reference
# sibling workspaces through the workspace: protocol.
COPY .yarn ./.yarn
COPY yarn.lock package.json .yarnrc.yml tsconfig.json lage.config.js ./
COPY packages/ ./packages/

COPY ./bin/package-browser ./bin/package-browser

RUN yarn install --immutable

FROM deps AS builder

WORKDIR /app

# Increase memory limit for the build process to 8GB
ENV NODE_OPTIONS=--max_old_space_size=8192

# lage's task hasher invokes `git ls-tree HEAD` during initialization, so it
# needs a git repo even when individual targets disable caching. .dockerignore
# omits the real .git, so seed a throwaway repo with a single commit here.
RUN git -c init.defaultBranch=master init -q \
    && git -c user.email=build@docker -c user.name=docker-build add -A \
    && git -c user.email=build@docker -c user.name=docker-build commit -qm build

RUN yarn build:server

# Focus the workspaces in production mode (including @actual-app/web you just built)
RUN yarn workspaces focus @actual-app/sync-server --production

# Remove symbolic links for @actual-app/web and @actual-app/sync-server
RUN rm -rf ./node_modules/@actual-app/web ./node_modules/@actual-app/sync-server

# Copy in the @actual-app/web artifacts manually, so we don't need the entire packages folder
COPY ./packages/desktop-client/package.json ./node_modules/@actual-app/web/package.json
RUN cp -r ./packages/desktop-client/build ./node_modules/@actual-app/web/build

FROM node:24-bookworm-slim AS prod

# Minimal runtime dependencies
RUN apt-get update && apt-get install -y tini && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Create a non-root user
ARG USERNAME=actual
ARG USER_UID=1001
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && mkdir /data && chown -R ${USERNAME}:${USERNAME} /data

WORKDIR /app
ENV NODE_ENV=production

# Pull in only the necessary artifacts (built node_modules, server files, etc.)
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/sync-server/package.json ./
COPY --from=builder /app/packages/sync-server/build ./build

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
EXPOSE 5006
CMD ["node", "build/app.js"]
