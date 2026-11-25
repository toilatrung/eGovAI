// Trình gỡ cài đặt eGovAI — được bộ cài chép vào thư mục cài đặt với tên "Uninstall eGovAI.exe".
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

// Thông tin phiên bản/công ty được build-installer.ps1 sinh từ package.json vào build\AssemblyInfo.Uninstaller.cs.

namespace EGovAIUninstall
{
    public static class Program
    {
        private const string Title = "Gỡ cài đặt eGovAI";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\eGovAI";

        [STAThread]
        public static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            bool silent = args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase));
            bool elevatedRun = args.Any(a => a.Equals("/elevated", StringComparison.OrdinalIgnoreCase));
            string self = Assembly.GetExecutingAssembly().Location;
            string dir = Path.GetDirectoryName(self);

            if (!File.Exists(Path.Combine(dir, "eGovAI.exe")))
            {
                if (!silent) MessageBox.Show("Không tìm thấy eGovAI trong thư mục:\n" + dir, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            if (!elevatedRun && !CanWrite(dir))
            {
                try
                {
                    Process.Start(new ProcessStartInfo(self, "/elevated" + (silent ? " /S" : "")) { UseShellExecute = true, Verb = "runas" });
                }
                catch (Win32Exception)
                {
                    if (!silent) MessageBox.Show("Cần quyền quản trị để gỡ eGovAI khỏi thư mục này.", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return 0;
            }

            if (!silent && MessageBox.Show("Bạn có chắc muốn gỡ eGovAI khỏi máy tính?", Title,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return 1;

            // Ứng dụng phải được đóng trước khi gỡ.
            while (Process.GetProcessesByName("eGovAI").Any(p => InDir(p, dir)))
            {
                if (silent) { foreach (var p in Process.GetProcessesByName("eGovAI").Where(x => InDir(x, dir))) { try { p.Kill(); p.WaitForExit(5000); } catch { } } break; }
                if (MessageBox.Show("eGovAI đang chạy. Vui lòng đóng ứng dụng rồi bấm “Retry”.", Title,
                        MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning) != DialogResult.Retry)
                    return 1;
            }
            foreach (var p in Process.GetProcessesByName("agy").Where(x => InDir(x, dir)))
            {
                try { p.Kill(); p.WaitForExit(3000); } catch { }
            }

            bool removeData = false;
            string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GoogleAI");
            if (!silent && Directory.Exists(userData))
            {
                removeData = MessageBox.Show(
                    "Xóa luôn dữ liệu cá nhân của eGovAI (lịch sử trò chuyện, cài đặt, nhật ký)?\n\n" + userData + "\n\nChọn “No” để giữ lại cho lần cài sau.",
                    Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
            }

            // Lối tắt
            foreach (var lnk in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "eGovAI.lnk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "eGovAI.lnk") })
            {
                try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
            }

            // Thông tin gỡ cài đặt trong Registry
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    string loc = null;
                    using (var k = hive.OpenSubKey(UninstallKey)) { if (k != null) loc = k.GetValue("InstallLocation") as string; }
                    if (loc != null && string.Equals(loc.TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                        hive.DeleteSubKeyTree(UninstallKey, false);
                }
                catch { }
            }

            if (removeData) { try { Directory.Delete(userData, true); } catch { } }

            // Xóa tệp ứng dụng (trừ chính trình gỡ), rồi nhờ cmd xóa nốt thư mục sau khi tiến trình này thoát.
            try
            {
                foreach (var f in Directory.GetFiles(dir))
                    if (!string.Equals(f, self, StringComparison.OrdinalIgnoreCase)) { try { File.Delete(f); } catch { } }
                foreach (var d in Directory.GetDirectories(dir)) { try { Directory.Delete(d, true); } catch { } }
            }
            catch { }

            try
            {
                var psi = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + dir + "\"")
                {
                    CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = Path.GetTempPath()
                };
                Process.Start(psi);
            }
            catch { }

            if (!silent) MessageBox.Show("Đã gỡ eGovAI khỏi máy tính của bạn.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        private static bool InDir(Process p, string dir)
        {
            try { return p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase); }
            catch { return true; }
        }

        private static bool CanWrite(string dir)
        {
            try
            {
                string f = Path.Combine(dir, ".egovai-write-test-" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(f, "ok");
                File.Delete(f);
                return true;
            }
            catch { return false; }
        }
    }
}
