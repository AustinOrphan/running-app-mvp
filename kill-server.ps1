# PowerShell script to kill processes using port 3001
Write-Host "🔍 Searching for processes using port 3001..." -ForegroundColor Yellow

try {
    # Find processes using port 3001
    $processes = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object OwningProcess -Unique
    
    if ($processes) {
        Write-Host "📋 Found processes using port 3001:" -ForegroundColor Green
        foreach ($proc in $processes) {
            $processInfo = Get-Process -Id $proc.OwningProcess -ErrorAction SilentlyContinue
            if ($processInfo) {
                Write-Host "  - PID: $($proc.OwningProcess) - Name: $($processInfo.ProcessName)" -ForegroundColor Cyan
                Stop-Process -Id $proc.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-Host "    ✅ Killed process $($proc.OwningProcess)" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "ℹ️  No processes found using port 3001" -ForegroundColor Blue
    }
    
    # Also kill any node/tsx processes
    Write-Host "🔍 Checking for Node.js/TSX processes..." -ForegroundColor Yellow
    $nodeProcesses = Get-Process -Name "node", "tsx" -ErrorAction SilentlyContinue
    if ($nodeProcesses) {
        $nodeProcesses | ForEach-Object {
            Write-Host "  - Killing $($_.ProcessName) (PID: $($_.Id))" -ForegroundColor Cyan
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "✅ Killed Node.js/TSX processes" -ForegroundColor Green
    } else {
        Write-Host "ℹ️  No Node.js/TSX processes found" -ForegroundColor Blue
    }
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "🎉 Done! Port 3001 should now be available." -ForegroundColor Green
Write-Host "💡 You can now start your server with: npm run dev" -ForegroundColor Yellow
