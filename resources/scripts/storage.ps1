# Optikax - unidades, juegos instalados y TRIM (solo lectura).
# Entrada: JSON por stdin (vacio). Salida: {"result":{volumes, games, trimNtfs}}.
# IMPORTANTE: ASCII puro (ver worker.ps1).

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[void][Console]::In.ReadToEnd()

# ---------- Unidades: letra -> disco fisico (tipo y bus) ----------
$volumes = New-Object System.Collections.ArrayList
$systemLetter = $env:SystemDrive.Substring(0, 1).ToUpper()
try {
    $physical = @{}
    foreach ($pd in @(Get-PhysicalDisk)) { $physical[[string]$pd.DeviceId] = $pd }
    foreach ($part in @(Get-Partition | Where-Object { $_.DriveLetter })) {
        try {
            $letter = [string]$part.DriveLetter
            $vol = Get-Volume -DriveLetter $letter
            $pd = $physical[[string]$part.DiskNumber]
            $media = if ($pd) { [string]$pd.MediaType } else { 'Unspecified' }
            $bus = if ($pd) { [string]$pd.BusType } else { 'Unknown' }
            [void]$volumes.Add([ordered]@{
                letter     = $letter.ToUpper()
                label      = [string]$vol.FileSystemLabel
                fileSystem = [string]$vol.FileSystem
                sizeBytes  = [int64]$vol.Size
                freeBytes  = [int64]$vol.SizeRemaining
                mediaType  = $media
                busType    = $bus
                model      = if ($pd) { [string]$pd.FriendlyName } else { $null }
                isSystem   = ($letter.ToUpper() -eq $systemLetter)
            })
        } catch { }
    }
} catch { }

# ---------- Juegos instalados ----------
$games = New-Object System.Collections.ArrayList
# Entradas de Steam que no son juegos.
$notGames = 'Steamworks|Redistributable|Wallpaper Engine|SteamVR|Proton|Steam Linux Runtime|Soundtrack'

function Get-VdfValue([string]$text, [string]$key) {
    $m = [regex]::Match($text, '"' + $key + '"\s+"([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

try {
    $steamPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
    $libFile = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
    $libraries = @($steamPath)
    if (Test-Path $libFile) {
        $vdf = Get-Content $libFile -Raw
        foreach ($m in [regex]::Matches($vdf, '"path"\s+"([^"]+)"')) { $libraries += ($m.Groups[1].Value -replace '\\\\', '\') }
    }
    $seen = @{}
    foreach ($lib in ($libraries | Select-Object -Unique)) {
        $apps = Join-Path $lib 'steamapps'
        if (-not (Test-Path $apps)) { continue }
        foreach ($acf in @(Get-ChildItem $apps -Filter 'appmanifest_*.acf' -ErrorAction SilentlyContinue)) {
            $text = Get-Content $acf.FullName -Raw
            $name = Get-VdfValue $text 'name'
            $dir = Get-VdfValue $text 'installdir'
            if (-not $name -or $name -match $notGames) { continue }
            $full = Join-Path $apps (Join-Path 'common' $dir)
            if ($seen[$full.ToLower()]) { continue }
            $seen[$full.ToLower()] = $true
            $size = Get-VdfValue $text 'SizeOnDisk'
            [void]$games.Add([ordered]@{
                name      = $name
                store     = 'Steam'
                path      = $full
                sizeBytes = if ($size) { [int64]$size } else { 0 }
                letter    = $full.Substring(0, 1).ToUpper()
            })
        }
    }
} catch { }

try {
    $manifests = 'C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests'
    foreach ($item in @(Get-ChildItem $manifests -Filter '*.item' -ErrorAction SilentlyContinue)) {
        try {
            $j = Get-Content $item.FullName -Raw | ConvertFrom-Json
            if (-not $j.InstallLocation) { continue }
            [void]$games.Add([ordered]@{
                name      = [string]$j.DisplayName
                store     = 'Epic'
                path      = [string]$j.InstallLocation
                sizeBytes = [int64]$j.InstallSize
                letter    = ([string]$j.InstallLocation).Substring(0, 1).ToUpper()
            })
        } catch { }
    }
} catch { }

# ---------- TRIM (NTFS) ----------
# 0 = TRIM activo. Se lee del registro, que es donde lo guarda fsutil.
$trim = $null
try {
    $v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name DisableDeleteNotification -ErrorAction Stop).DisableDeleteNotification
    $trim = ([int]$v -eq 0)
} catch { $trim = $true }  # sin valor: Windows usa el predeterminado (activo)

$result = [ordered]@{ volumes = @($volumes); games = @($games); trimNtfs = $trim }
[Console]::Out.WriteLine((@{ result = $result } | ConvertTo-Json -Depth 6 -Compress))
