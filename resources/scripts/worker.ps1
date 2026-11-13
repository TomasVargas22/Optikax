# Optikax - worker nativo persistente.
# Protocolo: una linea JSON por peticion en stdin -> una linea JSON por respuesta en stdout.
#   {"id":1,"cmd":"memStats","args":{}}  ->  {"id":1,"ok":true,"data":{...}}
# IMPORTANTE: este archivo debe ser ASCII puro (PowerShell 5.1 lee -File como ANSI)
# y el C# debe compilar con C# 5 (sin interpolacion, sin ?., sin out var).

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8

$source = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class OptikaxNative
{
    const int SystemMemoryListInformation = 0x50;
    const uint TOKEN_ADJUST_PRIVILEGES = 0x20;
    const uint TOKEN_QUERY = 0x8;
    const int SE_PRIVILEGE_ENABLED = 2;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [StructLayout(LayoutKind.Sequential)]
    struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_PRIVILEGES { public int PrivilegeCount; public LUID Luid; public int Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);

    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, int len, IntPtr prev, IntPtr retLen);

    [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr info, int len, out int retLen);
    [DllImport("ntdll.dll")] static extern int NtSetSystemInformation(int cls, ref int info, int len);

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    // ---------- JSON minimo ----------

    public static string Quote(string s)
    {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        foreach (char c in s)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        sb.Append('"');
        return sb.ToString();
    }

    // ---------- Privilegios ----------

    static bool EnablePrivilege(string name)
    {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out token)) return false;
        try
        {
            TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
            tp.PrivilegeCount = 1;
            tp.Attributes = SE_PRIVILEGE_ENABLED;
            if (!LookupPrivilegeValue(null, name, out tp.Luid)) return false;
            if (!AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero)) return false;
            // Devuelve true aunque no asigne nada: ERROR_NOT_ALL_ASSIGNED (1300) lo delata.
            return Marshal.GetLastWin32Error() == 0;
        }
        finally { CloseHandle(token); }
    }

    public static string EnablePrivileges()
    {
        string[] names = { "SeProfileSingleProcessPrivilege", "SeIncreaseQuotaPrivilege", "SeDebugPrivilege" };
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < names.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(Quote(names[i])).Append(':').Append(EnablePrivilege(names[i]) ? "true" : "false");
        }
        return sb.Append('}').ToString();
    }

    // ---------- Memoria ----------

    static PerformanceCounter[] standbyCounters;
    static PerformanceCounter freeCounter;
    static PerformanceCounter modifiedCounter;

    static long ReadPages(IntPtr buf, int index)
    {
        return Marshal.ReadIntPtr(buf, index * IntPtr.Size).ToInt64();
    }

    public static string MemStats()
    {
        MEMORYSTATUSEX m = new MEMORYSTATUSEX();
        m.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        if (!GlobalMemoryStatusEx(ref m)) throw new Win32Exception(Marshal.GetLastWin32Error());

        long page = Environment.SystemPageSize;
        long standby = 0, free = 0, modified = 0;
        long[] byPriority = new long[8];
        bool detailed = false;

        // SYSTEM_MEMORY_LIST_INFORMATION: 5 contadores + 8 por prioridad + 8 reutilizadas + 1.
        int size = 22 * IntPtr.Size;
        IntPtr buf = Marshal.AllocHGlobal(size);
        try
        {
            int ret;
            if (NtQuerySystemInformation(SystemMemoryListInformation, buf, size, out ret) == 0)
            {
                free = (ReadPages(buf, 0) + ReadPages(buf, 1)) * page;      // Zero + Free
                modified = (ReadPages(buf, 2) + ReadPages(buf, 3)) * page;  // Modified + ModifiedNoWrite
                for (int i = 0; i < 8; i++)
                {
                    byPriority[i] = ReadPages(buf, 5 + i) * page;
                    standby += byPriority[i];
                }
                detailed = true;
            }
        }
        finally { Marshal.FreeHGlobal(buf); }

        if (!detailed)
        {
            // Sin privilegio: contadores de rendimiento (sin desglose por prioridad).
            try
            {
                if (standbyCounters == null)
                {
                    standbyCounters = new PerformanceCounter[] {
                        new PerformanceCounter("Memory", "Standby Cache Reserve Bytes"),
                        new PerformanceCounter("Memory", "Standby Cache Normal Priority Bytes"),
                        new PerformanceCounter("Memory", "Standby Cache Core Bytes")
                    };
                    freeCounter = new PerformanceCounter("Memory", "Free & Zero Page List Bytes");
                    modifiedCounter = new PerformanceCounter("Memory", "Modified Page List Bytes");
                }
                foreach (PerformanceCounter c in standbyCounters) standby += c.RawValue;
                free = freeCounter.RawValue;
                modified = modifiedCounter.RawValue;
            }
            catch { free = (long)m.ullAvailPhys; }
        }

        StringBuilder sb = new StringBuilder(256);
        sb.Append("{\"totalBytes\":").Append(m.ullTotalPhys);
        sb.Append(",\"availBytes\":").Append(m.ullAvailPhys);
        sb.Append(",\"loadPercent\":").Append(m.dwMemoryLoad);
        sb.Append(",\"standbyBytes\":").Append(standby);
        sb.Append(",\"freeBytes\":").Append(free);
        sb.Append(",\"modifiedBytes\":").Append(modified);
        sb.Append(",\"detailed\":").Append(detailed ? "true" : "false");
        sb.Append(",\"standbyByPriority\":[");
        for (int i = 0; i < 8; i++) { if (i > 0) sb.Append(','); sb.Append(byPriority[i]); }
        return sb.Append("]}").ToString();
    }

    public static string Purge(string kind)
    {
        int cmd;
        switch (kind)
        {
            case "workingSets": cmd = 2; break;  // MemoryEmptyWorkingSets
            case "modified": cmd = 3; break;     // MemoryFlushModifiedList
            case "standby": cmd = 4; break;      // MemoryPurgeStandbyList
            case "standbyLow": cmd = 5; break;   // MemoryPurgeLowPriorityStandbyList
            default: throw new ArgumentException("Tipo de purga desconocido: " + kind);
        }
        string before = MemStats();
        int status = NtSetSystemInformation(SystemMemoryListInformation, ref cmd, sizeof(int));
        if (status != 0)
            throw new InvalidOperationException("NtSetSystemInformation fallo con 0x" + status.ToString("X8"));
        string after = MemStats();
        return "{\"kind\":" + Quote(kind) + ",\"before\":" + before + ",\"after\":" + after + "}";
    }

    // ---------- Procesos ----------

    static string ProcessPath(int pid)
    {
        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return null;  // protegido o ya cerrado
        try
        {
            StringBuilder sb = new StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString(0, size) : null;
        }
        finally { CloseHandle(h); }
    }

    public static string ListProcesses()
    {
        StringBuilder sb = new StringBuilder(32768);
        sb.Append('[');
        bool first = true;
        foreach (Process p in Process.GetProcesses())
        {
            try
            {
                int pid = p.Id;
                if (pid == 0 || pid == 4) continue;  // Idle y System
                string name = p.ProcessName;
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"pid\":").Append(pid);
                sb.Append(",\"name\":").Append(Quote(name));
                sb.Append(",\"path\":").Append(Quote(ProcessPath(pid))).Append('}');
            }
            catch { }
            finally { p.Dispose(); }
        }
        return sb.Append(']').ToString();
    }

    static string PriorityJson(Process p)
    {
        return "{\"pid\":" + p.Id + ",\"priority\":" + Quote(p.PriorityClass.ToString()) + "}";
    }

    public static string GetPriority(int pid)
    {
        using (Process p = Process.GetProcessById(pid)) return PriorityJson(p);
    }

    public static string SetPriority(int pid, string level)
    {
        ProcessPriorityClass cls;
        switch (level)
        {
            // RealTime queda fuera a proposito: puede congelar el sistema.
            case "High": cls = ProcessPriorityClass.High; break;
            case "AboveNormal": cls = ProcessPriorityClass.AboveNormal; break;
            case "Normal": cls = ProcessPriorityClass.Normal; break;
            case "BelowNormal": cls = ProcessPriorityClass.BelowNormal; break;
            default: throw new ArgumentException("Prioridad no permitida: " + level);
        }
        using (Process p = Process.GetProcessById(pid))
        {
            p.PriorityClass = cls;
            p.Refresh();
            return PriorityJson(p);
        }
    }

    // ---------- Mouse ----------

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SystemParametersInfo(uint action, uint param, int[] value, uint winIni);

    // Aplica en vivo umbral1, umbral2 y aceleracion (SPI_SETMOUSE) sin esperar a cerrar sesion.
    public static string SetMouse(int threshold1, int threshold2, int speed)
    {
        int[] v = { threshold1, threshold2, speed };
        if (!SystemParametersInfo(4, 0, v, 2)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return GetMouse();
    }

    public static string GetMouse()
    {
        int[] v = new int[3];
        if (!SystemParametersInfo(3, 0, v, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return "[" + v[0] + "," + v[1] + "," + v[2] + "]";
    }

    public static string ForegroundPid()
    {
        uint pid;
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return "null";
        GetWindowThreadProcessId(hwnd, out pid);
        return pid == 0 ? "null" : pid.ToString();
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

# ---------- Registro ----------
# Las rutas llegan como "HKLM\..." o "HKCU\...". Solo el proceso principal las envia:
# salen del catalogo de ajustes, nunca del renderer ni de la IA.

function Split-RegPath([string]$path) {
    $i = $path.IndexOf('\')
    if ($i -lt 1) { throw "Ruta de registro no valida: $path" }
    $root = switch ($path.Substring(0, $i)) {
        'HKLM' { [Microsoft.Win32.Registry]::LocalMachine }
        'HKCU' { [Microsoft.Win32.Registry]::CurrentUser }
        default { throw "Hive no permitido: $path" }
    }
    return @($root, $path.Substring($i + 1))
}

function Read-Registry($items) {
    $out = New-Object System.Collections.ArrayList
    foreach ($it in @($items)) {
        $r = [ordered]@{ path = [string]$it.path; name = [string]$it.name; keyExists = $false; exists = $false; kind = $null; value = $null }
        $root, $sub = Split-RegPath $r.path
        $key = $root.OpenSubKey($sub, $false)
        if ($key) {
            try {
                $r.keyExists = $true
                if (@($key.GetValueNames()) -contains $r.name) {
                    $kind = $key.GetValueKind($r.name).ToString()
                    $v = $key.GetValue($r.name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                    $r.exists = $true
                    $r.kind = $kind
                    # DWord llega con signo: 0xFFFFFFFF seria -1.
                    if ($kind -eq 'DWord') { $r.value = [int64][BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$v), 0) }
                    elseif ($kind -eq 'String' -or $kind -eq 'ExpandString') { $r.value = [string]$v }
                }
            }
            finally { $key.Close() }
        }
        [void]$out.Add($r)
    }
    return (@{ items = $out } | ConvertTo-Json -Depth 4 -Compress)
}

function Write-Registry($items) {
    $out = New-Object System.Collections.ArrayList
    foreach ($it in @($items)) {
        $r = [ordered]@{ path = [string]$it.path; name = [string]$it.name; ok = $true; keyCreated = $false; error = $null }
        try {
            $root, $sub = Split-RegPath $r.path
            if ($it.deleteKeyIfEmpty) {
                $key = $root.OpenSubKey($sub, $false)
                if ($key) {
                    $empty = ($key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0)
                    $key.Close()
                    if ($empty) { $root.DeleteSubKey($sub, $false) }
                }
            }
            elseif ($it.delete) {
                $key = $root.OpenSubKey($sub, $true)
                if ($key) { try { $key.DeleteValue($r.name, $false) } finally { $key.Close() } }
            }
            else {
                $key = $root.OpenSubKey($sub, $true)
                if (-not $key) { $key = $root.CreateSubKey($sub); $r.keyCreated = $true }
                try {
                    switch ([string]$it.kind) {
                        'DWord' {
                            $n = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$it.value), 0)
                            $key.SetValue($r.name, $n, [Microsoft.Win32.RegistryValueKind]::DWord)
                        }
                        'String' { $key.SetValue($r.name, [string]$it.value, [Microsoft.Win32.RegistryValueKind]::String) }
                        'ExpandString' { $key.SetValue($r.name, [string]$it.value, [Microsoft.Win32.RegistryValueKind]::ExpandString) }
                        default { throw "Tipo de valor no admitido: $($it.kind)" }
                    }
                }
                finally { $key.Close() }
            }
        }
        catch { $r.ok = $false; $r.error = $_.Exception.Message }
        [void]$out.Add($r)
    }
    return (@{ items = $out } | ConvertTo-Json -Depth 4 -Compress)
}

# ---------- Planes de energia ----------
# Solo se leen GUID de la salida de powercfg: el resto del texto depende del idioma.

$guidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

function Invoke-PowerCfg {
    $output = (& powercfg.exe @args 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "powercfg $($args -join ' ') fallo: $($output.Trim())" }
    return $output
}
function Find-Guids([string]$text) {
    return @([regex]::Matches($text, $guidPattern) | ForEach-Object { $_.Value.ToLower() })
}
function Assert-Guid([string]$guid) {
    if ($guid -notmatch "^$guidPattern$") { throw "GUID no valido: $guid" }
    return $guid.ToLower()
}

function Invoke-Power($a) {
    switch ([string]$a.op) {
        'state' {
            $active = Find-Guids (Invoke-PowerCfg /getactivescheme) | Select-Object -First 1
            $schemes = Find-Guids (Invoke-PowerCfg /list) | Select-Object -Unique
            return (@{ active = $active; schemes = @($schemes) } | ConvertTo-Json -Compress)
        }
        'setActive' {
            [void](Invoke-PowerCfg /setactive (Assert-Guid $a.guid))
            return 'true'
        }
        'duplicate' {
            $new = Find-Guids (Invoke-PowerCfg /duplicatescheme (Assert-Guid $a.guid)) | Select-Object -First 1
            if (-not $new) { throw 'powercfg no devolvio el GUID del plan nuevo' }
            return (@{ guid = $new } | ConvertTo-Json -Compress)
        }
        'delete' {
            [void](Invoke-PowerCfg /delete (Assert-Guid $a.guid))
            return 'true'
        }
        default { throw "Operacion de energia desconocida: $($a.op)" }
    }
}

$privileges = [OptikaxNative]::EnablePrivileges()
[Console]::Out.WriteLine('{"ready":true,"privileges":' + $privileges + '}')

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }  # el proceso padre cerro stdin
    if ($line.Trim().Length -eq 0) { continue }

    $id = 0
    try {
        $req = $line | ConvertFrom-Json
        $id = [int]$req.id
        $a = $req.args
        $data = switch ([string]$req.cmd) {
            'ping'          { '"pong"' }
            'memStats'      { [OptikaxNative]::MemStats() }
            'purge'         { [OptikaxNative]::Purge([string]$a.kind) }
            'listProcesses' { [OptikaxNative]::ListProcesses() }
            'getPriority'   { [OptikaxNative]::GetPriority([int]$a.pid) }
            'setPriority'   { [OptikaxNative]::SetPriority([int]$a.pid, [string]$a.level) }
            'foregroundPid' { [OptikaxNative]::ForegroundPid() }
            'regRead'       { Read-Registry $a.items }
            'regWrite'      { Write-Registry $a.items }
            'power'         { Invoke-Power $a }
            'getMouse'      { [OptikaxNative]::GetMouse() }
            'setMouse'      { [OptikaxNative]::SetMouse([int]$a.threshold1, [int]$a.threshold2, [int]$a.speed) }
            default         { throw "Comando desconocido: $($req.cmd)" }
        }
        [Console]::Out.WriteLine('{"id":' + $id + ',"ok":true,"data":' + $data + '}')
    }
    catch {
        $ex = $_.Exception
        while ($ex.InnerException) { $ex = $ex.InnerException }
        [Console]::Out.WriteLine('{"id":' + $id + ',"ok":false,"error":' + [OptikaxNative]::Quote($ex.Message) + '}')
    }
}
