# Optikax - deteccion de hardware (solo lectura).
# Salida: lineas JSON. {"progress":N,"step":"..."} durante el escaneo y {"result":{...}} al final.
# IMPORTANTE: ASCII puro y C# 5 (ver worker.ps1).

$ErrorActionPreference = 'Stop'

# powercfg escribe en la codepage OEM: se lee antes de pasar la consola a UTF-8.
$powerRaw = ''
try { $powerRaw = (& powercfg.exe /getactivescheme 2>$null) -join ' ' } catch { }

$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8

$errors = New-Object System.Collections.Generic.List[string]

function Emit($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Depth 8 -Compress))
}
function Step([int]$n, [string]$name) {
    Emit @{ progress = $n; step = $name }
}
function Section([string]$name, [scriptblock]$body) {
    try { & $body } catch { $errors.Add("${name}: $($_.Exception.Message)"); $null }
}
function Clean($s) {
    if ($null -eq $s) { return $null }
    $t = ([string]$s).Trim()
    if ($t.Length -eq 0) { return $null }
    $t
}
function IsoDate($d) {
    if ($d -is [datetime]) { return $d.ToString('yyyy-MM-dd') }
    $null
}

# ---------- CPU ----------
Step 5 'cpu'
$cpu = Section 'cpu' {
    $c = Get-CimInstance Win32_Processor | Select-Object -First 1
    [ordered]@{
        name         = Clean $c.Name
        manufacturer = Clean $c.Manufacturer
        cores        = [int]$c.NumberOfCores
        threads      = [int]$c.NumberOfLogicalProcessors
        maxMHz       = [int]$c.MaxClockSpeed
    }
}

# ---------- GPU ----------
Step 20 'gpu'
$gpus = Section 'gpu' {
    $classKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
    $regAdapters = @(Get-ChildItem $classKey -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -match '^\d{4}$' } |
        ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue })

    @(Get-CimInstance Win32_VideoController | ForEach-Object {
        $v = $_
        # AdapterRAM es de 32 bits y se queda en 4 GB: la VRAM real esta en el registro.
        $reg = $regAdapters | Where-Object {
            $_.MatchingDeviceId -and $v.PNPDeviceID -and
            $v.PNPDeviceID.ToLower().StartsWith(([string]$_.MatchingDeviceId).ToLower())
        } | Select-Object -First 1
        if (-not $reg) { $reg = $regAdapters | Where-Object { $_.DriverDesc -eq $v.Name } | Select-Object -First 1 }

        $vram = $null
        if ($reg) { $vram = $reg.'HardwareInformation.qwMemorySize' }
        if (-not $vram -and $v.AdapterRAM) { $vram = [int64]$v.AdapterRAM }

        [ordered]@{
            name          = Clean $v.Name
            driverVersion = Clean $v.DriverVersion
            driverDate    = IsoDate $v.DriverDate
            vramBytes     = if ($vram) { [int64]$vram } else { $null }
            pnpId         = Clean $v.PNPDeviceID
        }
    })
}

# ---------- RAM ----------
Step 40 'ram'
$ram = Section 'ram' {
    $slots = 0
    Get-CimInstance Win32_PhysicalMemoryArray | ForEach-Object { $slots += [int]$_.MemoryDevices }
    $modules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
        [ordered]@{
            capacityBytes = [int64]$_.Capacity
            speedMHz      = [int]$_.Speed
            configuredMHz = [int]$_.ConfiguredClockSpeed
            manufacturer  = Clean $_.Manufacturer
            partNumber    = Clean $_.PartNumber
            slot          = Clean $_.DeviceLocator
            smbiosType    = [int]$_.SMBIOSMemoryType
        }
    })
    [ordered]@{ totalSlots = $slots; modules = $modules }
}

# ---------- Placa y BIOS ----------
Step 50 'placa'
$board = Section 'placa' {
    $b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
    $bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
    [ordered]@{
        manufacturer = Clean $b.Manufacturer
        product      = Clean $b.Product
        biosVersion  = Clean $bios.SMBIOSBIOSVersion
        biosDate     = IsoDate $bios.ReleaseDate
    }
}

# ---------- Discos ----------
Step 60 'discos'
$disks = Section 'discos' {
    $systemLetter = $env:SystemDrive.TrimEnd(':')
    $systemDisk = $null
    try { $systemDisk = (Get-Partition -DriveLetter $systemLetter -ErrorAction Stop).DiskNumber } catch { }
    @(Get-PhysicalDisk | ForEach-Object {
        [ordered]@{
            name      = Clean $_.FriendlyName
            mediaType = [string]$_.MediaType
            busType   = [string]$_.BusType
            sizeBytes = [int64]$_.Size
            isSystem  = ($null -ne $systemDisk -and [string]$_.DeviceId -eq [string]$systemDisk)
        }
    })
}
$systemVolume = Section 'volumen' {
    $v = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
    [ordered]@{ letter = $env:SystemDrive; sizeBytes = [int64]$v.Size; freeBytes = [int64]$v.FreeSpace }
}

# ---------- Pantallas ----------
Step 75 'pantallas'
$displays = Section 'pantallas' {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class OptikaxDisplays
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2;
        public int dmPanningWidth, dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplayDevices(string device, uint index, ref DISPLAY_DEVICE dd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE dm);

    static DEVMODE NewMode()
    {
        DEVMODE dm = new DEVMODE();
        dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        return dm;
    }

    // Una entrada por pantalla activa: "adaptador|ancho|alto|hz|hzMaximo|principal".
    public static string[] List()
    {
        List<string> result = new List<string>();
        for (uint i = 0; ; i++)
        {
            DISPLAY_DEVICE dd = new DISPLAY_DEVICE();
            dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
            if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
            if ((dd.StateFlags & 1) == 0) continue;  // no forma parte del escritorio

            DEVMODE cur = NewMode();
            if (!EnumDisplaySettings(dd.DeviceName, -1, ref cur)) continue;  // modo actual

            int maxHz = cur.dmDisplayFrequency;
            for (int m = 0; ; m++)
            {
                DEVMODE dm = NewMode();
                if (!EnumDisplaySettings(dd.DeviceName, m, ref dm)) break;
                if (dm.dmPelsWidth == cur.dmPelsWidth && dm.dmPelsHeight == cur.dmPelsHeight
                    && dm.dmDisplayFrequency > maxHz)
                    maxHz = dm.dmDisplayFrequency;
            }
            bool primary = (dd.StateFlags & 4) != 0;
            result.Add(dd.DeviceString + "|" + cur.dmPelsWidth + "|" + cur.dmPelsHeight + "|"
                + cur.dmDisplayFrequency + "|" + maxHz + "|" + (primary ? "1" : "0"));
        }
        return result.ToArray();
    }
}
'@
    @([OptikaxDisplays]::List() | ForEach-Object {
        $p = $_.Split('|')
        [ordered]@{
            adapter = $p[0]
            width   = [int]$p[1]
            height  = [int]$p[2]
            hz      = [int]$p[3]
            maxHz   = [int]$p[4]
            primary = ($p[5] -eq '1')
        }
    })
}
$monitorNames = Section 'monitores' {
    @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction Stop | ForEach-Object {
        $chars = @($_.UserFriendlyName | Where-Object { $_ -gt 0 })
        if ($chars.Count -gt 0) { -join ($chars | ForEach-Object { [char]$_ }) }
    } | Where-Object { $_ })
}

# ---------- Sistema ----------
Step 90 'sistema'
$os = Section 'sistema' {
    $o = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    [ordered]@{
        caption        = Clean $o.Caption
        version        = Clean $o.Version
        build          = [int]$o.BuildNumber
        ubr            = [int]$cv.UBR
        displayVersion = Clean $cv.DisplayVersion
    }
}
$isLaptop = Section 'chasis' {
    $laptopTypes = 8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32
    $chassis = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes)
    $hasBattery = $null -ne (Get-CimInstance Win32_Battery | Select-Object -First 1)
    $hasBattery -or (@($chassis | Where-Object { $laptopTypes -contains $_ }).Count -gt 0)
}
$power = $null
if ($powerRaw -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*(?:\((.+)\))?') {
    $power = [ordered]@{ guid = $Matches[1].ToLower(); name = Clean $Matches[2] }
}

Step 100 'listo'
Emit @{
    result = [ordered]@{
        cpu          = $cpu
        gpus         = @($gpus)
        ram          = $ram
        board        = $board
        disks        = @($disks)
        systemVolume = $systemVolume
        displays     = @($displays)
        monitorNames = @($monitorNames)
        os           = $os
        isLaptop     = [bool]$isLaptop
        power        = $power
        errors       = @($errors)
    }
}
