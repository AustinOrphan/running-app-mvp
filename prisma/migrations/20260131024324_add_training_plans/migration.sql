/*
  Warnings:

  - You are about to drop the `LocationHeatmap` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RunAnalytics` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RunDetail` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RunTendency` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "LocationHeatmap";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RunAnalytics";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RunDetail";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RunTendency";
PRAGMA foreign_keys=on;
