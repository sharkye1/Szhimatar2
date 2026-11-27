$ErrorActionPreference = 'Stop'
$source = $env:SZHIMATAR_UPDATE_SOURCE
$target = $env:SZHIMATAR_UPDATE_DESTINATION
$original = Get-Process -Id ([int]$env:SZHIMATAR_UPDATE_PID) -ErrorAction SilentlyContinue
try {
    if ($original -and -not $original.WaitForExit(15000)) { exit 1 }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -ne $env:SZHIMATAR_UPDATE_HASH) {
        throw 'The staged update changed before installation'
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ($true) {
        try {
            [System.IO.File]::Replace($source, $target, [NullString]::Value)
            break
        } catch [System.IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) { throw }
            Start-Sleep -Milliseconds 400
        }
    }
} finally {
    Remove-Item -LiteralPath $source -ErrorAction SilentlyContinue
    if (-not $original -or $original.HasExited) { Start-Process -FilePath $target }
}
