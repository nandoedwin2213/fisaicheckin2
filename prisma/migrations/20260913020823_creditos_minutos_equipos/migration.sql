-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('SESIONES', 'CREDITOS', 'MINUTOS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttendanceResult" ADD VALUE 'SIN_CREDITOS';
ALTER TYPE "AttendanceResult" ADD VALUE 'EQUIPO_INACTIVO';

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "creditos" DECIMAL(10,2) NOT NULL DEFAULT 0,
ALTER COLUMN "sesiones" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "PatientPackage" ADD COLUMN     "creditosRestantes" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Terminal" ADD COLUMN     "equipmentId" TEXT;

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "billingMode" "BillingMode" NOT NULL,
    "costo" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "duracionSegundos" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "patientPackageId" TEXT,
    "inicioEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finEn" TIMESTAMP(3),
    "segundos" INTEGER,
    "creditosCobrados" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cerradoPorTope" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recharge" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "patientPackageId" TEXT NOT NULL,
    "sesiones" INTEGER NOT NULL,
    "creditos" DECIMAL(10,2) NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "registradoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usage_attendanceId_key" ON "Usage"("attendanceId");

-- CreateIndex
CREATE INDEX "Usage_patientId_inicioEn_idx" ON "Usage"("patientId", "inicioEn");

-- CreateIndex
CREATE INDEX "Usage_terminalId_finEn_idx" ON "Usage"("terminalId", "finEn");

-- CreateIndex
CREATE INDEX "Recharge_patientId_createdAt_idx" ON "Recharge"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_patientPackageId_fkey" FOREIGN KEY ("patientPackageId") REFERENCES "PatientPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recharge" ADD CONSTRAINT "Recharge_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recharge" ADD CONSTRAINT "Recharge_patientPackageId_fkey" FOREIGN KEY ("patientPackageId") REFERENCES "PatientPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
