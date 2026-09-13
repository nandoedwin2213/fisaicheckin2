-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('REHAB', 'SARCO_FORCE', 'EVALUACION');

-- CreateEnum
CREATE TYPE "AttendanceResult" AS ENUM ('OK', 'SIN_PAQUETE', 'PAQUETE_VENCIDO', 'TARJETA_DESCONOCIDA', 'TARJETA_SIN_PACIENTE', 'TARJETA_INACTIVA', 'DUPLICADO', 'PACIENTE_DESCONOCIDO');

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "cedula" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "patientId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sesiones" INTEGER NOT NULL,
    "vigenciaDias" INTEGER NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientPackage" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "sesionesRestantes" INTEGER NOT NULL,
    "compradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoVisto" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "cardId" TEXT,
    "patientId" TEXT,
    "terminalId" TEXT NOT NULL,
    "patientPackageId" TEXT,
    "uidLeido" TEXT,
    "resultado" "AttendanceResult" NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "registradoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_cedula_key" ON "Patient"("cedula");

-- CreateIndex
CREATE UNIQUE INDEX "Card_uid_key" ON "Card"("uid");

-- CreateIndex
CREATE INDEX "Card_patientId_idx" ON "Card"("patientId");

-- CreateIndex
CREATE INDEX "PatientPackage_patientId_venceEn_idx" ON "PatientPackage"("patientId", "venceEn");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_apiKeyHash_key" ON "Terminal"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Attendance_terminalId_createdAt_idx" ON "Attendance"("terminalId", "createdAt");

-- CreateIndex
CREATE INDEX "Attendance_patientId_createdAt_idx" ON "Attendance"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "Attendance_cardId_createdAt_idx" ON "Attendance"("cardId", "createdAt");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPackage" ADD CONSTRAINT "PatientPackage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPackage" ADD CONSTRAINT "PatientPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_patientPackageId_fkey" FOREIGN KEY ("patientPackageId") REFERENCES "PatientPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
