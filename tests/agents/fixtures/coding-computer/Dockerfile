FROM sentinel/agent-workspace:base
USER root
COPY fake-cli /usr/local/bin/claude
RUN chmod 755 /usr/local/bin/claude && ln -s /usr/local/bin/claude /usr/local/bin/codex
USER 10001:10001
