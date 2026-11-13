# Optikax - operaciones lentas de los ajustes (fuera del worker para no bloquearlo).
# Entrada: JSON por stdin con {"action":"..."}. Salida: {"result":...}.
# IMPORTANTE: ASCII puro (ver worker.ps1).

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8

$req = [Console]::In.ReadToEnd() | ConvertFrom-Json

function Emit($obj) {
    [Console]::Out.WriteLine((@{ result = $obj } | ConvertTo-Json -Depth 6 -Compress))
}

function Get-LatestRestorePoint {
    $rp = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue) | Sort-Object SequenceNumber | Select-Object -Last 1
    if (-not $rp) { return $null }
    $date = $null
    try { $date = $rp.ConvertToDateTime($rp.CreationTime).ToString('o') } catch { }
    return @{ sequence = [int]$rp.SequenceNumber; description = [string]$rp.Description; createdAt = $date }
}

switch ([string]$req.action) {

    # Datos que no estan en el registro: compresion de memoria y la tarjeta de red en uso.
    'env' {
        $compression = $null
        try { $compression = [bool](Get-MMAgent).MemoryCompression } catch { }

        $nic = $null
        try {
            $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
                Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
            $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction Stop
            $nic = @{ guid = [string]$adapter.InterfaceGuid; name = [string]$adapter.Name }
        } catch { }

        Emit @{ memoryCompression = $compression; nic = $nic }
    }

    'memoryCompression' {
        if ($req.enable) { Enable-MMAgent -MemoryCompression } else { Disable-MMAgent -MemoryCompression }
        Emit @{ memoryCompression = [bool](Get-MMAgent).MemoryCompression }
    }

    # No activa Proteccion del sistema si esta apagada: solo informa.
    'restorePoint' {
        $before = Get-LatestRestorePoint
        $status = 'creado'
        $detail = $null
        try {
            Checkpoint-Computer -Description 'Optikax' -RestorePointType MODIFY_SETTINGS -WarningAction SilentlyContinue
        }
        catch {
            $status = 'no_disponible'
            $detail = $_.Exception.Message
        }
        $after = Get-LatestRestorePoint
        if ($status -eq 'creado') {
            $isNew = $after -and (-not $before -or $after.sequence -ne $before.sequence)
            # Windows solo permite un punto cada 24 h: si no crea uno nuevo, ya hay uno reciente.
            if (-not $isNew) { $status = if ($after) { 'reciente' } else { 'no_disponible' } }
        }
        Emit @{ status = $status; detail = $detail; latest = $after }
    }

    default { throw "Accion desconocida: $($req.action)" }
}
