-- CreateTable
CREATE TABLE "InstallBlock" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstallBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdminAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "details" JSONB NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuperAdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallBlock_kind_subjectId_key" ON "InstallBlock"("kind", "subjectId");

-- CreateIndex
CREATE INDEX "InstallBlock_kind_createdAt_idx" ON "InstallBlock"("kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SuperAdminAudit_createdAt_idx" ON "SuperAdminAudit"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "SuperAdminAudit_subjectType_subjectId_createdAt_idx" ON "SuperAdminAudit"("subjectType", "subjectId", "createdAt" DESC);

-- Defence in depth: the API validates the same rules.
ALTER TABLE "InstallBlock"
ADD CONSTRAINT "InstallBlock_kind_check" CHECK ("kind" IN ('USER', 'GUILD')),
ADD CONSTRAINT "InstallBlock_subjectId_check" CHECK ("subjectId" ~ '^[0-9]{17,20}$'),
ADD CONSTRAINT "InstallBlock_reason_length_check" CHECK ("reason" IS NULL OR char_length("reason") <= 500);
