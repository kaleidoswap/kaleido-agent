FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY skills ./skills
COPY scripts ./scripts
COPY agent.config.json ./agent.config.json
COPY tasks.json ./tasks.json

RUN pnpm run build:agent

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-venv tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.6.9 /uv /uvx /usr/local/bin/
RUN uv tool install --python python3 nanobot-ai==0.1.4.post5

WORKDIR /app/kaleidoagent

ENV NODE_ENV=production
ENV NANOBOT_BIN=/root/.local/bin/nanobot
ENV AGENT_HOST=0.0.0.0
ENV KALEIDOAGENT_STATE_DIR=/var/lib/kaleidoagent
ENV KALEIDOAGENT_SKILLS_DIR=/app/kaleidoagent/skills
ENV CONFIG_PATH=/var/lib/kaleidoagent/agent.config.json
ENV TASKS_PATH=/var/lib/kaleidoagent/tasks.json
ENV PATH="/root/.local/bin:${PATH}"

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/skills ./skills
COPY --from=build /app/agent.config.json ./defaults/agent.config.json
COPY --from=build /app/tasks.json ./defaults/tasks.json
COPY --from=build /app/scripts/container-entrypoint.sh /usr/local/bin/container-entrypoint.sh

RUN chmod +x /usr/local/bin/container-entrypoint.sh

VOLUME ["/var/lib/kaleidoagent"]

EXPOSE 4242

ENTRYPOINT ["tini", "--", "/usr/local/bin/container-entrypoint.sh"]
