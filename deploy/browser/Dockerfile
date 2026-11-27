FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
# Match the browser binary image and the Playwright client in package-lock.json.
RUN npm install --no-audit --no-fund --ignore-scripts --no-package-lock playwright-core@1.61.1
COPY deploy/browser/server.mjs ./
USER pwuser
CMD ["node", "server.mjs"]
