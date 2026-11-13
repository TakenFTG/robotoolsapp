# VEXAUS Judging, self-hosted.
#
# Three stages, because the two hard parts pull in opposite directions.
#
#   builder  compiles the web client and bundles the server. Needs the whole toolchain.
#   native   compiles better-sqlite3. Needs a C++ toolchain, but almost nothing else.
#   runner   holds the results and nothing else.
#
# better-sqlite3 is built in its own stage rather than installed in the runner because the
# runner is a slim image with no compiler. It publishes prebuilt binaries for common
# platforms, but relying on that means the build silently breaks the first time it runs on
# a platform without one. Compiling in `native` against the same Node major and the same
# Debian release as the runner makes that a non-question.
#
# The Node version is pinned to the patch, not just the major, in all three stages and in
# docker/ci.Dockerfile. A floating `node:22-bookworm` tag is whatever the build host last
# pulled, and nothing here passes --pull, so a security release only reached the image if
# someone remembered to refresh the cache. Pinned, the version in the image is the version
# in this file. 22.23.4 is the October 2026 security release (Brotli, dns.resolve and TLS
# hostname-verification CVEs). Bump all four FROM lines together.

# ---------------------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------------------
FROM node:22.23.4-bookworm AS builder
WORKDIR /app

# `bun install` compiles better-sqlite3 here even though only the native stage's copy is
# kept, and that compile needs python3 and a C++ compiler. Stated rather than assumed:
# the base image happens to carry a compiler, but not necessarily an interpreter.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Bun, because bun.lock is the lockfile this repo actually maintains. Installing with npm
# here would ignore it and resolve fresh versions, so CI could build something that never
# existed on a developer's machine.
#
# node-gyp comes along explicitly. npm puts its own bundled copy on PATH when it runs a
# lifecycle script; bun does not, so better-sqlite3's `node-gyp rebuild` fails with
# "command not found" on an image that otherwise has everything it needs.
RUN npm install --global bun@1 node-gyp

COPY package.json bun.lock ./
COPY protocol/package.json protocol/
COPY wrpc/package.json wrpc/
COPY web/package.json web/
COPY worker/package.json worker/

# --frozen-lockfile fails rather than silently updating bun.lock. If this errors, run
# `bun install` locally and commit the result; the lockfile is out of date.
RUN bun install --frozen-lockfile

COPY . .
RUN bun run --filter @robotools.app/web build \
 && bun run --filter @robotools.app/worker build

# ---------------------------------------------------------------------------------------
# native
# ---------------------------------------------------------------------------------------
FROM node:22.23.4-bookworm AS native
WORKDIR /deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# The server bundle leaves three dependencies external: the native SQLite driver, ws, and
# nodemailer. Their versions are read out of worker/package.json rather than repeated
# here, so there is only one place to bump them.
COPY worker/package.json ./worker-package.json
RUN node -e "\
	const p = require('./worker-package.json'); \
	require('fs').writeFileSync('package.json', JSON.stringify({ \
		name: 'vexaus-judging-server', \
		private: true, \
		type: 'module', \
		dependencies: { \
			'better-sqlite3': p.dependencies['better-sqlite3'], \
			ws: p.dependencies.ws, \
			nodemailer: p.dependencies.nodemailer \
		} \
	}, null, 2) + '\n'); \
" \
 && rm worker-package.json \
 && npm install --omit=dev --no-audit --no-fund --build-from-source better-sqlite3 \
 && npm cache clean --force

# ---------------------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------------------
FROM node:22.23.4-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# The bundle is ESM, so "type": "module" has to be present next to it.
COPY --from=native /deps/package.json ./package.json
COPY --from=native /deps/node_modules ./node_modules

COPY --from=builder /app/worker/dist ./dist
# Migrations are read from disk at startup, so they ship alongside the bundle. The lookup
# walks up from the bundle's own directory, which finds /app/drizzle from /app/dist.
COPY --from=builder /app/worker/drizzle ./drizzle
COPY --from=builder /app/web/build ./web-build

# GPL-3.0: the licence travels with the binary.
COPY --from=builder /app/LICENSE ./LICENSE

# The release this image was built from. CI passes --build-arg APP_VERSION=$CI_COMMIT_TAG;
# a hand-built image keeps the default, because a locally built image genuinely has no
# release identity and inventing one would make the Preferences dialog lie.
ARG APP_VERSION=dev

ENV PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web-build \
    APP_VERSION=${APP_VERSION}

# Runs as the unprivileged `node` user (uid 1000) that the base image already provides.
# A bind-mounted data directory must be owned by that uid on the host — see
# docs/self-hosting.md. Creating and chowning it here is what makes a *named* volume
# inherit the right ownership.
RUN mkdir -p /data && chown -R node:node /data
USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
