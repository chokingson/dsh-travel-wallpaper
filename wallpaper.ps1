param([Parameter(Mandatory=$true)][string]$ImagePath, [Parameter(Mandatory=$true)][string]$BitmapPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PlanetWallpaper {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="SystemParametersInfoW")]
  public static extern bool Set(uint action, uint param, string path, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="SystemParametersInfoW")]
  public static extern bool Get(uint action, uint param, StringBuilder path, uint flags);
}
'@
$resolvedImage = (Resolve-Path -LiteralPath $ImagePath).Path
$sourceImage = [Drawing.Image]::FromFile($resolvedImage)
try { $sourceImage.Save($BitmapPath, [Drawing.Imaging.ImageFormat]::Bmp) }
finally { $sourceImage.Dispose() }
$resolvedBitmap = (Resolve-Path -LiteralPath $BitmapPath).Path
if (-not [PlanetWallpaper]::Set(20, 0, $resolvedBitmap, 3)) {
  throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
$current = [Text.StringBuilder]::new(32768)
if (-not [PlanetWallpaper]::Get(115, 32768, $current, 0) -or $current.ToString() -ne $resolvedBitmap) { throw 'Windows wallpaper verification failed' }
@{ applied = $true; path = $resolvedBitmap } | ConvertTo-Json -Compress
