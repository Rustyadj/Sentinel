-- Telnyx telephony: calls, transcript turns, SMS/MMS, contacts.
--
-- Purely additive: four new tables, no changes to existing tables or data.

CREATE TABLE "phone_calls" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trust" TEXT NOT NULL DEFAULT 'trusted',
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "contactName" TEXT,
    "purpose" TEXT,
    "idempotencyKey" TEXT,
    "telnyxCallControlId" TEXT,
    "telnyxCallSessionId" TEXT,
    "roomId" TEXT,
    "liveSessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "endReason" TEXT,
    "summary" TEXT,
    "outcome" JSONB,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "phone_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_calls_telnyxCallControlId_key" ON "phone_calls"("telnyxCallControlId");
CREATE UNIQUE INDEX "phone_calls_userId_idempotencyKey_key" ON "phone_calls"("userId", "idempotencyKey");
CREATE INDEX "phone_calls_userId_startedAt_idx" ON "phone_calls"("userId", "startedAt");
CREATE INDEX "phone_calls_userId_agentId_idx" ON "phone_calls"("userId", "agentId");
CREATE INDEX "phone_calls_toNumber_idx" ON "phone_calls"("toNumber");

CREATE TABLE "phone_call_turns" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "offsetMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_call_turns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phone_call_turns_callId_createdAt_idx" ON "phone_call_turns"("callId", "createdAt");

ALTER TABLE "phone_call_turns" ADD CONSTRAINT "phone_call_turns_callId_fkey"
    FOREIGN KEY ("callId") REFERENCES "phone_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "phone_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telnyxMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "trust" TEXT NOT NULL DEFAULT 'trusted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_messages_telnyxMessageId_key" ON "phone_messages"("telnyxMessageId");
CREATE INDEX "phone_messages_userId_counterparty_createdAt_idx" ON "phone_messages"("userId", "counterparty", "createdAt");

CREATE TABLE "phone_contacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "callable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_contacts_userId_number_key" ON "phone_contacts"("userId", "number");
CREATE INDEX "phone_contacts_userId_name_idx" ON "phone_contacts"("userId", "name");
