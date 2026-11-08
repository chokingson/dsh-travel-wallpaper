import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('native halo renders transparently and WPF layout/editor wiring works across common displays through 350%', { skip: process.platform !== 'win32' }, () => {
  const sourcePath = fileURLToPath(new URL('./desk-widget-v2.ps1', import.meta.url));
  const dpiCases = [
    { width: 1366, height: 728, scale: 1 },
    ...[1, 1.25, 1.5, 1.75, 2, 3, 3.5].map(scale => ({ width: 1920, height: 1040, scale })),
    ...[1.5, 2].map(scale => ({ width: 2560, height: 1400, scale })),
    { width: 2560, height: 1560, scale: 2 },
    { width: 2880, height: 1760, scale: 2 },
    ...[2, 2.5, 3, 3.5].map(scale => ({ width: 3840, height: 2120, scale })),
  ];
  const fixture = String.raw`
$ErrorActionPreference='Stop'
function Assert($condition,$message) { if (-not $condition) { throw $message } }
$source=[IO.File]::ReadAllText($env:HALO_SOURCE,[Text.Encoding]::UTF8)
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
Assert ($errors.Count -eq 0) ($errors | Out-String)
$dpiInit=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Initialize-WidgetDpi'},$false)[0]
. ([scriptblock]::Create($dpiInit.Extent.Text)); Initialize-WidgetDpi
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class HaloDpiProbe { [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext(); [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value); }'
Assert ([HaloDpiProbe]::GetAwarenessFromDpiAwarenessContext([HaloDpiProbe]::GetThreadDpiAwarenessContext()) -eq 1) 'UI thread is not consistently system DPI aware'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$xaml=[regex]::Match($source,"(?s)\[xml\]\`$markup = @'\r?\n(.*?)\r?\n'@").Groups[1].Value
Assert ($xaml.Length -gt 0) 'main XAML missing'
$window=[Windows.Markup.XamlReader]::Parse($xaml)
$panel=$window.FindName('Panel'); $orb=$window.FindName('Orb'); $headline=$window.FindName('Headline'); $summary=$window.FindName('Summary')
$menuLetters=$orb.ContextMenu.Items[1]
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) { . ([scriptblock]::Create($fn.Extent.Text)) }
# No production startup, timer, speech engine, sound player, or network is evaluated.
$script:playCount=0; $fakePlayer=New-Object psobject; $fakePlayer | Add-Member ScriptMethod Play { $script:playCount++ }
$script:effects=@{breath=$fakePlayer}; $script:soundsEnabled=$false; Play-Effect 'breath'
Assert ($script:playCount -eq 0) 'sound played with preference disabled'
$script:soundsEnabled=$true; Play-Effect 'breath'; Assert ($script:playCount -eq 1) 'enabled cue did not dispatch'
function Stop-Speech { }
function Play-Effect($kind) { $script:effectsSeen+=@($kind) }
function Send-Action($body) { $script:requests+=@($body); if ($script:failSubmit) { throw 'generation already running' } }
$script:requests=@(); $script:effectsSeen=@(); $script:expanded=$false; $script:submissionAt=$null
$panel.Visibility='Visible'; $root=$window.Content; $root.Measure([Windows.Size]::new(360,1000)); $root.Arrange([Windows.Rect]::new(0,0,$root.DesiredSize.Width,$root.DesiredSize.Height)); $root.UpdateLayout()
$ring=$window.FindName('HaloRing'); $glow=$window.FindName('HaloGlow')
Assert ($null -ne $ring -and $null -ne $glow) 'halo ring/glow missing'
Assert ($null -eq $ring.Fill -or $ring.Fill.Opacity -eq 0 -or $ring.Fill.Color.A -eq 0) 'ring center is filled'
$orb.Measure([Windows.Size]::new(72,72)); $orb.Arrange([Windows.Rect]::new(0,0,72,72)); $orb.UpdateLayout()
$bitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new(72,72,96,96,[Windows.Media.PixelFormats]::Pbgra32); $bitmap.Render($orb)
$pixels=New-Object byte[] (72*72*4); $bitmap.CopyPixels($pixels,72*4,0)
Assert ($pixels[(36*72+36)*4+3] -gt 0) 'orb center must not be a native click-through hole'
Assert ($null -ne $window.FindName('TravelerEmblem')) 'gold travel emblem missing'
foreach($point in @(@(36,36),@(20,36),@(36,20),@(36,52),@(52,36))) {
    $x=$point[0]; $y=$point[1]
    Assert ($pixels[($y*72+$x)*4+3] -gt 0) 'orb interior alpha leaves a native click-through hole'
    # InputHitTest is disabled when the whole test window is unshown. Inspect
    # the rendered visual geometry without displaying a production HWND.
    $hit=[Windows.Media.VisualTreeHelper]::HitTest($orb,[Windows.Point]::new($x,$y))
    Assert ($null -ne $hit -and $window.FindName('OrbHitSurface').IsHitTestVisible) 'orb interior has no hit surface'
}
$lit=0; for($i=3;$i -lt $pixels.Length;$i+=4) { if($pixels[$i] -gt 10){$lit++} }; Assert ($lit -gt 100) 'ring did not render'
foreach($name in @('NewsTab','LetterTab','Interfere','Reply')) { $b=$window.FindName($name); Assert ($null -ne $b -and $b.ActualWidth -gt 20 -and $b.ActualHeight -gt 20) ('button not laid out: '+$name) }
$script:state=[pscustomobject]@{ currentWorld='宋朝'; contextKey='song-context'; allowLetters=$true; interactionAvailable=$true; generation=@{state='idle'}; news=@{headline='宋朝新见闻';summary='宋朝内容';source=@{day='2026-11-08';issueId='issue-new'}}; latestLetter=@{id='2026-11-08-1234abcd';title='信';items=@(@{world='宋朝';text='新信'});sourceIssueId='letter-issue'} }
Update-DesktopContent
Assert ($headline.Text -eq '宋朝新见闻') 'news not applied'
Set-View 'letters'
Assert ($script:requests[-1].action -eq 'desktop-letter-read' -and $script:requests[-1].id -eq '2026-11-08-1234abcd') 'opaque full letter id lost'
$script:requests=@()
$script:opened=@(); function Open-Interaction($mode) { $script:opened+=@($mode) }
foreach($name in @('Reply','Interfere')) {
    $line=($source -split "\r?\n" | Where-Object { $_.StartsWith(('$window.FindName('''+$name+''').Add_Click')) })
    Assert ($null -ne $line) ('action handler missing: '+$name)
    . ([scriptblock]::Create($line))
    $window.FindName($name).RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent))
}
Assert (($script:opened -join ',') -eq 'reply,interfere') 'action buttons open wrong editor modes'
$dialog=New-InteractionEditor 'reply'
Assert ($dialog.FindName('EditorHint').Text -like '让您的角色*') 'reply guidance missing'
Assert ($dialog.FindName('EditorText').AcceptsReturn -and $dialog.FindName('EditorText').MaxLength -eq 4000) 'editor not multiline/limited'
$dialog.FindName('EditorText').Text='  '
Submit-Interaction $dialog
Assert ($script:requests.Count -eq 0 -and $dialog.FindName('EditorStatus').Text.Length -gt 0) 'blank submitted'
$dialog.FindName('EditorText').Text=('长'*4001); Submit-Interaction $dialog
Assert ($script:requests.Count -eq 0) 'overlong text submitted'
$dialog.FindName('EditorText').Text='带一份特产'
Assert ($dialog.FindName('EditorHint').Visibility -eq 'Collapsed') 'placeholder stays visible while typing'
$dialog.FindName('EditorSubmit').RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent))
Assert ($script:requests.Count -eq 1) 'submit did not reach action'
Assert ($script:requests[0].action -eq 'desktop-interaction' -and $script:requests[0].mode -eq 'reply' -and $script:requests[0].sourceIssueId -eq 'issue-new' -and $script:requests[0].contextKey -eq 'song-context' -and $script:requests[0].text -eq '带一份特产') 'wrong interaction payload'
$script:submissionAt=$null; $script:state.generation.state='running'; Update-DesktopContent
Assert (-not $window.FindName('Reply').IsEnabled -and -not $window.FindName('Interfere').IsEnabled) 'generation buttons still enabled'
Assert ($window.FindName('InteractionStatus').Text -eq '生成中，稍等') 'generation status missing'
$script:state=[pscustomobject]@{ currentWorld='观察2077'; allowLetters=$false; interactionAvailable=$true; generation=@{state='idle'}; news=$null; latestLetter=$null }
Update-DesktopContent
Assert ($headline.Text -eq '等待本次世界简报…' -and $summary.Text -notlike '*宋朝*') 'stale news retained'
Assert ($window.FindName('CurrentWorld').Text -like '*观察2077*') 'world not shown'
Assert ($window.FindName('Reply').Visibility -eq 'Collapsed' -and $window.FindName('Interfere').IsEnabled) 'observer action rules wrong'
Assert ($window.FindName('LetterText').Text -notlike '*新信*') 'stale letter retained'
$dialog=New-InteractionEditor 'interfere'; Assert ($dialog.FindName('EditorHint').Text -like '您可以尽情发挥*') 'interference guidance missing'
Assert ($dialog.FindName('EditorHint').Text -like '*选择帮奴隶们*' -and $dialog.FindName('EditorHint').Text -notlike '*帮该*') 'redundant character in guidance'
$script:failSubmit=$true; $dialog.FindName('EditorText').Text='改变世界'; Submit-Interaction $dialog
Assert ($dialog.FindName('EditorStatus').Text.Length -gt 0 -and $dialog.FindName('EditorSubmit').IsEnabled) 'request error not recoverable'
Set-View 'letters'
Start-HaloPulse
Assert ($glow.HasAnimatedProperties) 'halo did not animate'
$dpiCases=$env:HALO_DPI_CASES | ConvertFrom-Json
foreach($dpiCase in $dpiCases) {
    $scale=[double]$dpiCase.scale; $caseLabel=[string]$dpiCase.width+'x'+[string]$dpiCase.height+' @ '+[string]($scale*100)+'%'
    # Physical-pixel work area converted once to WPF DIPs, then rasterized at its DPI.
    $area=[Windows.Rect]::new(0,0,$dpiCase.width/$scale,$dpiCase.height/$scale)
    $panel.Visibility='Visible'; $script:state.allowLetters=$true; Update-DesktopContent
    $window.FindName('Headline').Text=('多行世界见闻标题'*8)
    $window.FindName('Summary').Text=('这是一段需要滚动阅读的世界见闻。'*200)
    Update-WidgetSizing $area
    $root.Measure([Windows.Size]::new($area.Width,$area.Height)); $root.Arrange([Windows.Rect]::new(0,0,$root.DesiredSize.Width,$root.DesiredSize.Height)); $root.UpdateLayout()
    Assert ($root.ActualWidth -le $area.Width+0.1 -and $root.ActualHeight -le $area.Height+0.1) ('widget exceeds logical work area at '+$caseLabel+': '+$root.ActualWidth+'x'+$root.ActualHeight+' vs '+$area.Width+'x'+$area.Height)
    foreach($name in @('NewsTab','LetterTab','Interfere','Reply')) {
        $button=$window.FindName($name); $p=$button.TranslatePoint([Windows.Point]::new(0,0),$root)
        Assert ($p.X -ge 0 -and $p.Y -ge 0 -and $p.X+$button.ActualWidth -le $root.ActualWidth+0.1 -and $p.Y+$button.ActualHeight -le $root.ActualHeight+0.1) ('action off-screen at '+$caseLabel+': '+$name)
    }
    Assert ($window.FindName('PanelScroll').ViewportHeight -gt 30) ('panel has no readable scrolling viewport at '+$caseLabel)
    $position=Get-ClampedPosition -999 9999 $root.ActualWidth $root.ActualHeight $area
    Assert ($position.X -eq $area.Left -and $position.Y+$root.ActualHeight -le $area.Bottom+0.1) ('work-area clamp failed at '+$caseLabel+': '+$position+' h '+$root.ActualHeight+' bottom '+$area.Bottom)
    $scaledBitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new([int][Math]::Ceiling($root.ActualWidth*$scale),[int][Math]::Ceiling($root.ActualHeight*$scale),96*$scale,96*$scale,[Windows.Media.PixelFormats]::Pbgra32); $scaledBitmap.Render($root)
    $dialog=New-InteractionEditor 'interfere'; Fit-InteractionEditor $dialog $area
    Assert ($dialog.Width -le $area.Width -and $dialog.Height -le $area.Height -and $dialog.Left -ge $area.Left -and $dialog.Top -ge $area.Top -and $dialog.Left+$dialog.Width -le $area.Right+0.1 -and $dialog.Top+$dialog.Height -le $area.Bottom+0.1) ('editor bounds exceed work area at '+$caseLabel)
    # Account for ordinary window chrome without creating an HWND or showing it.
    $content=$dialog.Content; $content.Measure([Windows.Size]::new($dialog.Width-16,$dialog.Height-40)); $content.Arrange([Windows.Rect]::new(0,0,$dialog.Width-16,$dialog.Height-40)); $content.UpdateLayout()
    $input=$dialog.FindName('EditorText'); $hint=$dialog.FindName('EditorHintScroll')
    Assert ($input.ActualHeight -ge 55 -and $input.ActualWidth -ge 200) ('input unreadable at '+$caseLabel)
    Assert ($hint.ActualWidth -le $input.ActualWidth -and $hint.ActualHeight -le $input.ActualHeight) ('placeholder overflows input at '+$caseLabel)
    foreach($name in @('EditorCancel','EditorSubmit')) { $button=$dialog.FindName($name); $p=$button.TranslatePoint([Windows.Point]::new(0,0),$content); Assert ($p.Y+$button.ActualHeight -le $content.ActualHeight+0.1) ('editor action clipped at '+$caseLabel) }
    $editorBitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new([int][Math]::Ceiling($content.ActualWidth*$scale),[int][Math]::Ceiling($content.ActualHeight*$scale),96*$scale,96*$scale,[Windows.Media.PixelFormats]::Pbgra32); $editorBitmap.Render($content)
    $dialog.Close()
    Write-Output ('DPI layout passed: '+$caseLabel)
}
$area=[Windows.Rect]::new(-500,20,280,460); Update-WidgetSizing $area
$root.Measure([Windows.Size]::new($area.Width,$area.Height)); $root.Arrange([Windows.Rect]::new(0,0,$root.DesiredSize.Width,$root.DesiredSize.Height)); $root.UpdateLayout()
Assert ($root.ActualWidth -le 280 -and $root.ActualHeight -le 460) 'narrow work area exceeded'
foreach($name in @('NewsTab','LetterTab','Interfere','Reply')) { $button=$window.FindName($name); $p=$button.TranslatePoint([Windows.Point]::new(0,0),$root); Assert ($p.X+$button.ActualWidth -le 280 -and $p.Y+$button.ActualHeight -le 460) ('wrapped action clipped: '+$name) }
$position=Get-ClampedPosition 0 9999 $root.ActualWidth $root.ActualHeight $area
Assert ($position.X -eq $area.Left -and $position.Y+$root.ActualHeight -le $area.Bottom) 'offset work-area origin ignored'
foreach($area in @([Windows.Rect]::new(0,0,1920/3.5,1040/3.5),[Windows.Rect]::new(-500,20,280,460))) {
    $letter=@{id='2026-11-08-1234abcd';items=@(@{world='宋朝';text=('这是一封需要滚动阅读的长来信。'*200)})}
    $reader=New-LetterReader $letter $area
    $toast=New-LetterToast $letter $area
    foreach($secondary in @($reader,$toast)) {
        Assert ($secondary.WindowStartupLocation -eq 'Manual' -and $secondary.Width -le $area.Width -and $secondary.Height -le $area.Height -and $secondary.Left -ge $area.Left -and $secondary.Top -ge $area.Top -and $secondary.Left+$secondary.Width -le $area.Right -and $secondary.Top+$secondary.Height -le $area.Bottom) ('standalone reader/toast outside work area: '+$area)
        $content=$secondary.Content; $content.Measure([Windows.Size]::new($secondary.Width-16,$secondary.Height-40)); $content.Arrange([Windows.Rect]::new(0,0,$secondary.Width-16,$secondary.Height-40)); $content.UpdateLayout()
    }
    Assert ($reader.Content -is [Windows.Controls.ScrollViewer] -and $reader.Content.ViewportHeight -gt 80 -and $reader.Content.ScrollableHeight -gt 0) 'standalone long letter has no readable scrolling viewport'
    Assert ($reader.WindowStyle -eq 'SingleBorderWindow' -and $reader.Content.Content.FontSize -eq 16 -and $reader.Content.Content.LineHeight -eq 28) 'reader lost its close chrome or readable font size'
    $readButton=$toast.Content.Children[$toast.Content.Children.Count-1]; $p=$readButton.TranslatePoint([Windows.Point]::new(0,0),$toast.Content)
    Assert ($readButton.Content -eq '读信' -and $p.Y+$readButton.ActualHeight -le $toast.Content.ActualHeight+0.1) 'toast read action clipped'
    $reader.Close(); $toast.Close()
}
$window.Close()
Write-Output 'native halo fixture passed'
`;
  const dir = mkdtempSync(join(tmpdir(), 'travel-halo-'));
  try {
    const file = join(dir, 'fixture.ps1');
    writeFileSync(file, '\ufeff' + fixture);
    const command = `& ([scriptblock]::Create([IO.File]::ReadAllText('${file.replaceAll("'", "''")}',[Text.Encoding]::UTF8)))`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, HALO_SOURCE: sourcePath, HALO_DPI_CASES: JSON.stringify(dpiCases) } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /native halo fixture passed/);
    assert.equal((result.stdout.match(/DPI layout passed:/g) ?? []).length, dpiCases.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
