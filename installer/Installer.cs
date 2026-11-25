// Bộ cài eGovAI — giao diện WPF theo thiết kế "Bộ cài eGovAI".
// Biên dịch bằng csc.exe của .NET Framework 4.x (C# 5), xem installer/build-installer.ps1.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;

// Thông tin phiên bản/công ty (AssemblyCompany, AssemblyFileVersion…) được build-installer.ps1 sinh ra
// từ package.json vào build\AssemblyInfo.Installer.cs và biên dịch cùng tệp này.

namespace EGovAISetup
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { LogCrash(e.ExceptionObject as Exception); };
            try { return Run(args); }
            catch (Exception ex) { LogCrash(ex); return 3; }
        }

        internal static bool Quiet;

        internal static void LogCrash(Exception ex)
        {
            try
            {
                string log = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "eGovAI-Setup.log");
                File.AppendAllText(log, DateTime.Now.ToString("s") + "  " + ex + Environment.NewLine);
                if (Quiet) { Environment.Exit(3); return; }
                MessageBox.Show("Trình cài đặt gặp lỗi:\n" + (ex != null ? ex.Message : "?") + "\n\nChi tiết: " + log, "Cài đặt eGovAI", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            catch { }
        }

        private static int Run(string[] args)
        {
            var app = new Application();
            app.DispatcherUnhandledException += delegate(object s, DispatcherUnhandledExceptionEventArgs e) { LogCrash(e.Exception); e.Handled = true; };
            app.ShutdownMode = ShutdownMode.OnMainWindowClose;
            Window win;
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Installer.xaml"))
            {
                win = (Window)XamlReader.Load(s);
            }
            try
            {
                using (var ico = Assembly.GetExecutingAssembly().GetManifestResourceStream("egovai.ico"))
                {
                    win.Icon = BitmapFrame.Create(ico, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                }
            }
            catch { }
            var controller = new SetupController(win, args);
            GC.KeepAlive(controller);
            return app.Run(win);
        }
    }

    internal sealed class SetupController
    {
        private const string AppName = "eGovAI";
        private static readonly string AppVersion = ReadAppVersion();
        private static string ReadAppVersion()
        {
            var a = (AssemblyInformationalVersionAttribute)Attribute.GetCustomAttribute(Assembly.GetExecutingAssembly(), typeof(AssemblyInformationalVersionAttribute));
            return a != null && !string.IsNullOrEmpty(a.InformationalVersion) ? a.InformationalVersion : "0.1.0";
        }
        private const string Publisher = "Nhóm phát triển eGovAI";
        private const string ExeName = "eGovAI.exe";
        private const string UninstallExeName = "Uninstall eGovAI.exe";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\eGovAI";

        private enum Page { License = 0, Folder = 1, Installing = 2, Finished = 3 }
        private enum InstallState { Idle, Running, Paused, Cancelling, Done, Failed }

        private readonly Window win;
        private readonly bool elevated;
        private Page page;
        private InstallState state = InstallState.Idle;

        // Phần tử giao diện
        private TextBlock headTitle, headSub, progLabel, progPct, progPath, counter, spaceInfo, licenseText, footOptText;
        private Rectangle progFill;
        private StackPanel stepList, dots, doneNote, progPanel;
        private Border pageLicense, pageFolder, stage;
        private TextBox dirBox;
        private CheckBox footOpt, chkDesktop, chkStart;
        private Button btnBack, btnNext, btnCancel, btnBrowse;
        private readonly List<FrameworkElement> slides = new List<FrameworkElement>();
        private readonly List<Button> dotButtons = new List<Button>();

        // Băng chuyền giới thiệu
        private int slideIndex;
        private readonly DispatcherTimer slideTimer;

        // Tiến trình cài đặt (luồng nền ghi, luồng giao diện đọc)
        private readonly DispatcherTimer uiTimer;
        private readonly ManualResetEvent pauseGate = new ManualResetEvent(true);
        private volatile bool cancelRequested;
        private long bytesDone, bytesTotal = 1;
        private volatile string curLabel = "Đang chuẩn bị…";
        private volatile string curPath = "";
        private volatile string failMessage;
        private string installDir;
        private bool dirExistedBefore;
        private bool licenseAccepted;
        private bool launchAfter = true;
        private bool silent;

        public SetupController(Window w, string[] args)
        {
            win = w;
            elevated = IsElevated();
            Bind();

            installDir = DefaultInstallDir();
            string argDir = GetArg(args, "/dir=");
            if (!string.IsNullOrEmpty(argDir)) installDir = argDir;
            dirBox.Text = installDir;
            if (HasArg(args, "/nodesktop")) chkDesktop.IsChecked = false;
            if (HasArg(args, "/nostartmenu")) chkStart.IsChecked = false;

            licenseText.Text = LicenseBody;
            BuildSteps();
            BuildDots();
            StartSealRotation();

            slideTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(7) };
            slideTimer.Tick += delegate { ShowSlide((slideIndex + 1) % slides.Count, true); };

            uiTimer = new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(70) };
            uiTimer.Tick += delegate { RefreshProgress(); };

            // Chế độ kiểm thử: vẽ từng màn hình ra PNG rồi thoát (không cài đặt gì).
            string snap = GetArg(args, "/snapshot=");
            if (!string.IsNullOrEmpty(snap))
            {
                Program.Quiet = true;
                win.WindowStartupLocation = WindowStartupLocation.Manual;
                win.Left = -20000; win.Top = -20000; win.ShowActivated = false; win.ShowInTaskbar = false;
                GoTo(Page.License);
                win.ContentRendered += delegate { RunSnapshots(snap); };
                return;
            }

            // Cài đặt im lặng (dành cho triển khai hàng loạt): /S [/dir=...] [/nodesktop] [/nostartmenu]
            if (HasArg(args, "/S"))
            {
                Program.Quiet = true;
                silent = true;
                win.WindowStartupLocation = WindowStartupLocation.Manual;
                win.Left = -20000; win.Top = -20000; win.ShowActivated = false; win.ShowInTaskbar = false;
                licenseAccepted = true;
                launchAfter = false;
                if (!string.IsNullOrEmpty(argDir)) installDir = System.IO.Path.GetFullPath(argDir);
                GoTo(Page.Installing);
                win.ContentRendered += delegate { StartInstall(); };
                return;
            }

            // Tiến trình nâng quyền: đi thẳng vào bước cài đặt với thư mục đã chọn.
            if (HasArg(args, "/elevated") && !string.IsNullOrEmpty(argDir))
            {
                licenseAccepted = true;
                GoTo(Page.Installing);
                win.ContentRendered += delegate { StartInstall(); };
            }
            else
            {
                GoTo(Page.License);
            }
        }

        // ───────────────────────── Liên kết giao diện ─────────────────────────
        private T F<T>(string name) where T : class { return (T)win.FindName(name); }

        private void Bind()
        {
            headTitle = F<TextBlock>("HeadTitle"); headSub = F<TextBlock>("HeadSub");
            progLabel = F<TextBlock>("ProgLabel"); progPct = F<TextBlock>("ProgPct"); progPath = F<TextBlock>("ProgPath");
            progFill = F<Rectangle>("ProgFill"); progPanel = F<StackPanel>("ProgPanel"); doneNote = F<StackPanel>("DoneNote");
            counter = F<TextBlock>("Counter"); spaceInfo = F<TextBlock>("SpaceInfo"); licenseText = F<TextBlock>("LicenseText");
            stepList = F<StackPanel>("StepList"); dots = F<StackPanel>("Dots");
            pageLicense = F<Border>("PageLicense"); pageFolder = F<Border>("PageFolder"); stage = F<Border>("Stage");
            dirBox = F<TextBox>("DirBox");
            footOpt = F<CheckBox>("FootOpt"); footOptText = F<TextBlock>("FootOptText");
            chkDesktop = F<CheckBox>("ChkDesktop"); chkStart = F<CheckBox>("ChkStart");
            btnBack = F<Button>("BtnBack"); btnNext = F<Button>("BtnNext"); btnCancel = F<Button>("BtnCancel"); btnBrowse = F<Button>("BtnBrowse");
            for (int i = 0; i < 5; i++) slides.Add(F<FrameworkElement>("Slide" + i));

            F<Grid>("TitleBar").MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) win.DragMove(); };
            F<Button>("BtnMin").Click += delegate { win.WindowState = WindowState.Minimized; };
            F<Button>("BtnClose").Click += delegate { OnCloseRequested(); };
            win.Closing += OnWindowClosing;

            btnBack.Click += delegate { OnBack(); };
            btnNext.Click += delegate { OnNext(); };
            btnCancel.Click += delegate { OnCancel(); };
            btnBrowse.Click += delegate { BrowseFolder(); };
            footOpt.Click += delegate { OnFootOptChanged(); };
            dirBox.TextChanged += delegate { UpdateSpaceInfo(); };
            stage.MouseEnter += delegate { slideTimer.Stop(); };
            stage.MouseLeave += delegate { if (page >= Page.Installing) slideTimer.Start(); };
        }

        // ───────────────────────── Cột trái: các bước ─────────────────────────
        private static readonly string[] StepNames = { "Điều khoản giấy phép", "Thư mục cài đặt", "Cài đặt", "Hoàn tất" };

        private void BuildSteps()
        {
            stepList.Children.Clear();
            for (int i = 0; i < StepNames.Length; i++)
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
                var marker = new Grid { Width = 14, Height = 14, VerticalAlignment = VerticalAlignment.Center };
                row.Children.Add(marker);
                row.Children.Add(new TextBlock { Text = StepNames[i], FontSize = 12.5, Margin = new Thickness(9, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
                stepList.Children.Add(row);
            }
        }

        private void UpdateSteps()
        {
            var red = Brush("#B3121B");
            for (int i = 0; i < stepList.Children.Count; i++)
            {
                var row = (StackPanel)stepList.Children[i];
                var marker = (Grid)row.Children[0];
                var text = (TextBlock)row.Children[1];
                marker.Children.Clear();
                bool done = i < (int)page || page == Page.Finished;
                bool now = i == (int)page && page != Page.Finished;
                if (done)
                {
                    marker.Children.Add(new Border { Background = red });
                    marker.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M3,7.2 L5.8,10 L11,4.2"), Stroke = Brushes.White, StrokeThickness = 1.6 });
                    text.Foreground = Brush("#161B26"); text.FontWeight = FontWeights.Normal;
                }
                else if (now)
                {
                    marker.Children.Add(new Border { BorderBrush = red, BorderThickness = new Thickness(1.5), Background = Brushes.White });
                    marker.Children.Add(new Border { Background = red, Margin = new Thickness(4) });
                    text.Foreground = Brush("#161B26"); text.FontWeight = FontWeights.SemiBold;
                }
                else
                {
                    marker.Children.Add(new Border { BorderBrush = Brush("#8A92A3"), BorderThickness = new Thickness(1.5) });
                    text.Foreground = Brush("#8A92A3"); text.FontWeight = FontWeights.Normal;
                }
            }
        }

        private void StartSealRotation()
        {
            var rot = (RotateTransform)win.FindName("SealRotate");
            var anim = new DoubleAnimation(0, 360, new Duration(TimeSpan.FromSeconds(24))) { RepeatBehavior = RepeatBehavior.Forever };
            rot.BeginAnimation(RotateTransform.AngleProperty, anim);
        }

        // ───────────────────────── Băng chuyền ─────────────────────────
        private void BuildDots()
        {
            for (int i = 0; i < slides.Count; i++)
            {
                int idx = i;
                var b = new Button { Style = (Style)win.FindResource("Dot"), ToolTip = "Trang " + (i + 1) };
                b.Click += delegate { ShowSlide(idx, true); slideTimer.Stop(); slideTimer.Start(); };
                dotButtons.Add(b);
                dots.Children.Add(b);
            }
            ShowSlide(0, false);
        }

        private void ShowSlide(int idx, bool animate)
        {
            slideIndex = idx;
            for (int i = 0; i < slides.Count; i++)
            {
                slides[i].Visibility = i == idx ? Visibility.Visible : Visibility.Collapsed;
                dotButtons[i].Background = i == idx ? Brush("#B3121B") : Brush("#668A92A3");
            }
            counter.Text = (idx + 1) + " / " + slides.Count;
            if (animate)
            {
                var el = slides[idx];
                el.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, new Duration(TimeSpan.FromMilliseconds(320))));
                var tt = new TranslateTransform();
                el.RenderTransform = tt;
                tt.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(10, 0, new Duration(TimeSpan.FromMilliseconds(320))) { EasingFunction = new CubicEase() });
            }
        }

        // ───────────────────────── Điều hướng ─────────────────────────
        private void GoTo(Page p)
        {
            page = p;
            pageLicense.Visibility = p == Page.License ? Visibility.Visible : Visibility.Collapsed;
            pageFolder.Visibility = p == Page.Folder ? Visibility.Visible : Visibility.Collapsed;
            stage.Visibility = p >= Page.Installing ? Visibility.Visible : Visibility.Collapsed;
            progPanel.Visibility = p >= Page.Installing ? Visibility.Visible : Visibility.Collapsed;
            doneNote.Visibility = p == Page.Finished ? Visibility.Visible : Visibility.Collapsed;
            progPath.Visibility = p == Page.Finished ? Visibility.Collapsed : Visibility.Visible;
            if (p >= Page.Installing) slideTimer.Start(); else slideTimer.Stop();

            switch (p)
            {
                case Page.License:
                    headTitle.Text = "Điều khoản giấy phép";
                    headSub.Text = "Vui lòng đọc kỹ các điều khoản dưới đây trước khi cài đặt eGovAI " + AppVersion + " lên máy tính của bạn.";
                    SetFootOpt("Tôi đồng ý với các điều khoản giấy phép", licenseAccepted);
                    SetButtons(false, "Tiếp tục", licenseAccepted, "Hủy", true);
                    break;
                case Page.Folder:
                    headTitle.Text = "Chọn thư mục cài đặt";
                    headSub.Text = "Trình cài đặt sẽ chép eGovAI vào thư mục dưới đây. Bấm “Duyệt…” để chọn nơi khác.";
                    footOpt.Visibility = Visibility.Hidden;
                    SetButtons(true, "Cài đặt", true, "Hủy", true);
                    UpdateSpaceInfo();
                    break;
                case Page.Installing:
                    headTitle.Text = "Đang cài đặt eGovAI";
                    headSub.Text = "Quá trình mất khoảng một phút. Trong lúc chờ, mời bạn làm quen với những người làm ra ứng dụng.";
                    footOpt.Visibility = Visibility.Hidden;
                    SetButtons(false, "Tiếp tục", false, "Hủy", true);
                    break;
                case Page.Finished:
                    headTitle.Text = "Đã cài đặt xong eGovAI";
                    headSub.Text = "Cảm ơn bạn đã chọn eGovAI. Nhóm phát triển mong ứng dụng giúp công việc hằng ngày nhẹ nhàng hơn.";
                    SetFootOpt("Mở eGovAI sau khi đóng trình cài đặt", launchAfter);
                    SetButtons(false, "Hoàn tất", true, "Cài lại", true);
                    progLabel.Text = "Hoàn tất"; progPct.Text = "100%";
                    SetFill(1.0);
                    break;
            }
            UpdateSteps();
        }

        private void SetButtons(bool back, string next, bool nextEnabled, string cancel, bool cancelEnabled)
        {
            btnBack.IsEnabled = back;
            btnNext.Content = next; btnNext.IsEnabled = nextEnabled;
            btnCancel.Content = cancel; btnCancel.IsEnabled = cancelEnabled;
        }

        private void SetFootOpt(string text, bool isChecked)
        {
            footOptText.Text = text;
            footOpt.IsChecked = isChecked;
            footOpt.Visibility = Visibility.Visible;
        }

        private void OnFootOptChanged()
        {
            bool v = footOpt.IsChecked == true;
            if (page == Page.License) { licenseAccepted = v; btnNext.IsEnabled = v; }
            else if (page == Page.Finished) launchAfter = v;
        }

        private void OnBack()
        {
            if (page == Page.Folder) GoTo(Page.License);
        }

        private void OnNext()
        {
            switch (page)
            {
                case Page.License:
                    if (licenseAccepted) GoTo(Page.Folder);
                    break;
                case Page.Folder:
                    BeginInstallFromFolderPage();
                    break;
                case Page.Installing:
                    if (state == InstallState.Paused) Resume();
                    break;
                case Page.Finished:
                    Finish();
                    break;
            }
        }

        private void OnCancel()
        {
            switch (page)
            {
                case Page.License:
                case Page.Folder:
                    if (Ask("Bạn có muốn thoát trình cài đặt eGovAI?")) { allowClose = true; win.Close(); }
                    break;
                case Page.Installing:
                    if (state == InstallState.Running) Pause();
                    else if (state == InstallState.Paused) CancelInstall();
                    else if (state == InstallState.Failed) { allowClose = true; win.Close(); }
                    break;
                case Page.Finished:
                    // "Cài lại": chạy lại quá trình cài đặt từ đầu.
                    GoTo(Page.Installing);
                    StartInstall();
                    break;
            }
        }

        private bool allowClose;
        private void OnCloseRequested()
        {
            if (page == Page.Installing && (state == InstallState.Running || state == InstallState.Paused))
            {
                if (state == InstallState.Running) Pause();
                if (Ask("Hủy cài đặt eGovAI? Các tệp đã chép sẽ được xóa.")) CancelInstall(); else Resume();
                return;
            }
            allowClose = true;
            win.Close();
        }

        private void OnWindowClosing(object sender, CancelEventArgs e)
        {
            if (allowClose) return;
            if (page == Page.Installing && (state == InstallState.Running || state == InstallState.Paused || state == InstallState.Cancelling))
            {
                e.Cancel = true;
                OnCloseRequested();
            }
        }

        // ───────────────────────── Thư mục ─────────────────────────
        private static string DefaultInstallDir()
        {
            try
            {
                foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
                {
                    using (var k = hive.OpenSubKey(UninstallKey))
                    {
                        if (k == null) continue;
                        var loc = k.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrEmpty(loc)) return loc;
                    }
                }
            }
            catch { }
            return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
        }

        private void BrowseFolder()
        {
            using (var dlg = new System.Windows.Forms.FolderBrowserDialog())
            {
                dlg.Description = "Chọn thư mục để cài đặt eGovAI";
                dlg.ShowNewFolderButton = true;
                try
                {
                    var cur = dirBox.Text.Trim();
                    while (!string.IsNullOrEmpty(cur) && !Directory.Exists(cur)) cur = System.IO.Path.GetDirectoryName(cur);
                    if (!string.IsNullOrEmpty(cur)) dlg.SelectedPath = cur;
                }
                catch { }
                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    var p = dlg.SelectedPath;
                    if (!p.TrimEnd('\\').EndsWith(AppName, StringComparison.OrdinalIgnoreCase)) p = System.IO.Path.Combine(p, AppName);
                    dirBox.Text = p;
                }
            }
        }

        private void UpdateSpaceInfo()
        {
            if (spaceInfo == null) return;
            string need = FormatSize(PayloadSize());
            string free = "không xác định";
            try
            {
                var root = System.IO.Path.GetPathRoot(System.IO.Path.GetFullPath(dirBox.Text.Trim()));
                var di = new DriveInfo(root);
                if (di.IsReady) free = FormatSize(di.AvailableFreeSpace);
            }
            catch { }
            spaceInfo.Text = "Dung lượng cần: " + need + "  ·  Còn trống: " + free;
        }

        private long payloadSizeCache = -1;
        private long PayloadSize()
        {
            if (payloadSizeCache >= 0) return payloadSizeCache;
            try
            {
                using (var zip = OpenPayload()) payloadSizeCache = zip.Entries.Sum(e => e.Length);
            }
            catch { payloadSizeCache = 0; }
            return payloadSizeCache;
        }

        private void BeginInstallFromFolderPage()
        {
            string dir = (dirBox.Text ?? "").Trim().Trim('"');
            try
            {
                if (dir.Length < 4 || !System.IO.Path.IsPathRooted(dir)) throw new ArgumentException();
                dir = System.IO.Path.GetFullPath(dir);
            }
            catch
            {
                Warn("Đường dẫn thư mục không hợp lệ. Vui lòng chọn lại.");
                return;
            }
            string root = System.IO.Path.GetPathRoot(dir);
            if (string.Equals(dir.TrimEnd('\\'), root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                Warn("Không thể cài trực tiếp vào thư mục gốc của ổ đĩa. Vui lòng chọn một thư mục con.");
                return;
            }
            try
            {
                var di = new DriveInfo(root);
                if (di.IsReady && di.AvailableFreeSpace < PayloadSize() + 50L * 1024 * 1024)
                {
                    Warn("Ổ đĩa " + root + " không đủ dung lượng trống để cài đặt eGovAI.");
                    return;
                }
            }
            catch { }

            if (!CanWrite(dir))
            {
                if (elevated)
                {
                    Warn("Không có quyền ghi vào thư mục:\n" + dir);
                    return;
                }
                // Cần quyền quản trị (ví dụ C:\Program Files): chạy lại trình cài đặt ở chế độ nâng quyền.
                try
                {
                    string a = "/elevated \"/dir=" + dir + "\"";
                    if (chkDesktop.IsChecked != true) a += " /nodesktop";
                    if (chkStart.IsChecked != true) a += " /nostartmenu";
                    var psi = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, a) { UseShellExecute = true, Verb = "runas" };
                    Process.Start(psi);
                    allowClose = true;
                    win.Close();
                }
                catch (Win32Exception)
                {
                    Warn("Cần quyền quản trị để cài vào thư mục này. Hãy chọn thư mục khác hoặc đồng ý cấp quyền.");
                }
                return;
            }

            installDir = dir;
            GoTo(Page.Installing);
            StartInstall();
        }

        private static bool CanWrite(string dir)
        {
            try
            {
                string probe = dir;
                while (!Directory.Exists(probe))
                {
                    var parent = System.IO.Path.GetDirectoryName(probe);
                    if (string.IsNullOrEmpty(parent)) return false;
                    probe = parent;
                }
                string f = System.IO.Path.Combine(probe, ".egovai-write-test-" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(f, "ok");
                File.Delete(f);
                return true;
            }
            catch { return false; }
        }

        // ───────────────────────── Cài đặt ─────────────────────────
        private void StartInstall()
        {
            if (!EnsureAppClosed()) { GoTo(Page.Folder); return; }

            installDir = installDir ?? DefaultInstallDir();
            dirExistedBefore = Directory.Exists(System.IO.Path.Combine(installDir, "resources"));
            cancelRequested = false;
            failMessage = null;
            Interlocked.Exchange(ref bytesDone, 0);
            curLabel = "Đang chuẩn bị…"; curPath = installDir;
            pauseGate.Set();
            state = InstallState.Running;
            SetButtons(false, "Tiếp tục", false, "Hủy", true);
            doneNote.Visibility = Visibility.Collapsed;
            progPath.Visibility = Visibility.Visible;
            SetFill(0);
            uiTimer.Start();

            bool wantDesktop = chkDesktop.IsChecked == true;
            bool wantStart = chkStart.IsChecked == true;
            var t = new Thread(() => InstallWorker(wantDesktop, wantStart)) { IsBackground = true, Name = "eGovAI-install" };
            t.Start();
        }

        private bool EnsureAppClosed()
        {
            while (true)
            {
                var running = Process.GetProcessesByName("eGovAI").Where(p => IsInDir(p, installDir)).ToList();
                if (running.Count == 0)
                {
                    // Đóng tiến trình lõi agy.exe còn chạy từ thư mục cài đặt (nếu có) để tránh khóa tệp khi nâng cấp.
                    foreach (var p in Process.GetProcessesByName("agy").Where(x => IsInDir(x, installDir)))
                    {
                        try { p.Kill(); p.WaitForExit(3000); } catch { }
                    }
                    return true;
                }
                if (silent)
                {
                    foreach (var p in running) { try { p.Kill(); p.WaitForExit(5000); } catch { } }
                    foreach (var p in Process.GetProcessesByName("agy").Where(x => IsInDir(x, installDir)))
                    {
                        try { p.Kill(); p.WaitForExit(3000); } catch { }
                    }
                    return true;
                }
                var r = MessageBox.Show(win, "eGovAI đang chạy. Vui lòng đóng ứng dụng rồi bấm “OK” để tiếp tục, hoặc “Cancel” để quay lại.",
                    "Cài đặt eGovAI", MessageBoxButton.OKCancel, MessageBoxImage.Warning);
                if (r != MessageBoxResult.OK) return false;
            }
        }

        private static bool IsInDir(Process p, string dir)
        {
            try { return p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase); }
            catch { return true; }
        }

        private static ZipArchive OpenPayload()
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (s == null) throw new InvalidOperationException("Bộ cài bị hỏng: không tìm thấy gói ứng dụng.");
            return new ZipArchive(s, ZipArchiveMode.Read, false);
        }

        private static string PhaseFor(string rel)
        {
            string r = rel.Replace('\\', '/').ToLowerInvariant();
            if (r.StartsWith("resources/bin/agy")) return "Đang cài đặt lõi AI (Antigravity CLI)…";
            if (r.StartsWith("resources/app/out/renderer")) return "Đang chép giao diện tiếng Việt…";
            if (r.StartsWith("resources/app/node_modules/agent-desktop") || r.StartsWith("resources/app/node_modules/playwright"))
                return "Đang cài bộ công cụ điều khiển máy tính…";
            if (r.StartsWith("resources/app")) return "Đang giải nén tệp ứng dụng…";
            return "Đang cài đặt môi trường Electron…";
        }

        private void InstallWorker(bool wantDesktop, bool wantStart)
        {
            try
            {
                Directory.CreateDirectory(installDir);
                // Xóa mã ứng dụng cũ (nếu có) để tránh lẫn tệp giữa các phiên bản.
                string oldApp = System.IO.Path.Combine(installDir, "resources", "app");
                if (Directory.Exists(oldApp))
                {
                    curLabel = "Đang gỡ phiên bản cũ…"; curPath = oldApp;
                    Directory.Delete(oldApp, true);
                }

                using (var zip = OpenPayload())
                {
                    var entries = zip.Entries.ToList();
                    Interlocked.Exchange(ref bytesTotal, Math.Max(1, entries.Sum(e => e.Length)));
                    string fullRoot = System.IO.Path.GetFullPath(installDir).TrimEnd('\\') + "\\";
                    var buf = new byte[1 << 17];
                    foreach (var entry in entries)
                    {
                        Checkpoint();
                        string rel = entry.FullName.Replace('/', '\\');
                        string dest = System.IO.Path.GetFullPath(System.IO.Path.Combine(installDir, rel));
                        if (!dest.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) continue; // chống zip-slip
                        if (rel.EndsWith("\\")) { Directory.CreateDirectory(dest); continue; }
                        curLabel = PhaseFor(rel);
                        curPath = dest;
                        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dest));
                        using (var src = entry.Open())
                        using (var dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                        {
                            int n;
                            while ((n = src.Read(buf, 0, buf.Length)) > 0)
                            {
                                dst.Write(buf, 0, n);
                                Interlocked.Add(ref bytesDone, n);
                                Checkpoint();
                            }
                        }
                    }
                }

                Checkpoint();
                curLabel = "Đang tạo lối tắt trên Desktop và menu Start…";
                string exe = System.IO.Path.Combine(installDir, ExeName);
                string ico = System.IO.Path.Combine(installDir, "egovai.ico");
                WriteResource("egovai.ico", ico);
                string uninst = System.IO.Path.Combine(installDir, UninstallExeName);
                WriteResource("uninstall.exe", uninst);

                string desktopLnk = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
                string startLnk = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk");
                if (wantDesktop) { curPath = desktopLnk; CreateShortcut(desktopLnk, exe, ico); }
                else TryDelete(desktopLnk);
                if (wantStart) { curPath = startLnk; CreateShortcut(startLnk, exe, ico); }
                else TryDelete(startLnk);

                curLabel = "Đang ghi thông tin gỡ cài đặt…";
                curPath = (elevated ? "HKLM\\" : "HKCU\\") + UninstallKey;
                WriteUninstallInfo(uninst, ico);

                Interlocked.Exchange(ref bytesDone, Interlocked.Read(ref bytesTotal));
                win.Dispatcher.BeginInvoke(new Action(OnInstallDone));
            }
            catch (OperationCanceledException)
            {
                win.Dispatcher.BeginInvoke(new Action(OnInstallCancelled));
            }
            catch (Exception ex)
            {
                failMessage = ex.Message;
                win.Dispatcher.BeginInvoke(new Action(OnInstallFailed));
            }
        }

        private void Checkpoint()
        {
            pauseGate.WaitOne();
            if (cancelRequested) throw new OperationCanceledException();
        }

        private void Pause()
        {
            if (state != InstallState.Running) return;
            pauseGate.Reset();
            state = InstallState.Paused;
            SetButtons(false, "Tiếp tục cài", true, "Hủy", true);
            RefreshProgress();
        }

        private void Resume()
        {
            if (state != InstallState.Paused) return;
            state = InstallState.Running;
            pauseGate.Set();
            SetButtons(false, "Tiếp tục", false, "Hủy", true);
        }

        private void CancelInstall()
        {
            state = InstallState.Cancelling;
            cancelRequested = true;
            pauseGate.Set();
            SetButtons(false, "Tiếp tục", false, "Hủy", false);
            progLabel.Text = "Đang hủy và dọn dẹp các tệp đã chép…";
        }

        private void OnInstallDone()
        {
            uiTimer.Stop();
            state = InstallState.Done;
            if (silent) { allowClose = true; win.Close(); return; }
            GoTo(Page.Finished);
        }

        private void OnInstallCancelled()
        {
            uiTimer.Stop();
            if (!dirExistedBefore)
            {
                try { if (Directory.Exists(installDir)) Directory.Delete(installDir, true); } catch { }
            }
            progLabel.Text = "Đã hủy cài đặt.";
            progPath.Text = "";
            allowClose = true;
            var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
            t.Tick += delegate { t.Stop(); win.Close(); };
            t.Start();
        }

        private void OnInstallFailed()
        {
            uiTimer.Stop();
            state = InstallState.Failed;
            if (silent)
            {
                try { File.AppendAllText(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "eGovAI-Setup.log"), DateTime.Now.ToString("s") + "  Cài đặt thất bại: " + failMessage + Environment.NewLine); } catch { }
                Environment.Exit(4);
            }
            progLabel.Text = "Cài đặt không thành công.";
            progPath.Text = failMessage ?? "";
            SetButtons(false, "Tiếp tục", false, "Đóng", true);
            Warn("Không thể cài đặt eGovAI:\n" + failMessage);
        }

        private void RefreshProgress()
        {
            if (page != Page.Installing) return;
            double frac = Math.Min(1.0, Interlocked.Read(ref bytesDone) / (double)Interlocked.Read(ref bytesTotal));
            int pct = state == InstallState.Done ? 100 : Math.Min(99, (int)Math.Floor(frac * 100));
            progPct.Text = pct + "%";
            SetFill(pct / 100.0);
            if (state == InstallState.Paused)
                progLabel.Text = "Đã tạm dừng. Bấm “Hủy” lần nữa để hủy cài đặt, hoặc “Tiếp tục cài”.";
            else if (state == InstallState.Running)
                progLabel.Text = curLabel;
            progPath.Text = curPath ?? "";
        }

        private void SetFill(double frac)
        {
            var parent = progFill.Parent as FrameworkElement;
            double w = parent != null ? parent.ActualWidth : 0;
            if (w <= 0) w = 498;
            progFill.Width = Math.Max(0, Math.Min(1, frac)) * w;
        }

        private void Finish()
        {
            if (launchAfter)
            {
                progLabel.Text = "Đang mở eGovAI…";
                try
                {
                    string exe = System.IO.Path.Combine(installDir, ExeName);
                    // Mở qua explorer để ứng dụng chạy với quyền người dùng thường (kể cả khi bộ cài đã nâng quyền).
                    Process.Start(new ProcessStartInfo("explorer.exe", "\"" + exe + "\"") { UseShellExecute = false, WorkingDirectory = installDir });
                }
                catch (Exception ex) { Warn("Không mở được eGovAI: " + ex.Message); }
            }
            else
            {
                progLabel.Text = "Đã đóng trình cài đặt.";
            }
            btnNext.IsEnabled = false; btnCancel.IsEnabled = false;
            allowClose = true;
            var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(launchAfter ? 1200 : 600) };
            t.Tick += delegate { t.Stop(); win.Close(); };
            t.Start();
        }

        // ───────────────────────── Chụp màn hình kiểm thử ─────────────────────────
        private void RunSnapshots(string dir)
        {
            Directory.CreateDirectory(dir);
            slideTimer.Stop();
            Render(dir, "1-license");
            licenseAccepted = true; GoTo(Page.License); Render(dir, "1b-license-accepted");
            GoTo(Page.Folder); Render(dir, "2-folder");
            GoTo(Page.Installing); slideTimer.Stop();
            state = InstallState.Running;
            Interlocked.Exchange(ref bytesTotal, 1000); Interlocked.Exchange(ref bytesDone, 370);
            curLabel = PhaseFor("chrome_100_percent.pak");
            curPath = System.IO.Path.Combine(installDir, "icudtl.dat");
            RefreshProgress(); Render(dir, "3-installing");
            Pause(); ShowSlide(1, false); Render(dir, "3b-paused");
            state = InstallState.Done; GoTo(Page.Finished); slideTimer.Stop(); ShowSlide(4, false); Render(dir, "4-finished");
            allowClose = true;
            win.Close();
        }

        private void Render(string dir, string name)
        {
            win.UpdateLayout();
            win.Dispatcher.Invoke(new Action(delegate { }), DispatcherPriority.Background);
            var root = (FrameworkElement)win.Content;
            var rtb = new RenderTargetBitmap((int)Math.Ceiling(root.ActualWidth + 32), (int)Math.Ceiling(root.ActualHeight + 32), 96, 96, PixelFormats.Pbgra32);
            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, rtb.Width, rtb.Height));
                dc.DrawRectangle(new VisualBrush(root), null, new Rect(16, 16, root.ActualWidth, root.ActualHeight));
            }
            rtb.Render(dv);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(rtb));
            using (var f = File.Create(System.IO.Path.Combine(dir, name + ".png"))) enc.Save(f);
        }

        // ───────────────────────── Tiện ích hệ thống ─────────────────────────
        private static void WriteResource(string name, string dest)
        {
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) return;
                using (var f = File.Create(dest)) s.CopyTo(f);
            }
        }

        private static void CreateShortcut(string lnkPath, string target, string icon)
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(lnkPath));
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            try
            {
                object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                Type lt = lnk.GetType();
                lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
                lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { System.IO.Path.GetDirectoryName(target) });
                lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { icon + ",0" });
                lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "eGovAI — Trợ lý số cho cơ quan nhà nước" });
                lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                System.Runtime.InteropServices.Marshal.FinalReleaseComObject(lnk);
            }
            finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
        }

        private void WriteUninstallInfo(string uninst, string icon)
        {
            RegistryKey hive = elevated ? Registry.LocalMachine : Registry.CurrentUser;
            using (var k = hive.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", AppName);
                k.SetValue("DisplayVersion", AppVersion);
                k.SetValue("Publisher", Publisher);
                k.SetValue("DisplayIcon", icon);
                k.SetValue("InstallLocation", installDir);
                k.SetValue("UninstallString", "\"" + uninst + "\"");
                k.SetValue("QuietUninstallString", "\"" + uninst + "\" /S");
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("EstimatedSize", (int)(Interlocked.Read(ref bytesTotal) / 1024), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void TryDelete(string f) { try { if (File.Exists(f)) File.Delete(f); } catch { } }

        private static bool IsElevated()
        {
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
            catch { return false; }
        }

        private static string GetArg(string[] args, string prefix)
        {
            foreach (var a in args) if (a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return a.Substring(prefix.Length).Trim('"');
            return null;
        }

        private static bool HasArg(string[] args, string name)
        {
            return args.Any(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
        }

        private static string FormatSize(long b)
        {
            if (b <= 0) return "không xác định";
            if (b >= 1L << 30) return (b / (double)(1L << 30)).ToString("0.0") + " GB";
            return Math.Ceiling(b / (double)(1L << 20)) + " MB";
        }

        private static SolidColorBrush Brush(string hex)
        {
            var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            b.Freeze();
            return b;
        }

        private bool Ask(string msg)
        {
            return MessageBox.Show(win, msg, "Cài đặt eGovAI", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
        }

        private void Warn(string msg)
        {
            MessageBox.Show(win, msg, "Cài đặt eGovAI", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        private const string LicenseBody =
"eGovAI 0.1.0 — Trợ lý số cho cơ quan nhà nước\n" +
"Phát hành theo Giấy phép MIT.\n\n" +
"Tóm tắt: Bạn được tự do sử dụng, sao chép, sửa đổi, hợp nhất, xuất bản, phân phối, cấp phép lại và/hoặc bán bản sao của phần mềm, với điều kiện giữ nguyên thông báo bản quyền và thông báo cấp phép dưới đây trong mọi bản sao. Phần mềm được cung cấp “nguyên trạng”, không kèm bất kỳ bảo đảm nào.\n\n" +
"Lưu ý khi sử dụng: eGovAI là công cụ hỗ trợ. Nội dung do trợ lý AI tạo ra cần được cán bộ kiểm tra, đối chiếu với văn bản gốc và chịu trách nhiệm trước khi sử dụng chính thức. Không đưa tài liệu thuộc danh mục bí mật nhà nước vào ứng dụng.\n\n" +
"────────────────────────────\n\n" +
"MIT License\n\n" +
"Copyright (c) 2026 Nhóm phát triển eGovAI (Trịnh Văn Thành, Trịnh Quang Trung)\n\n" +
"Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n" +
"The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n" +
"THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n\n" +
"Ứng dụng có sử dụng Electron, Chromium và các thư viện mã nguồn mở khác; giấy phép của các thành phần này được kèm theo trong thư mục cài đặt (LICENSE, LICENSES.chromium.html).";
    }
}
