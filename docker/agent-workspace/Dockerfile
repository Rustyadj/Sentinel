# Sentinel agent workspace base image.
#
# One durable "computer" per agent. Deliberately unprivileged: the container is
# started with --cap-drop ALL, --security-opt no-new-privileges and a non-root
# user, and the Docker socket is never mounted inside it.
FROM debian:bookworm-slim

ARG WORKSPACE_UID=10001
ARG WORKSPACE_GID=10001
ARG NODE_MAJOR=22

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    HOME=/workspace \
    PNPM_HOME=/workspace/.pnpm \
    PATH=/workspace/.local/bin:/workspace/.pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git openssh-client gnupg jq unzip zip \
      python3 python3-pip python3-venv build-essential ripgrep less procps coreutils findutils tar gzip \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@10 \
    && rm -rf /var/lib/apt/lists/*

# Credentials are injected per-exec by Sentinel and read from the environment.
# Nothing is ever written into the image or the workspace volume.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'case "$1" in' \
      '  *Username*) printf "%s\n" "${SENTINEL_GIT_USERNAME}" ;;' \
      '  *Password*) printf "%s\n" "${SENTINEL_GIT_TOKEN}" ;;' \
      'esac' \
    > /usr/local/bin/sentinel-git-askpass \
    && chmod 0755 /usr/local/bin/sentinel-git-askpass

RUN groupadd -g ${WORKSPACE_GID} sentinel \
    && useradd -u ${WORKSPACE_UID} -g ${WORKSPACE_GID} -d /workspace -s /bin/bash sentinel \
    && mkdir -p /workspace && chown ${WORKSPACE_UID}:${WORKSPACE_GID} /workspace

USER ${WORKSPACE_UID}:${WORKSPACE_GID}
WORKDIR /workspace
CMD ["sleep", "infinity"]
