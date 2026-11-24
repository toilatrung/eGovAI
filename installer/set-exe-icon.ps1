param([Parameter(Mandatory = $true)][string]$Exe, [Parameter(Mandatory = $true)][string]$Icon)
# Thay biểu tượng của tệp .exe (ví dụ electron.exe -> eGovAI.exe) bằng tệp .ico, dùng Win32 UpdateResource.
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class IconPatcher
{
    const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
    static readonly IntPtr RT_ICON = (IntPtr)3;
    static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;

    delegate bool EnumResNameProc(IntPtr hModule, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumResLangProc(IntPtr hModule, IntPtr type, IntPtr name, ushort lang, IntPtr param);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
    [DllImport("kernel32", SetLastError = true)] static extern bool FreeLibrary(IntPtr h);
    [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumResNameProc cb, IntPtr p);
    [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumResLangProc cb, IntPtr p);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string f, bool deleteExisting);
    [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);

    public static string Patch(string exe, string ico)
    {
        // 1. Tìm nhóm biểu tượng đầu tiên (biểu tượng chính) và ngôn ngữ của nó.
        IntPtr mod = LoadLibraryEx(exe, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (mod == IntPtr.Zero) throw new Exception("LoadLibraryEx failed: " + Marshal.GetLastWin32Error());
        object groupName = null; ushort lang = 1033;
        try
        {
            EnumResourceNames(mod, RT_GROUP_ICON, (h, t, n, p) => {
                groupName = ((long)n >> 16) == 0 ? (object)(int)(long)n : Marshal.PtrToStringUni(n);
                return false;
            }, IntPtr.Zero);
            if (groupName != null)
            {
                IntPtr np = NamePtr(groupName);
                EnumResourceLanguages(mod, RT_GROUP_ICON, np, (h, t, n, l, p) => { lang = l; return false; }, IntPtr.Zero);
            }
        }
        finally { FreeLibrary(mod); }
        if (groupName == null) groupName = 1;

        // 2. Đọc tệp .ico.
        byte[] icoBytes = File.ReadAllBytes(ico);
        int count = BitConverter.ToUInt16(icoBytes, 4);
        var images = new List<byte[]>();
        var group = new MemoryStream();
        var gw = new BinaryWriter(group);
        gw.Write((ushort)0); gw.Write((ushort)1); gw.Write((ushort)count);
        for (int i = 0; i < count; i++)
        {
            int e = 6 + 16 * i;
            int size = BitConverter.ToInt32(icoBytes, e + 8);
            int offset = BitConverter.ToInt32(icoBytes, e + 12);
            var img = new byte[size];
            Buffer.BlockCopy(icoBytes, offset, img, 0, size);
            images.Add(img);
            gw.Write(icoBytes, e, 12);           // width, height, colors, reserved, planes, bitcount, bytesInRes
            gw.Write((ushort)(i + 1));           // nId của RT_ICON
        }

        // 3. Ghi đè tài nguyên.
        IntPtr hu = BeginUpdateResource(exe, false);
        if (hu == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
        for (int i = 0; i < images.Count; i++)
            if (!UpdateResource(hu, RT_ICON, (IntPtr)(i + 1), lang, images[i], (uint)images[i].Length))
                throw new Exception("UpdateResource(RT_ICON) failed: " + Marshal.GetLastWin32Error());
        byte[] g = group.ToArray();
        if (!UpdateResource(hu, RT_GROUP_ICON, NamePtr(groupName), lang, g, (uint)g.Length))
            throw new Exception("UpdateResource(RT_GROUP_ICON) failed: " + Marshal.GetLastWin32Error());
        if (!EndUpdateResource(hu, false)) throw new Exception("EndUpdateResource failed: " + Marshal.GetLastWin32Error());
        return "group=" + groupName + " lang=" + lang + " images=" + images.Count;
    }

    static IntPtr NamePtr(object name)
    {
        if (name is int) return (IntPtr)(int)name;
        return Marshal.StringToHGlobalUni((string)name);
    }
}
'@
$r = [IconPatcher]::Patch((Resolve-Path $Exe).Path, (Resolve-Path $Icon).Path)
Write-Host "Đã thay biểu tượng: $r"
