param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$Target = 'cs_5_1',
    [string]$Entry = 'main'
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if (-not ('WuWaShaderQa.Compiler' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
namespace WuWaShaderQa {
    public static class Compiler {
        [DllImport("d3dcompiler_47.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
        private static extern int D3DCompileFromFile(
            string source, IntPtr defines, IntPtr include,
            [MarshalAs(UnmanagedType.LPStr)] string entry,
            [MarshalAs(UnmanagedType.LPStr)] string target,
            uint flags1, uint flags2, out IntPtr code, out IntPtr errors);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate IntPtr BufferPointer(IntPtr self);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate UIntPtr BufferSize(IntPtr self);
        private static byte[] ReadBlob(IntPtr blob) {
            if (blob == IntPtr.Zero) return new byte[0];
            IntPtr table = Marshal.ReadIntPtr(blob);
            BufferPointer pointer = (BufferPointer)Marshal.GetDelegateForFunctionPointer(
                Marshal.ReadIntPtr(table, 3 * IntPtr.Size), typeof(BufferPointer));
            BufferSize size = (BufferSize)Marshal.GetDelegateForFunctionPointer(
                Marshal.ReadIntPtr(table, 4 * IntPtr.Size), typeof(BufferSize));
            ulong length = size(blob).ToUInt64();
            if (length > Int32.MaxValue) throw new InvalidOperationException("Shader blob too large");
            byte[] bytes = new byte[(int)length];
            Marshal.Copy(pointer(blob), bytes, 0, bytes.Length);
            return bytes;
        }
        public static string Compile(string source, string output, string entry, string target) {
            IntPtr code = IntPtr.Zero, errors = IntPtr.Zero;
            try {
                // Standard file include handler; strict syntax, optimized shader.
                int result = D3DCompileFromFile(source, IntPtr.Zero, new IntPtr(1),
                    entry, target, (1u << 11) | (1u << 15), 0, out code, out errors);
                string diagnostics = System.Text.Encoding.UTF8.GetString(ReadBlob(errors)).TrimEnd('\0');
                if (result < 0) throw new InvalidOperationException(
                    "D3DCompile HRESULT 0x" + ((uint)result).ToString("X8") + "\n" + diagnostics);
                byte[] bytes = ReadBlob(code);
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                File.WriteAllBytes(output, bytes);
                return diagnostics;
            } finally {
                if (errors != IntPtr.Zero) Marshal.Release(errors);
                if (code != IntPtr.Zero) Marshal.Release(code);
            }
        }
    }
}
'@
}
$diagnostics = [WuWaShaderQa.Compiler]::Compile($sourcePath, $outputPath, $Entry, $Target)
if ($diagnostics) { Write-Output $diagnostics }
Get-Item -LiteralPath $outputPath | Select-Object FullName,Length
