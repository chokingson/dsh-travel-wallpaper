$ErrorActionPreference = 'Stop'
function Initialize-WidgetDpi {
    # Fix this PowerShell UI thread at system DPI before WPF caches any metrics.
    # SystemParameters.WorkArea and every Window dimension below are WPF DIPs.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TravelWidgetDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
    public static void Initialize() {
        SetProcessDPIAware();
        try { SetThreadDpiAwarenessContext(new IntPtr(-2)); }
        catch (EntryPointNotFoundException) { }
    }
}
'@
    [TravelWidgetDpi]::Initialize()
}
Initialize-WidgetDpi
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$endpoint=$env:TRAVEL_WIDGET_URL
$secret=$env:TRAVEL_WIDGET_KEY
if (-not $endpoint -or -not $secret) { exit 1 }
$headers=@{ 'x-travel-widget-key'=$secret; Origin=([uri]$endpoint).GetLeftPart([System.UriPartial]::Authority) }
$script:failures=0; $script:expanded=$false; $script:reader=$null; $script:toast=$null
$script:lastLetter=''; $script:pendingAck=''; $script:state=$null; $script:soundsEnabled=$false; $script:shuttingDown=$false
$script:speaker=$null; $script:effects=@{}
$script:lastNews=''; $script:lastContext=''; $script:submissionAt=$null; $script:editor=$null
try {
    Add-Type -AssemblyName System.Speech
    $script:speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voice=$script:speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
    if ($voice) { $script:speaker.SelectVoice($voice.VoiceInfo.Name) }
} catch { }
foreach ($kind in @('click','breath')) {
    try { $file=Join-Path $env:TRAVEL_WIDGET_ASSET_DIR ($kind+'.wav'); $player=New-Object System.Media.SoundPlayer $file; $player.Load(); $script:effects[$kind]=$player } catch { }
}
function Play-Effect($kind) { if ($script:soundsEnabled -and $script:effects[$kind]) { try { $script:effects[$kind].Play() } catch { } } }
function Stop-Speech { if ($script:speaker) { $script:speaker.SpeakAsyncCancelAll() } }
function Send-Action($body) {
    Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))) -TimeoutSec 3 | Out-Null
}
[xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="旅行壁纸 · 气泡世界" WindowStyle="None" AllowsTransparency="True" Background="Transparent" ShowInTaskbar="False" Topmost="True" ShowActivated="False" ResizeMode="NoResize" SizeToContent="WidthAndHeight">
 <Window.Resources>
  <Style TargetType="Button"><Setter Property="Foreground" Value="#EDF5FF"/><Setter Property="Background" Value="#33445E"/><Setter Property="BorderBrush" Value="#607DA2"/><Setter Property="Padding" Value="12,6"/><Setter Property="Cursor" Value="Hand"/></Style>
 </Window.Resources>
 <StackPanel>
  <Border x:Name="Panel" Width="360" Background="#ED182434" BorderBrush="#9CAED2E7" BorderThickness="1" CornerRadius="18" Padding="18" Margin="0,0,0,6" Visibility="Collapsed">
   <Grid><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
   <StackPanel>
    <DockPanel Margin="0,0,0,12"><Button x:Name="Collapse" Content="×" DockPanel.Dock="Right" Padding="8,1" ToolTip="收起面板"/><TextBlock Text="旅行见闻" FontSize="18" FontWeight="Bold" Foreground="White" VerticalAlignment="Center"/></DockPanel>
    <TextBlock x:Name="CurrentWorld" Text="当前世界" TextWrapping="Wrap" TextTrimming="CharacterEllipsis" MaxHeight="42" Foreground="#C9E2EC" FontSize="12" Margin="0,0,0,10"/>
    <WrapPanel Margin="0,0,0,10"><Button x:Name="NewsTab" Content="世界见闻" Padding="8,6" Margin="0,0,4,5"/><Button x:Name="LetterTab" Content="角色来信" Padding="8,6" Margin="0,0,4,5"/><Button x:Name="Interfere" Content="干涉世界" Padding="8,6" Margin="0,0,4,5"/><Button x:Name="Reply" Content="回信" Padding="8,6" Margin="0,0,0,5"/></WrapPanel>
    <TextBlock x:Name="InteractionStatus" TextWrapping="Wrap" TextTrimming="CharacterEllipsis" MaxHeight="42" Foreground="#C9DFEF" FontSize="12" Margin="0,0,0,8"/>
   </StackPanel>
   <ScrollViewer x:Name="PanelScroll" Grid.Row="1" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled"><StackPanel>
    <StackPanel x:Name="NewsView">
     <TextBlock x:Name="NewsDate" Text="平行世界虚构见闻" Foreground="#AABFD6" FontSize="11" Margin="0,0,0,12"/>
     <TextBlock x:Name="Headline" Text="等待本次世界简报…" FontSize="16" FontWeight="SemiBold" Foreground="White" TextWrapping="Wrap"/>
     <ScrollViewer MaxHeight="210" VerticalScrollBarVisibility="Auto" Margin="0,10,0,12"><TextBlock x:Name="Summary" Foreground="#E0EAF5" FontSize="14" TextWrapping="Wrap" LineHeight="23"/></ScrollViewer>
     <Button x:Name="Speak" Content="朗读 / 停止" HorizontalAlignment="Left"/>
    </StackPanel>
    <StackPanel x:Name="LetterView" Visibility="Collapsed">
     <TextBlock x:Name="LetterDate" Text="角色的旅行小便笺" Foreground="#AABFD6" FontSize="11" Margin="0,0,0,12"/>
     <ScrollViewer MaxHeight="260" VerticalScrollBarVisibility="Auto"><TextBlock x:Name="LetterText" Foreground="#E0EAF5" FontSize="14" TextWrapping="Wrap" LineHeight="24" Text="还没有来信。开启每日投递后，角色的短日记会存到本机信箱。"/></ScrollViewer>
    </StackPanel>
   </StackPanel></ScrollViewer>
    <TextBlock Grid.Row="2" Text="左键展开 · 按住拖动 · 右键菜单" TextWrapping="Wrap" Foreground="#AABFD6" FontSize="11" Margin="0,10,0,0"/>
   </Grid>
  </Border>
  <Border x:Name="Orb" Width="72" Height="72" Background="Transparent" HorizontalAlignment="Right" Cursor="Hand" ToolTip="旅行壁纸：左键看见闻与来信，按住拖动，右键退出">
   <Border.ContextMenu><ContextMenu><MenuItem Header="世界见闻"/><MenuItem Header="角色来信"/><Separator/><MenuItem Header="交互与来信提示音" IsCheckable="True"/><Separator/><MenuItem Header="退出悬浮球" ToolTip="仅退出悬浮球；定时来信由独立开关控制"/></ContextMenu></Border.ContextMenu>
   <Grid Margin="4">
    <!-- Nonzero alpha is required for native layered-window input, even though WPF considers Transparent hit-testable. -->
    <Ellipse x:Name="OrbHitSurface" Width="58" Height="58" Fill="#01000000"/>
    <Ellipse x:Name="HaloGlow" Width="54" Height="54" Stroke="#9CE6F1" StrokeThickness="3" Opacity="0.45" IsHitTestVisible="False"><Ellipse.Effect><BlurEffect Radius="7"/></Ellipse.Effect></Ellipse>
    <Ellipse x:Name="HaloRing" Width="54" Height="54" StrokeThickness="1.8" IsHitTestVisible="False"><Ellipse.Stroke><LinearGradientBrush StartPoint="0,0" EndPoint="1,1"><GradientStop Color="#F0FEFF" Offset="0"/><GradientStop Color="#8FDCEB" Offset="0.5"/><GradientStop Color="#C7BDFA" Offset="1"/></LinearGradientBrush></Ellipse.Stroke></Ellipse>
    <Viewbox x:Name="TravelerEmblem" Width="28" Height="42" IsHitTestVisible="False">
     <Canvas Width="100" Height="150">
      <Path Data="M50,4 L31,55 5,73 29,91 18,132 50,148 82,132 71,91 95,73 69,55 Z" Fill="#30EBC77E" Stroke="#EBC77E" StrokeThickness="3.5" StrokeLineJoin="Round"><Path.Effect><DropShadowEffect Color="#EAC57B" BlurRadius="15" ShadowDepth="0" Opacity="0.7"/></Path.Effect></Path>
      <Path Data="M50,27 L50,51 M28,88 L72,88 M33,105 L67,105 M50,88 L50,128 M20,132 L80,132" Stroke="#EBC77E" StrokeThickness="3.5" StrokeStartLineCap="Round" StrokeEndLineCap="Round"/>
      <Ellipse Width="24" Height="24" Canvas.Left="38" Canvas.Top="58" Fill="#EBC77E"/>
     </Canvas>
    </Viewbox>
    <Ellipse x:Name="UnreadDot" Width="9" Height="9" Fill="#FFD49A" Stroke="#F8EBD7" StrokeThickness="1" HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,4,5,0" Visibility="Collapsed"/>
   </Grid>
  </Border>
 </StackPanel>
</Window>
'@
$window=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $markup))
$panel=$window.FindName('Panel'); $orb=$window.FindName('Orb'); $headline=$window.FindName('Headline'); $summary=$window.FindName('Summary')
$menuNews=$orb.ContextMenu.Items[0]; $menuLetters=$orb.ContextMenu.Items[1]; $menuSounds=$orb.ContextMenu.Items[3]; $menuExit=$orb.ContextMenu.Items[5]
$area=[Windows.SystemParameters]::WorkArea; $window.Left=$area.Right-102; $window.Top=$area.Bottom-176
function Update-WidgetSizing($area=[Windows.SystemParameters]::WorkArea) {
    # No DPI multiplier: WPF converts these logical units to pixels once.
    $window.MaxWidth=[Math]::Max(1,[Math]::Floor($area.Width)); $window.MaxHeight=[Math]::Max(1,[Math]::Floor($area.Height))
    $panel.Width=[Math]::Min(360,$window.MaxWidth)
    $panel.MaxHeight=[Math]::Max(0,$window.MaxHeight-$orb.Height-$panel.Margin.Bottom)
    if ($area.Height -lt 360) { $panel.Padding=[Windows.Thickness]::new(12) } else { $panel.Padding=[Windows.Thickness]::new(18) }
}
function Get-ClampedPosition([double]$left,[double]$top,[double]$width,[double]$height,[Windows.Rect]$area) {
    return [Windows.Point]::new([Math]::Max($area.Left,[Math]::Min($left,$area.Right-$width)),[Math]::Max($area.Top,[Math]::Min($top,$area.Bottom-$height)))
}
function Clamp-Window {
    $area=[Windows.SystemParameters]::WorkArea; Update-WidgetSizing $area; $window.UpdateLayout()
    $position=Get-ClampedPosition $window.Left $window.Top $window.ActualWidth $window.ActualHeight $area
    $window.Left=$position.X; $window.Top=$position.Y
}
Update-WidgetSizing
function Set-Expanded($value) {
    $right=$window.Left+$window.ActualWidth; $bottom=$window.Top+$window.ActualHeight; $script:expanded=[bool]$value
    if ($script:expanded) { $panel.Visibility='Visible' } else { $panel.Visibility='Collapsed'; Stop-Speech }
    Update-WidgetSizing; $window.UpdateLayout(); $window.Left=$right-$window.ActualWidth; $window.Top=$bottom-$window.ActualHeight; Clamp-Window
}
function Start-HaloPulse {
    if ($script:lastPulse -and ((Get-Date)-$script:lastPulse).TotalSeconds -lt 1) { return }
    $script:lastPulse=Get-Date
    $pulse=New-Object Windows.Media.Animation.DoubleAnimation
    $pulse.From=0.28; $pulse.To=0.95; $pulse.Duration=[TimeSpan]::FromSeconds(1.5); $pulse.AutoReverse=$true
    $pulse.RepeatBehavior=New-Object Windows.Media.Animation.RepeatBehavior 3; $pulse.FillBehavior='Stop'
    $ease=New-Object Windows.Media.Animation.SineEase; $ease.EasingMode='EaseInOut'; $pulse.EasingFunction=$ease
    $window.FindName('HaloGlow').BeginAnimation([Windows.UIElement]::OpacityProperty,$pulse)
    Play-Effect 'breath'
}
function Test-GenerationRunning {
    return ($script:state.generation.state -eq 'running' -or ($script:submissionAt -and ((Get-Date)-$script:submissionAt).TotalSeconds -lt 10))
}
function Update-DesktopContent {
    $context=[string]$script:state.contextKey
    if (-not $context) { $context=[string]$script:state.currentWorld+'|'+[string]$script:state.allowLetters }
    if ($script:lastContext -ne $context) {
        Stop-Speech; $script:lastContext=$context; $script:lastNews=''; $script:lastLetter=''; $script:pendingAck=''
        $window.FindName('InteractionStatus').Text=''
        if ($script:reader) { $script:reader.Close() }; if ($script:toast) { $script:toast.Close() }
    }
    $window.FindName('CurrentWorld').Text='当前世界 · '+[string]$script:state.currentWorld
    $window.FindName('CurrentWorld').ToolTip=$window.FindName('CurrentWorld').Text
    if ($script:state.news) {
        $headline.Text=[string]$script:state.news.headline; $summary.Text=[string]$script:state.news.summary
        $window.FindName('NewsDate').Text='虚构世界见闻 · '+[string]$script:state.news.source.day
    } else {
        $headline.Text='等待本次世界简报…'; $summary.Text='本次见闻准备好后，会在这里更新。'
        $window.FindName('NewsDate').Text='平行世界虚构见闻'
        if ($script:state.newsError) { $summary.Text=[string]$script:state.newsError }
    }
    $running=Test-GenerationRunning
    $window.FindName('Interfere').IsEnabled=([bool]$script:state.interactionAvailable -and -not $running)
    $window.FindName('Reply').IsEnabled=([bool]$script:state.interactionAvailable -and [bool]$script:state.allowLetters -and -not $running)
    if ($script:state.allowLetters) { $window.FindName('LetterTab').Visibility='Visible'; $window.FindName('Reply').Visibility='Visible' } else { $window.FindName('LetterTab').Visibility='Collapsed'; $window.FindName('Reply').Visibility='Collapsed'; Set-View 'news' }
    if ($running) { $window.FindName('InteractionStatus').Text='生成中，稍等' } elseif ($window.FindName('InteractionStatus').Text -eq '生成中，稍等') {
        if ($script:state.generation.error) { $window.FindName('InteractionStatus').Text='生成未完成：'+[string]$script:state.generation.error } else { $window.FindName('InteractionStatus').Text='本次制作已结束，见闻与来信会自动更新。' }
    }
    Update-Letter
    $window.FindName('InteractionStatus').ToolTip=$window.FindName('InteractionStatus').Text
    if ($script:expanded) { Set-Expanded $true }
}
function Fit-InteractionEditor($dialog,$area=[Windows.SystemParameters]::WorkArea) {
    $dialog.MaxWidth=[Math]::Max(1,$area.Width-16); $dialog.MaxHeight=[Math]::Max(1,$area.Height-16)
    $dialog.MinWidth=[Math]::Min(300,$dialog.MaxWidth); $dialog.MinHeight=[Math]::Min(240,$dialog.MaxHeight)
    $dialog.Width=[Math]::Min(470,$dialog.MaxWidth); $dialog.Height=[Math]::Min(350,$dialog.MaxHeight)
    $dialog.WindowStartupLocation='Manual'; $dialog.Left=$area.Left+($area.Width-$dialog.Width)/2; $dialog.Top=$area.Top+($area.Height-$dialog.Height)/2
}
function New-InteractionEditor($mode) {
    [xml]$editorMarkup=@'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="470" Height="350" MinWidth="300" MinHeight="240" ShowInTaskbar="False" Topmost="True" Background="#F4F7FA">
 <Grid Margin="20"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
  <TextBlock x:Name="EditorTitle" FontSize="17" FontWeight="SemiBold" Margin="0,0,0,12"/>
  <Grid Grid.Row="1" ClipToBounds="True"><TextBox x:Name="EditorText" AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" MaxLength="4000" Padding="10" FontSize="14"/><ScrollViewer x:Name="EditorHintScroll" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled" Margin="12" Focusable="False"><TextBlock x:Name="EditorHint" Foreground="#74808D" TextWrapping="Wrap" FontSize="14"/></ScrollViewer></Grid>
  <TextBlock x:Name="EditorStatus" Grid.Row="2" Text="输入1至4000字，提交后会制作本次世界的新壁纸。" TextWrapping="Wrap" Foreground="#526273" Margin="0,10,0,10"/>
  <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right"><Button x:Name="EditorCancel" Content="取消" Padding="16,7" Margin="0,0,8,0" IsCancel="True"/><Button x:Name="EditorSubmit" Content="提交" Padding="16,7"/></StackPanel>
 </Grid>
</Window>
'@
    $dialog=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $editorMarkup))
    $sourceIssueId=$script:state.news.source.issueId
    if (-not $sourceIssueId -and $script:state.latestLetter) { $sourceIssueId=$script:state.latestLetter.sourceIssueId }
    $dialog.Tag=@{Mode=$mode;SourceIssueId=$sourceIssueId;ContextKey=[string]$script:state.contextKey}
    if ($mode -eq 'reply') {
        $dialog.Title='旅行壁纸 · 回信'; $dialog.FindName('EditorTitle').Text='给角色回信'
        $dialog.FindName('EditorHint').Text='让您的角色给您带特产，或扶老奶奶过马路或毁灭世界，重启文明。'
    } else {
        $dialog.Title='旅行壁纸 · 干涉世界'; $dialog.FindName('EditorTitle').Text='干涉当前世界'
        $dialog.FindName('EditorHint').Text='您可以尽情发挥，比如做一个善良的上帝：选择帮奴隶们推翻暴君，或者邪恶的撒旦：让共富的高科技乌托邦世界倒退回奴隶制。'
    }
    $dialog.FindName('EditorText').Tag=$dialog
    $dialog.FindName('EditorHintScroll').Tag=$dialog
    $dialog.FindName('EditorHintScroll').Add_PreviewMouseLeftButtonDown({ $this.Tag.FindName('EditorText').Focus() | Out-Null })
    $dialog.Add_ContentRendered({ $this.FindName('EditorText').Focus() | Out-Null })
    $dialog.FindName('EditorText').Add_TextChanged({ if ($this.Text.Length -gt 0) { $this.Tag.FindName('EditorHint').Visibility='Collapsed'; $this.Tag.FindName('EditorHintScroll').Visibility='Collapsed' } else { $this.Tag.FindName('EditorHint').Visibility='Visible'; $this.Tag.FindName('EditorHintScroll').Visibility='Visible' } })
    $dialog.FindName('EditorSubmit').Tag=$dialog; $dialog.FindName('EditorSubmit').Add_Click({ Submit-Interaction $this.Tag })
    $dialog.FindName('EditorCancel').Tag=$dialog; $dialog.FindName('EditorCancel').Add_Click({ $this.Tag.Close() })
    Fit-InteractionEditor $dialog
    return $dialog
}
function Submit-Interaction($dialog) {
    $status=$dialog.FindName('EditorStatus'); $button=$dialog.FindName('EditorSubmit')
    $text=$dialog.FindName('EditorText').Text.Trim()
    if ($text.Length -lt 1 -or $text.Length -gt 4000) { $status.Text='请输入1至4000字。'; return }
    if (Test-GenerationRunning) { $status.Text='生成中，稍等'; return }
    if ($dialog.Tag.Mode -eq 'reply' -and -not $script:state.allowLetters) { $status.Text='观察模式没有角色可回信，可使用干涉世界。'; return }
    if ($dialog.Tag.ContextKey -ne [string]$script:state.contextKey) { $status.Text='世界或角色已切换，请关闭后重新输入。'; return }
    $button.IsEnabled=$false; $status.Text='正在提交…'
    try {
        $body=@{action='desktop-interaction';mode=$dialog.Tag.Mode;text=$text;contextKey=$dialog.Tag.ContextKey}
        if ($dialog.Tag.SourceIssueId) { $body.sourceIssueId=$dialog.Tag.SourceIssueId }
        Send-Action $body
        $script:submissionAt=Get-Date; $window.FindName('InteractionStatus').Text='生成中，稍等'
        Update-DesktopContent; $dialog.Close()
    } catch {
        $failure=$_
        $message='提交失败，请稍后重试。'
        try { $detail=$failure.ErrorDetails.Message | ConvertFrom-Json; if ($detail.error) { $message=[string]$detail.error } elseif ($detail.message) { $message=[string]$detail.message } } catch { }
        if ($failure.Exception.Response -and [int]$failure.Exception.Response.StatusCode -eq 409) { $message='正在生成或本次见闻已更新，请稍后重新打开再提交。' }
        $status.Text=$message; $button.IsEnabled=$true
    }
}
function Open-Interaction($mode) {
    if ((Test-GenerationRunning) -or -not $script:state.interactionAvailable) { $window.FindName('InteractionStatus').Text='生成中，稍等'; return }
    if ($mode -eq 'reply' -and -not $script:state.allowLetters) { return }
    if ($script:editor) { $script:editor.Activate() | Out-Null; return }
    Stop-Speech; Play-Effect 'click'; $script:editor=New-InteractionEditor $mode
    if ($window.IsVisible) { $script:editor.Owner=$window }
    try { [void]$script:editor.ShowDialog() } finally { $script:editor=$null }
}
function Update-Letter {
    $letter=$script:state.latestLetter
    if ($script:state.allowLetters -and $letter) {
        $window.FindName('LetterDate').Text=$letter.id+' · '+$letter.title
        $window.FindName('LetterText').Text=($letter.items | ForEach-Object { $_.world+[Environment]::NewLine+$_.text }) -join ([Environment]::NewLine+[Environment]::NewLine)
    } else { $window.FindName('LetterDate').Text='角色的旅行小便笺'; $window.FindName('LetterText').Text='本次世界还没有来信，准备好后会在这里更新。' }
}
function Set-View($name) {
    if ($name -eq 'letters' -and $script:state.allowLetters) {
        Stop-Speech; $window.FindName('NewsView').Visibility='Collapsed'; $window.FindName('LetterView').Visibility='Visible'
        $window.FindName('LetterTab').FontWeight='Bold'; $window.FindName('NewsTab').FontWeight='Normal'; Update-Letter
        if ($script:state.latestLetter) { try { Send-Action @{action='desktop-letter-read';id=$script:state.latestLetter.id}; $window.FindName('UnreadDot').Visibility='Collapsed' } catch { } }
    } else { $window.FindName('NewsView').Visibility='Visible'; $window.FindName('LetterView').Visibility='Collapsed'; $window.FindName('NewsTab').FontWeight='Bold'; $window.FindName('LetterTab').FontWeight='Normal' }
    if ($script:expanded) { Set-Expanded $true }
}
$orb.Add_MouseLeftButtonDown({
    $left=$window.Left; $top=$window.Top; try { $window.DragMove() } catch { }
    $clicked=([Math]::Abs($window.Left-$left) -lt 4 -and [Math]::Abs($window.Top-$top) -lt 4); Clamp-Window
    if ($clicked) { Play-Effect 'click'; Set-Expanded (-not $script:expanded) }
})
$window.FindName('Collapse').Add_Click({ Play-Effect 'click'; Set-Expanded $false })
$window.FindName('NewsTab').Add_Click({ Play-Effect 'click'; Set-View 'news' })
$window.FindName('LetterTab').Add_Click({ Play-Effect 'click'; Set-View 'letters' })
$window.FindName('Reply').Add_Click({ Open-Interaction 'reply' })
$window.FindName('Interfere').Add_Click({ Open-Interaction 'interfere' })
$menuNews.Add_Click({ Play-Effect 'click'; Set-View 'news'; Set-Expanded $true })
$menuLetters.Add_Click({ Play-Effect 'click'; Set-View 'letters'; Set-Expanded $true })
$menuSounds.Add_Click({ try { Send-Action @{action='desktop-sounds';enabled=[bool]$menuSounds.IsChecked}; $script:soundsEnabled=[bool]$menuSounds.IsChecked; Play-Effect 'click' } catch { $menuSounds.IsChecked=$script:soundsEnabled } })
$menuExit.Add_Click({ try { Play-Effect 'click'; Send-Action @{action='desktop-ball-off'}; $window.Hide(); Stop-Speech } catch { $summary.Text='退出暂未保存，请在DSH设置中关闭悬浮球。'; Set-Expanded $true } })
$window.FindName('Speak').Add_Click({
    if (-not $script:speaker) { $summary.Text+=[Environment]::NewLine+'本机暂未提供可用语音，仍可阅读文字。'; return }
    if ($script:speaker.State -eq 'Speaking') { Stop-Speech } else { Play-Effect 'click'; try { [void]$script:speaker.SpeakAsync(($headline.Text+'。'+$summary.Text)) } catch { $summary.Text+=[Environment]::NewLine+'朗读暂不可用。' } }
})
function Fit-LetterWindow([Windows.Window]$target,[double]$preferredWidth,[double]$preferredHeight,$area,$anchor='center') {
    # Bounds, margins and chrome are all in DIPs, as for the main panel/editor.
    $target.MaxWidth=[Math]::Max(1.0,[Math]::Floor($area.Width-16)); $target.MaxHeight=[Math]::Max(1.0,[Math]::Floor($area.Height-16))
    $target.MinWidth=[Math]::Min(240.0,$target.MaxWidth); $target.MinHeight=[Math]::Min(170.0,$target.MaxHeight)
    $target.Width=[Math]::Min($preferredWidth,$target.MaxWidth); $target.Height=[Math]::Min($preferredHeight,$target.MaxHeight)
    $target.WindowStartupLocation='Manual'
    if ($anchor -eq 'bottom-right') { $target.Left=$area.Right-$target.Width-8; $target.Top=$area.Bottom-$target.Height-8 } else { $target.Left=$area.Left+($area.Width-$target.Width)/2; $target.Top=$area.Top+($area.Height-$target.Height)/2 }
}
function New-LetterReader($letter,$area=[Windows.SystemParameters]::WorkArea) {
    $reader=New-Object Windows.Window; $reader.Title='旅行壁纸 · 今日来信'; $reader.Width=420; $reader.Height=390; $reader.Topmost=$true; $reader.WindowStartupLocation='CenterScreen'
    $scroll=New-Object Windows.Controls.ScrollViewer; $scroll.VerticalScrollBarVisibility='Auto'; $scroll.HorizontalScrollBarVisibility='Disabled'
    $text=New-Object Windows.Controls.TextBlock; $text.Margin='22'; $text.TextWrapping='Wrap'; $text.FontSize=16; $text.LineHeight=28
    $text.Text=($letter.items | ForEach-Object { $_.world+[Environment]::NewLine+$_.text }) -join ([Environment]::NewLine+[Environment]::NewLine)
    $scroll.Content=$text; $reader.Content=$scroll
    $reader.Add_Closed({ param($sender,$eventArgs) if ($script:reader -eq $sender) { $script:reader=$null } })
    Fit-LetterWindow $reader 420 390 $area
    return $reader
}
function New-LetterToast($letter,$area=[Windows.SystemParameters]::WorkArea) {
    $toast=New-Object Windows.Window; $toast.Title='旅行壁纸 · 收到来信'; $toast.Width=330; $toast.Height=170; $toast.WindowStyle='ToolWindow'; $toast.ShowInTaskbar=$false; $toast.Topmost=$true; $toast.ShowActivated=$false; $toast.ResizeMode='NoResize'
    $toast.Left=$area.Right-350; $toast.Top=$area.Bottom-190
    $stack=New-Object Windows.Controls.Grid; $stack.Margin='16'
    foreach ($height in @('Auto','*','Auto')) { $row=New-Object Windows.Controls.RowDefinition; $row.Height=$height; $stack.RowDefinitions.Add($row) }
    $title=New-Object Windows.Controls.TextBlock; $title.Text='旅行角色寄来了一封信'; $title.FontSize=16; $title.FontWeight='Bold'; $title.TextWrapping='Wrap'; $stack.Children.Add($title) | Out-Null
    $hint=New-Object Windows.Controls.TextBlock; $hint.Text=$letter.items[0].text; $hint.TextWrapping='Wrap'; $hint.TextTrimming='CharacterEllipsis'; $hint.MaxHeight=55; $hint.Margin='0,8,0,8'; [Windows.Controls.Grid]::SetRow($hint,1); $stack.Children.Add($hint) | Out-Null
    $button=New-Object Windows.Controls.Button; $button.Content='读信'; $button.Tag=$letter; $button.Add_Click({ Open-Letter $this.Tag; if ($script:toast) { $script:toast.Close() } }); [Windows.Controls.Grid]::SetRow($button,2); $stack.Children.Add($button) | Out-Null
    $toast.Content=$stack; $toast.Add_Closed({ param($sender,$eventArgs) if ($script:toast -eq $sender) { $script:toast=$null } })
    Fit-LetterWindow $toast 330 170 $area 'bottom-right'
    return $toast
}
function Open-Letter($letter) {
    Play-Effect 'click'
    if ($script:state.newsBallEnabled) { $script:state.latestLetter=$letter; Set-View 'letters'; Set-Expanded $true } else {
        if ($script:reader) { $script:reader.Close() }
        $script:reader=New-LetterReader $letter; $script:reader.Show()
    }
    try { Send-Action @{action='desktop-letter-read';id=$letter.id} } catch { }
}
function Show-Letter($letter) {
    if ($script:toast) { $script:toast.Close() }
    $script:toast=New-LetterToast $letter; $script:toast.Show(); Start-HaloPulse
    $expiry=New-Object Windows.Threading.DispatcherTimer; $expiry.Interval=[TimeSpan]::FromSeconds(15); $expiry.Tag=$script:toast; $expiry.Add_Tick({ $this.Stop(); $this.Tag.Close() }); $expiry.Start()
}
$timer=New-Object Windows.Threading.DispatcherTimer; $timer.Interval=[TimeSpan]::FromSeconds(3)
$timer.Add_Tick({
    try {
        $script:state=Invoke-RestMethod -Uri ($endpoint+'?desktop') -Headers $headers -TimeoutSec 2
        if ($script:state.generation.state -eq 'running') { $script:submissionAt=$null }
        $script:failures=0; $script:soundsEnabled=[bool]$script:state.widgetSoundsEnabled; $menuSounds.IsChecked=$script:soundsEnabled
        $menuLetters.IsEnabled=[bool]$script:state.allowLetters
        Update-DesktopContent
        if ($script:state.newsBallEnabled) { if (-not $window.IsVisible) { $window.Show(); $window.UpdateLayout(); Clamp-Window } } else { $window.Hide(); Stop-Speech }
        if ($script:state.news) { $newsKey=[string]$script:state.news.source.issueId+'|'+[string]$script:state.news.headline; if ($newsKey -ne $script:lastNews) { $script:lastNews=$newsKey; if ($script:state.newsBallEnabled) { Start-HaloPulse } } }
        if ($script:state.allowLetters -and $script:state.latestLetter -and -not $script:state.latestLetter.readAt -and $script:state.latestLetter.id -ne $script:lastUnreadLetter) { $script:lastUnreadLetter=$script:state.latestLetter.id; if ($script:state.newsBallEnabled) { Start-HaloPulse } }
        if ($script:state.allowLetters -and $script:state.latestLetter -and -not $script:state.latestLetter.readAt) { $window.FindName('UnreadDot').Visibility='Visible' } else { $window.FindName('UnreadDot').Visibility='Collapsed' }
        if ($script:state.lettersEnabled -and $script:state.letter -and $script:lastLetter -ne $script:state.letter.id) { Show-Letter $script:state.letter; $script:lastLetter=$script:state.letter.id; $script:pendingAck=$script:state.letter.id }
        if ($script:pendingAck -and $script:state.lettersEnabled) { try { Send-Action @{action='desktop-letter-ack';id=$script:pendingAck}; $script:pendingAck='' } catch { } }
        if (-not $script:state.lettersEnabled) { $script:pendingAck=''; if ($script:toast) { $script:toast.Close() }; if ($script:reader) { $script:reader.Close() } }
        if (-not $script:state.newsBallEnabled -and -not $script:state.lettersEnabled) { $script:shuttingDown=$true; Stop-Speech; $window.Close(); [Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() }
    } catch { $script:failures++; if ($script:failures -ge 5) { $script:shuttingDown=$true; Stop-Speech; $window.Close(); [Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() } }
})
$window.Add_Closing({ param($sender,$eventArgs) if (-not $script:shuttingDown) { $eventArgs.Cancel=$true; $window.Hide(); Stop-Speech; try { Send-Action @{action='desktop-ball-off'} } catch { } } })
$timer.Start()
Write-Output 'travel-widget-ready'
try { [Windows.Threading.Dispatcher]::Run() } finally { Stop-Speech; if ($script:speaker) { $script:speaker.Dispose() }; foreach ($player in $script:effects.Values) { $player.Dispose() } }
