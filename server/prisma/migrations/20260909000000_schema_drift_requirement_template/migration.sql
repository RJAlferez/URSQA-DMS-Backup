-- Repair schema drift: schema.prisma declares AaccupTask.requirementTemplateId
-- but no migration ever created it (dev DBs received it via `prisma db push`).
-- Fresh databases built only from migrations therefore 500 on AaccupTask queries.
-- Idempotent: safe on both migration-built and push-drifted databases.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'aaccup_tasks' AND column_name = 'requirementTemplateId'
    ) THEN
        ALTER TABLE "aaccup_tasks" ADD COLUMN "requirementTemplateId" TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "aaccup_tasks_requirementTemplateId_idx"
    ON "aaccup_tasks"("requirementTemplateId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'aaccup_tasks_requirementTemplateId_fkey'
    ) THEN
        ALTER TABLE "aaccup_tasks"
            ADD CONSTRAINT "aaccup_tasks_requirementTemplateId_fkey"
            FOREIGN KEY ("requirementTemplateId")
            REFERENCES "requirement_templates"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
