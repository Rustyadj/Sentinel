-- CreateTable
CREATE TABLE "task_execution_records" (
    "id" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "success" BOOLEAN NOT NULL,
    "reviewCycles" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_execution_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_execution_records_agentId_success_idx" ON "task_execution_records"("agentId", "success");

-- CreateIndex
CREATE INDEX "task_execution_records_chatRoomId_idx" ON "task_execution_records"("chatRoomId");

-- AddForeignKey
ALTER TABLE "task_execution_records" ADD CONSTRAINT "task_execution_records_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_execution_records" ADD CONSTRAINT "task_execution_records_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
