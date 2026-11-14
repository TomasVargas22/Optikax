# Optikax - foto del estado que tocan los ajustes (solo desarrollo; NO se empaqueta).
# Lo usa src/main/verify.ts para comparar antes / despues de aplicar y revertir.
# Lee el sistema por su cuenta, sin pasar por el worker de la app, para que la
# comparacion no dependa del mismo codigo que se esta verificando.
#
# Entrada: JSON por stdin {"action":"snapshot"} o {"action":"export","dir":"..."}.
# Salida: {"result":...}. ASCII puro.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json

# Claves que toca el catalogo (src/main/tweaks/catalog.ts). Se guardan TODOS sus valores,
# no solo los del ajuste, para detectar cualquier escritura de mas.
$keys = @(
    'HKCU\Software\Microsoft\GameBar',
    'HKCU\System\GameConfigStore',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR',
    'HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers',
    'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile',
    'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games',
    'HKLM\SYSTEM\CurrentControlSet\Control\PriorityControl',
    'HKCU\Software\Microsoft\DirectX\UserGpuPreferences',
    'HKCU\Control Panel\Mouse',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize',
    'HKLM\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling'
)
$tcpip = 'HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces'

function Open-Key([string]$path) {
    $i = $path.IndexOf('\')
    $root = if ($path.Substring(0, $i) -eq 'HKLM') { [Microsoft.Win32.Registry]::LocalMachine } else { [Microsoft.Win32.Registry]::CurrentUser }
    return $root.OpenSubKey($path.Substring($i + 1), $false)
}

function Format-Value($key, [string]$name) {
    $kind = $key.GetValueKind($name).ToString()
    $v = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $text = switch ($kind) {
        'DWord'       { [string][BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$v), 0) }
        'QWord'       { [string][BitConverter]::ToUInt64([BitConverter]::GetBytes([long]$v), 0) }
        'Binary'      { [BitConverter]::ToString([byte[]]$v) }
        'MultiString' { (@($v) -join '|') }
        default       { [string]$v }
    }
    return "${kind}:$text"
}

# Valores que Windows reescribe solo (renovacion DHCP cada pocos minutos): darian falsos fallos.
$volatile = '^(Dhcp.*|Lease.*|T1|T2)$'

function Snapshot-Key([string]$path) {
    $key = Open-Key $path
    if (-not $key) { return @{ exists = $false; values = @{} } }
    try {
        $values = [ordered]@{}
        foreach ($n in ($key.GetValueNames() | Sort-Object)) {
            if ($path.StartsWith($tcpip) -and $n -match $volatile) { continue }
            $values[$n] = Format-Value $key $n
        }
        return @{ exists = $true; values = $values }
    }
    finally { $key.Close() }
}

Add-Type -Namespace OptikaxVerify -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SystemParametersInfo(uint action, uint param, int[] vparam, uint winIni);
'@

function Get-LiveMouse {
    $m = New-Object int[] 3
    [void][OptikaxVerify.Native]::SystemParametersInfo(0x0003, 0, $m, 0)  # SPI_GETMOUSE
    return ($m -join ',')
}

$guid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
function Get-Guids([string]$text) { return @([regex]::Matches($text, $guid) | ForEach-Object { $_.Value.ToLower() }) }

switch ([string]$req.action) {
    'snapshot' {
        $reg = [ordered]@{}
        foreach ($k in $keys) { $reg[$k] = Snapshot-Key $k }
        $ifaces = Open-Key $tcpip
        foreach ($sub in ($ifaces.GetSubKeyNames() | Sort-Object)) { $reg["$tcpip\$sub"] = Snapshot-Key "$tcpip\$sub" }
        $ifaces.Close()

        $compression = $null
        try { $compression = [bool](Get-MMAgent).MemoryCompression } catch { }

        $result = [ordered]@{
            registry          = $reg
            powerActive       = (Get-Guids (powercfg /getactivescheme | Out-String) | Select-Object -First 1)
            powerSchemes      = @(Get-Guids (powercfg /list | Out-String) | Sort-Object -Unique)
            memoryCompression = $compression
            liveMouse         = Get-LiveMouse
        }
        [Console]::Out.WriteLine((@{ result = $result } | ConvertTo-Json -Depth 8 -Compress))
    }

    # Respaldo extra en .reg de cada clave, por si hiciera falta restaurar a mano.
    'export' {
        $dir = [string]$req.dir
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $files = @()
        $i = 0
        foreach ($k in ($keys + $tcpip)) {
            if (-not (Open-Key $k)) { continue }
            $i++
            $file = Join-Path $dir ('{0:D2}-{1}.reg' -f $i, ($k.Split('\')[-1] -replace '[^A-Za-z0-9]', ''))
            & reg.exe export $k $file /y | Out-Null
            if ($LASTEXITCODE -eq 0) { $files += $file }
        }
        & powercfg.exe /list | Out-File -Encoding ascii (Join-Path $dir 'powercfg-list.txt')
        [Console]::Out.WriteLine((@{ result = @{ files = $files } } | ConvertTo-Json -Depth 4 -Compress))
    }

    default { throw "Accion desconocida: $($req.action)" }
}
