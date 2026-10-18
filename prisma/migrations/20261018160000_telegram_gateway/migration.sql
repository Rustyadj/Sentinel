-- CreateTable
CREATE TABLE "telegram_bots" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenEnvVar" TEXT NOT NULL,
    "webhookSecretEnvVar" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cutoverVerifiedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHealthAt" TIMESTAMP(3),
    "webhookHealth" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_access" (
    "id" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "telegram_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_conversations" (
    "id" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "id" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "replyToMessageId" TEXT,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "mediaPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaPreparedAt" TIMESTAMP(3),
    "chatRoomId" TEXT,
    "taskId" TEXT,
    "currentTaskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_deliveries" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'result',
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "telegramMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_key_key" ON "telegram_bots"("key");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_telegramBotId_key" ON "telegram_bots"("telegramBotId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_botId_key" ON "telegram_bots"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_access_telegramBotId_senderId_chatId_key" ON "telegram_access"("telegramBotId", "senderId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_conversations_chatRoomId_key" ON "telegram_conversations"("chatRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_conversations_telegramBotId_senderId_chatId_key" ON "telegram_conversations"("telegramBotId", "senderId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_taskId_key" ON "telegram_updates"("taskId");

-- CreateIndex
CREATE INDEX "telegram_updates_status_receivedAt_idx" ON "telegram_updates"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_telegramBotId_updateId_key" ON "telegram_updates"("telegramBotId", "updateId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_telegramBotId_chatId_messageId_key" ON "telegram_updates"("telegramBotId", "chatId", "messageId");

-- CreateIndex
CREATE INDEX "telegram_deliveries_status_nextAttemptAt_idx" ON "telegram_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_deliveries_updateId_kind_sequence_key" ON "telegram_deliveries"("updateId", "kind", "sequence");

-- AddForeignKey
ALTER TABLE "telegram_access" ADD CONSTRAINT "telegram_access_telegramBotId_fkey" FOREIGN KEY ("telegramBotId") REFERENCES "telegram_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_telegramBotId_fkey" FOREIGN KEY ("telegramBotId") REFERENCES "telegram_bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_telegramBotId_fkey" FOREIGN KEY ("telegramBotId") REFERENCES "telegram_bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "telegram_updates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The inbox may backlog messages, but only one may own a governed task per chat.
CREATE UNIQUE INDEX "telegram_updates_one_admitted" ON "telegram_updates" ("telegramBotId", "senderId", "chatId")
WHERE "status" = 'active' OR ("status" = 'pending' AND "taskId" IS NOT NULL);
CREATE UNIQUE INDEX "orchestration_runs_telegram_idempotency" ON "orchestration_runs" ("botId", "originKey", "idempotencyKey")
WHERE "idempotencyKey" LIKE 'telegram-%';
