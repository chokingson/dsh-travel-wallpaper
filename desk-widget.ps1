$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$endpoint = $env:TRAVEL_WIDGET_URL
$secret = $env:TRAVEL_WIDGET_KEY
if (-not $endpoint -or -not $secret) { exit 1 }
$headers = @{ 'x-travel-widget-key' = $secret; Origin = ([uri]$endpoint).GetLeftPart([System.UriPartial]::Authority) }
$script:failures = 0
$script:expanded = $false
$script:reader = $null
$script:toast = $null
$script:lastLetter = ''
$script:speaker = $null
try { Add-Type -AssemblyName System.Speech; $script:speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer } catch { }
function Send-Action($body) {
    Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))) -TimeoutSec 3 | Out-Null
}
[xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="旅行壁纸 · 世界简报" WindowStyle="None" AllowsTransparency="True" Background="Transparent" ShowInTaskbar="False" Topmost="True" ShowActivated="False" ResizeMode="NoResize" SizeToContent="WidthAndHeight">
 <StackPanel>
  <Border x:Name="Panel" Width="340" Background="#F51B2230" BorderBrush="#6685C8" BorderThickness="1" CornerRadius="16" Padding="18" Margin="0,0,0,10" Visibility="Collapsed">
   <StackPanel>
    <TextBlock Text="世界简报" FontSize="18" FontWeight="Bold" Foreground="White"/>
    <TextBlock x:Name="NewsDate" Text="平行世界虚构见闻" Foreground="#AAB8D1" FontSize="11" Margin="0,5,0,14"/>
    <TextBlock x:Name="Headline" Text="等待本次世界简报…" FontSize="16" FontWeight="SemiBold" Foreground="White" TextWrapping="Wrap"/>
    <ScrollViewer MaxHeight="240" VerticalScrollBarVisibility="Auto" Margin="0,12,0,12"><TextBlock x:Name="Summary" Foreground="#E0E6F2" FontSize="14" TextWrapping="Wrap" LineHeight="23"/></ScrollViewer>
    <StackPanel Orientation="Horizontal"><Button x:Name="Speak" Content="朗读 / 停止" Padding="9,5" Margin="0,0,8,0"/><Button x:Name="CloseBall" Content="关闭悬浮球" Padding="9,5"/></StackPanel>
    <TextBlock Text="按住小球拖动；点击展开或收起" Foreground="#AAB8D1" FontSize="11" Margin="0,12,0,0"/>
   </StackPanel>
  </Border>
  <Border x:Name="Orb" Width="54" Height="54" CornerRadius="27" Background="#315EC9" BorderBrush="#AAC5FF" BorderThickness="1" HorizontalAlignment="Right" Cursor="Hand" ToolTip="旅行壁纸：点开世界简报，按住拖动">
   <Grid><TextBlock Text="旅" FontSize="22" Foreground="White" VerticalAlignment="Center" HorizontalAlignment="Center"/></Grid>
  </Border>
 </StackPanel>
</Window>
'@
$window = [Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $markup))
$panel = $window.FindName('Panel'); $orb = $window.FindName('Orb')
$headline = $window.FindName('Headline'); $summary = $window.FindName('Summary')
$area = [Windows.SystemParameters]::WorkArea
$window.Left = $area.Right - 90; $window.Top = $area.Bottom - 170
function Stop-Speech { if ($script:speaker) { $script:speaker.SpeakAsyncCancelAll() } }
function Clamp-Window { $area = [Windows.SystemParameters]::WorkArea; $window.Left = [Math]::Max($area.Left,[Math]::Min($window.Left,$area.Right-$window.ActualWidth)); $window.Top = [Math]::Max($area.Top,[Math]::Min($window.Top,$area.Bottom-$window.ActualHeight)) }
$orb.Add_MouseLeftButtonDown({
    $left = $window.Left; $top = $window.Top
    try { $window.DragMove() } catch { }
    if ([Math]::Abs($window.Left-$left) -lt 4 -and [Math]::Abs($window.Top-$top) -lt 4) {
        $right = $window.Left + $window.ActualWidth; $bottom = $window.Top + $window.ActualHeight
        $script:expanded = -not $script:expanded
        if ($script:expanded) { $panel.Visibility = 'Visible' } else { $panel.Visibility = 'Collapsed'; Stop-Speech }
        $window.UpdateLayout(); $window.Left = $right-$window.ActualWidth; $window.Top = $bottom-$window.ActualHeight; Clamp-Window
    }
})
$window.FindName('CloseBall').Add_Click({ try { Send-Action @{action='desktop-ball-off'}; $window.Hide(); Stop-Speech } catch { $summary.Text = '暂时无法关闭，请在DSH设置中关闭悬浮球。' } })
$window.FindName('Speak').Add_Click({
    if (-not $script:speaker) { $summary.Text += "`n本机暂未提供可用语音，仍可阅读文字。"; return }
    if ($script:speaker.State -eq 'Speaking') { Stop-Speech } else { [void]$script:speaker.SpeakAsync(($headline.Text + '。' + $summary.Text)) }
})
function Open-Letter($letter) {
    if ($script:reader) { $script:reader.Close() }
    $script:reader = New-Object Windows.Window
    $script:reader.Title = '旅行壁纸 · 今日来信'; $script:reader.Width = 420; $script:reader.Height = 390; $script:reader.Topmost = $true; $script:reader.WindowStartupLocation = 'CenterScreen'
    $scroll = New-Object Windows.Controls.ScrollViewer; $scroll.VerticalScrollBarVisibility = 'Auto'
    $text = New-Object Windows.Controls.TextBlock; $text.Margin = '22'; $text.TextWrapping = 'Wrap'; $text.FontSize = 16; $text.LineHeight = 28
    $text.Text = ($letter.items | ForEach-Object { $_.world + "`n" + $_.text }) -join "`n`n"
    $scroll.Content = $text; $script:reader.Content = $scroll; $script:reader.Add_Closed({$script:reader=$null}); $script:reader.Show()
    try { Send-Action @{action='desktop-letter-read';id=$letter.id} } catch { }
}
function Show-Letter($letter) {
    if ($script:toast) { $script:toast.Close() }
    $script:toast = New-Object Windows.Window
    $script:toast.Title = '旅行壁纸 · 收到来信'; $script:toast.Width = 330; $script:toast.Height = 170; $script:toast.WindowStyle = 'ToolWindow'; $script:toast.ShowInTaskbar = $false; $script:toast.Topmost = $true; $script:toast.ShowActivated = $false; $script:toast.ResizeMode = 'NoResize'
    $area = [Windows.SystemParameters]::WorkArea; $script:toast.Left = $area.Right-350; $script:toast.Top = $area.Bottom-190
    $stack = New-Object Windows.Controls.StackPanel; $stack.Margin = '16'
    $title = New-Object Windows.Controls.TextBlock; $title.Text = '旅行角色寄来了一封信'; $title.FontSize = 16; $title.FontWeight = 'Bold'; $stack.Children.Add($title) | Out-Null
    $hint = New-Object Windows.Controls.TextBlock; $hint.Text = $letter.items[0].text; $hint.TextWrapping = 'Wrap'; $hint.MaxHeight = 55; $hint.Margin = '0,8,0,8'; $stack.Children.Add($hint) | Out-Null
    $button = New-Object Windows.Controls.Button; $button.Content = '读信'; $button.Tag = $letter
    $button.Add_Click({ Open-Letter $this.Tag; if ($script:toast) { $script:toast.Close() } }); $stack.Children.Add($button) | Out-Null
    $script:toast.Content = $stack; $script:toast.Show()
    $expiry = New-Object Windows.Threading.DispatcherTimer; $expiry.Interval = [TimeSpan]::FromSeconds(15); $expiry.Tag = $script:toast
    $expiry.Add_Tick({ $this.Stop(); $this.Tag.Close() }); $expiry.Start()
}
$timer = New-Object Windows.Threading.DispatcherTimer; $timer.Interval = [TimeSpan]::FromSeconds(3)
$timer.Add_Tick({
    try {
        $state = Invoke-RestMethod -Uri ($endpoint+'?desktop') -Headers $headers -TimeoutSec 2
        $script:failures = 0
        if ($state.newsBallEnabled) { if (-not $window.IsVisible) { $window.Show(); $window.UpdateLayout(); Clamp-Window } } else { $window.Hide(); Stop-Speech }
        if ($state.news) { $headline.Text = $state.news.headline; $summary.Text = $state.news.summary; if ($state.news.source.day) { $window.FindName('NewsDate').Text = '虚构世界见闻 · 旅行日期 ' + $state.news.source.day } } elseif ($state.newsError) { $summary.Text = $state.newsError }
        if ($state.lettersEnabled -and $state.letter -and $script:lastLetter -ne $state.letter.id) {
            Show-Letter $state.letter; $script:lastLetter = $state.letter.id
            try { Send-Action @{action='desktop-letter-ack';id=$state.letter.id} } catch { }
        }
        if (-not $state.lettersEnabled) { if ($script:toast) { $script:toast.Close() }; if ($script:reader) { $script:reader.Close() } }
        if (-not $state.newsBallEnabled -and -not $state.lettersEnabled) { $window.Close(); [Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() }
    } catch { $script:failures++; if ($script:failures -ge 5) { Stop-Speech; $window.Close(); [Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() } }
})
$window.Add_Closing({ param($sender,$eventArgs) $eventArgs.Cancel = $true; $window.Hide(); Stop-Speech; try { Send-Action @{action='desktop-ball-off'} } catch { } })
$timer.Start()
Write-Output 'travel-widget-ready'
[Windows.Threading.Dispatcher]::Run()
