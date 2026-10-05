param([switch]$LoadEnv)

# Load .env if present
if ($LoadEnv) {
    $env:NODE_ENV = "development"
    $env:PORT = "4000"
    # .env file variables would need dotenv - skip for simplicity
}

Write-Host "Starting URS-DMS server..."
Write-Host "NODE_ENV: $env:NODE_ENV"
Write-Host "PORT: $env:PORT"

cd C:\Dev\URS-DMS\server
& "C:\Program Files\nodejs\node.exe" -e "
const { execSync } = require('child_process');
try {
  execSync('npx tsx watch src/server.ts', { 
    cwd: 'C:\\\\Dev\\\\URS-DMS\\\\server', 
    stdio: 'inherit', 
    env: { ...process.env, NODE_ENV: 'development', PORT: '4000' } 
  });
} catch (e) {
  console.error('Server failed to start:', e.message);
  process.exit(1);
}
"