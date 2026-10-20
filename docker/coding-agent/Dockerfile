# Build the existing workspace base first. No host homes or credentials copied.
ARG BASE_IMAGE=sentinel/agent-workspace:base
FROM ${BASE_IMAGE}
USER root
# Supply reviewed, exact versions at build time; no floating latest installs.
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
RUN test -n "$CLAUDE_CODE_VERSION" && test -n "$CODEX_VERSION" \
    && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force
USER 10001:10001
WORKDIR /workspace
