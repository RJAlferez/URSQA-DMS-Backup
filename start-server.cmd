@echo off
cd C:\Dev\URS-DMS\server
set NODE_ENV=development
set PORT=4000
npx tsx watch src/server.ts