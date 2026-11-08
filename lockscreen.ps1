$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# Per-user supported WinRT APIs only. No policy, registry, or permission changes.
# https://learn.microsoft.com/uwp/api/windows.system.userprofile.lockscreen.setimagefileasync
try {
  $ImagePath = $env:PLANET_LOCKSCREEN_IMAGE_PATH
  if ([string]::IsNullOrWhiteSpace($ImagePath)) { throw 'No lock screen image was selected' }
  $resolvedImage = (Get-Item -LiteralPath $ImagePath -ErrorAction Stop).FullName
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $storageType = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  $lockScreenType = [Windows.System.UserProfile.LockScreen, Windows.System.UserProfile, ContentType=WindowsRuntime]
  $operationTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $actionTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.FullName -eq 'Windows.Foundation.IAsyncAction'
  } | Select-Object -First 1
  if (-not $operationTaskMethod -or -not $actionTaskMethod) { throw 'Windows Runtime async support is unavailable' }

  function Await-StorageFile($Operation) {
    $method = $operationTaskMethod.MakeGenericMethod([Type[]]@($storageType))
    $task = $method.Invoke($null, [object[]]@($Operation))
    return $task.GetAwaiter().GetResult()
  }
  function Get-ImageHash([string]$Path) {
    $inputStream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($inputStream)) }
    finally { $sha.Dispose(); $inputStream.Dispose() }
  }

  $storageFile = Await-StorageFile ($storageType::GetFileFromPathAsync($resolvedImage))
  $setAction = $lockScreenType::SetImageFileAsync($storageFile)
  $setTask = $actionTaskMethod.Invoke($null, [object[]]@($setAction))
  $null = $setTask.GetAwaiter().GetResult()

  # An API completion alone is insufficient: compare the reported original
  # image, or read back and hash the actual image stream returned by Windows.
  $verification = ''
  $sourceHash = Get-ImageHash $resolvedImage
  try {
    $original = $lockScreenType::OriginalImageFile
    if ($original -and $original.IsFile) {
      $originalPath = [IO.Path]::GetFullPath($original.LocalPath)
      if ([string]::Equals($originalPath, $resolvedImage, [StringComparison]::OrdinalIgnoreCase)) {
        $verification = 'original-file-path'
      } elseif ((Get-ImageHash $originalPath) -eq $sourceHash) {
        $verification = 'original-file-sha256'
      }
    }
  } catch { }
  if (-not $verification) {
    $imageStream = $null
    $readStream = $null
    $sha = $null
    try {
      $imageStream = $lockScreenType::GetImageStream()
      $readStream = [IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($imageStream)
      $sha = [Security.Cryptography.SHA256]::Create()
      if ([BitConverter]::ToString($sha.ComputeHash($readStream)) -eq $sourceHash) {
        $verification = 'image-stream-sha256'
      }
    } finally {
      if ($sha) { $sha.Dispose() }
      if ($readStream) { $readStream.Dispose() }
      if ($imageStream) { $imageStream.Dispose() }
    }
  }
  if (-not $verification) { throw 'Windows did not return a verifiable matching lock screen image' }
  @{ applied = $true; verified = $true; path = $resolvedImage; verification = $verification } | ConvertTo-Json -Compress
} catch {
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  @{ applied = $false; verified = $false; error = $failure.Message } | ConvertTo-Json -Compress
}
