using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AgentUsageFrame
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--self-test")
            {
                Environment.ExitCode = SelfTest.Run() ? 0 : 1;
                return;
            }

            Native.EnableDpiAwareness();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UsageForm());
        }
    }

    // ------------------------------------------------------------- model --

    internal sealed class LimitWindow
    {
        public string Label { get; set; }
        public int UsedPercent { get; set; }
        public int? WindowMins { get; set; }
        public long? ResetsAt { get; set; }

        public int RemainingPercent { get { return Math.Max(0, 100 - UsedPercent); } }

        /// <summary>How much of the window's clock is left, 0-100, or null when unknown.</summary>
        public double? ClockLeftPercent
        {
            get
            {
                if (!ResetsAt.HasValue || !WindowMins.HasValue || WindowMins.Value <= 0)
                    return null;
                double secondsLeft = ResetsAt.Value - Clock.UnixNow;
                double windowSeconds = WindowMins.Value * 60.0;
                return Math.Max(0.0, Math.Min(100.0, secondsLeft / windowSeconds * 100.0));
            }
        }

        /// <summary>When usage keeps up its average pace, the moment this window empties.</summary>
        public long? ProjectedEmptyAt
        {
            get
            {
                double? clockLeft = ClockLeftPercent;
                if (!clockLeft.HasValue || UsedPercent <= 0 || RemainingPercent <= 0)
                    return null;
                double elapsedSeconds = (100.0 - clockLeft.Value) / 100.0 * WindowMins.Value * 60.0;
                if (elapsedSeconds < 120)
                    return null;
                double perSecond = UsedPercent / elapsedSeconds;
                if (perSecond <= 0)
                    return null;
                double secondsLeft = RemainingPercent / perSecond;
                if (secondsLeft >= (ResetsAt.Value - Clock.UnixNow))
                    return null;
                return Clock.UnixNow + (long)secondsLeft;
            }
        }
    }

    internal sealed class ResetCredit
    {
        public long? ExpiresAt { get; set; }
        public bool ExpirationKnown { get; set; }
    }

    internal sealed class Account
    {
        public string Id { get; set; }
        public string Provider { get; set; }
        public string Label { get; set; }
        public string Plan { get; set; }
        public bool Active { get; set; }
        public bool Blocked { get; set; }
        public string Error { get; set; }
        public string Warning { get; set; }
        public long? SampledAt { get; set; }
        public int? ResetCredits { get; set; }
        public double? CreditBalance { get; set; }
        public List<ResetCredit> ResetCreditDetails { get; set; }
        public bool ExtraUsageEnabled { get; set; }
        public double? ExtraUsageDollars { get; set; }
        public List<LimitWindow> Limits { get; private set; }

        public Account() { Limits = new List<LimitWindow>(); }

        public LimitWindow Selected(bool weekly)
        {
            foreach (LimitWindow limit in Limits)
                if (limit.WindowMins.HasValue && (weekly
                    ? limit.WindowMins.Value >= 10080 : limit.WindowMins.Value < 1440))
                    return limit;
            return null;
        }

        public string DisplayName
        {
            get
            {
                if (String.Equals(Provider, "codex", StringComparison.OrdinalIgnoreCase))
                    return "Codex " + Label;
                return String.IsNullOrEmpty(Label) ? "Claude" : Label;
            }
        }

        /// <summary>The window that runs out first -- the one worth reading.</summary>
        public LimitWindow Binding
        {
            get
            {
                LimitWindow tightest = null;
                foreach (LimitWindow limit in Limits)
                    if (tightest == null || limit.RemainingPercent < tightest.RemainingPercent)
                        tightest = limit;
                return tightest;
            }
        }
    }

    internal sealed class Snapshot
    {
        public long GeneratedAt { get; set; }
        public long? ActivityAt { get; set; }
        public List<Account> Accounts { get; private set; }

        public Snapshot() { Accounts = new List<Account>(); }

        /// <summary>Fingerprint of every reported percentage, used to spot real change.</summary>
        public string Fingerprint
        {
            get
            {
                StringBuilder builder = new StringBuilder();
                foreach (Account account in Accounts)
                {
                    builder.Append(account.Id).Append(':');
                    if (!String.IsNullOrEmpty(account.Error))
                        builder.Append('!');
                    foreach (LimitWindow limit in account.Limits)
                        builder.Append(limit.UsedPercent).Append('/');
                    builder.Append('|');
                }
                return builder.ToString();
            }
        }
    }

    internal static class Clock
    {
        private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        public static long UnixNow
        {
            get { return (long)(DateTime.UtcNow - Epoch).TotalSeconds; }
        }

        public static DateTime ToLocal(long unixSeconds)
        {
            return Epoch.AddSeconds(unixSeconds).ToLocalTime();
        }

        /// <summary>"2h 14m" above an hour, "14:08" below it -- an instrument reading.</summary>
        public static string Countdown(long? resetsAt)
        {
            if (!resetsAt.HasValue)
                return "--";
            long seconds = Math.Max(0, resetsAt.Value - UnixNow);
            if (seconds >= 86400)
                return String.Format(CultureInfo.InvariantCulture, "{0}d {1}h", seconds / 86400, (seconds % 86400) / 3600);
            if (seconds >= 3600)
                return String.Format(CultureInfo.InvariantCulture, "{0}h {1:00}m", seconds / 3600, (seconds % 3600) / 60);
            return String.Format(CultureInfo.InvariantCulture, "{0}:{1:00}", seconds / 60, seconds % 60);
        }

        public static string ShortTime(long unixSeconds)
        {
            DateTime local = ToLocal(unixSeconds);
            string text = local.ToString("h:mmtt", CultureInfo.InvariantCulture).ToLowerInvariant();
            return text.Replace(":00", "");
        }
    }

    // ------------------------------------------------------------ parsing --

    internal static class SnapshotParser
    {
        private const int MaxJson = 1024 * 1024;
        private static readonly JavaScriptSerializer Serializer =
            new JavaScriptSerializer { MaxJsonLength = MaxJson };

        public static Snapshot Parse(string json)
        {
            if (String.IsNullOrWhiteSpace(json) || json.Length > MaxJson)
                throw new InvalidOperationException("The collector returned an unreadable response.");

            IDictionary<string, object> root = Serializer.DeserializeObject(json) as IDictionary<string, object>;
            if (root == null)
                throw new InvalidOperationException("The collector response was not a JSON object.");

            Snapshot snapshot = new Snapshot();
            snapshot.GeneratedAt = Long(root, "generatedAt") ?? Clock.UnixNow;
            snapshot.ActivityAt = Long(root, "activityAt");

            object rowsObject;
            root.TryGetValue("accounts", out rowsObject);
            object[] rows = rowsObject as object[];
            if (rows == null)
                throw new InvalidOperationException("The collector reported no accounts.");

            foreach (object rowObject in rows)
            {
                IDictionary<string, object> row = rowObject as IDictionary<string, object>;
                if (row == null)
                    continue;

                Account account = new Account
                {
                    Id = Text(row, "id", "?"),
                    Provider = Text(row, "provider", "codex"),
                    Label = Text(row, "label", "?"),
                    Plan = Text(row, "plan", null),
                    Active = Flag(row, "active"),
                    Blocked = Flag(row, "blocked"),
                    Error = Text(row, "error", null),
                    Warning = Text(row, "warning", null),
                    SampledAt = Long(row, "sampledAt"),
                    ResetCredits = (int?)Long(row, "resetCredits"),
                    CreditBalance = Number(row, "creditBalance")
                };

                object detailObject;
                if (row.TryGetValue("resetCreditDetails", out detailObject) && detailObject is object[])
                {
                    account.ResetCreditDetails = new List<ResetCredit>();
                    foreach (object item in (object[])detailObject)
                    {
                        IDictionary<string, object> detail = item as IDictionary<string, object>;
                        if (detail == null) continue;
                        long? expiry = Long(detail, "expiresAt");
                        bool valid = !expiry.HasValue || (expiry.Value > 0 && expiry.Value <= 253402300799L);
                        account.ResetCreditDetails.Add(new ResetCredit {
                            ExpiresAt = valid ? expiry : null,
                            ExpirationKnown = valid && Flag(detail, "expirationKnown")
                        });
                    }
                    account.ResetCreditDetails.Sort(delegate(ResetCredit a, ResetCredit b) {
                        return (a.ExpiresAt ?? Int64.MaxValue).CompareTo(b.ExpiresAt ?? Int64.MaxValue);
                    });
                }

                IDictionary<string, object> extra = Map(row, "extraUsage");
                if (extra != null)
                {
                    account.ExtraUsageEnabled = Flag(extra, "enabled");
                    account.ExtraUsageDollars = Number(extra, "usedDollars");
                }

                object limitsObject;
                row.TryGetValue("limits", out limitsObject);
                object[] limits = limitsObject as object[];
                if (limits != null)
                {
                    foreach (object limitObject in limits)
                    {
                        IDictionary<string, object> limit = limitObject as IDictionary<string, object>;
                        if (limit == null)
                            continue;
                        long? used = Long(limit, "usedPercent");
                        if (!used.HasValue)
                            continue;
                        account.Limits.Add(new LimitWindow
                        {
                            Label = Text(limit, "label", "Window"),
                            UsedPercent = (int)Math.Max(0, Math.Min(100, used.Value)),
                            WindowMins = (int?)Long(limit, "windowMins"),
                            ResetsAt = Long(limit, "resetsAt")
                        });
                    }
                }

                if (account.Limits.Count == 0 && String.IsNullOrEmpty(account.Error))
                    account.Error = "No limits reported.";
                snapshot.Accounts.Add(account);
            }

            if (snapshot.Accounts.Count == 0)
                throw new InvalidOperationException("The collector reported no accounts.");
            return snapshot;
        }

        private static IDictionary<string, object> Map(IDictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null)
                return null;
            return value as IDictionary<string, object>;
        }

        private static string Text(IDictionary<string, object> source, string key, string fallback)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null)
                return fallback;
            string text = Convert.ToString(value, CultureInfo.InvariantCulture);
            return String.IsNullOrEmpty(text) ? fallback : text;
        }

        private static bool Flag(IDictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null)
                return false;
            try { return Convert.ToBoolean(value, CultureInfo.InvariantCulture); }
            catch { return false; }
        }

        private static long? Long(IDictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null)
                return null;
            try { return Convert.ToInt64(value, CultureInfo.InvariantCulture); }
            catch { return null; }
        }

        private static double? Number(IDictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null)
                return null;
            try { return Convert.ToDouble(value, CultureInfo.InvariantCulture); }
            catch { return null; }
        }

        public static string Sanitize(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
                return "Something went wrong.";
            string line = Regex.Replace(value, "[\\r\\n\\t]+", " ").Trim();
            return line.Length <= 220 ? line : line.Substring(0, 220) + "\u2026";
        }
    }

    // -------------------------------------------------------------- theme --

    internal static class Theme
    {
        // Deep petrol glass, so the frame reads as smoked instrument housing
        // rather than a black rectangle laid over the desktop.
        public static readonly Color ShellTop = Color.FromArgb(38, 44, 55);
        public static readonly Color ShellBottom = Color.FromArgb(22, 27, 36);
        public static readonly Color Hairline = Color.FromArgb(57, 65, 79);
        public static readonly Color Track = Color.FromArgb(43, 51, 64);
        public static readonly Color Ink = Color.FromArgb(232, 238, 244);
        public static readonly Color Muted = Color.FromArgb(138, 154, 171);
        public static readonly Color Faint = Color.FromArgb(154, 166, 182);

        // Headroom ramp. Colour answers "how much is left", never "which brand".
        public static readonly Color Plenty = Color.FromArgb(149, 216, 197);
        public static readonly Color Tight = Color.FromArgb(242, 178, 76);
        public static readonly Color Spent = Color.FromArgb(255, 107, 114);

        public static readonly Color CodexMark = Color.FromArgb(211, 222, 234);
        public static readonly Color ClaudeMark = Color.FromArgb(231, 180, 152);

        public static Color Headroom(int remainingPercent)
        {
            if (remainingPercent <= 0) return Spent;
            if (remainingPercent < 15) return Spent;
            if (remainingPercent < 40) return Tight;
            return Plenty;
        }

        public static Color Mark(string provider)
        {
            return String.Equals(provider, "claude", StringComparison.OrdinalIgnoreCase)
                ? ClaudeMark
                : CodexMark;
        }

        private static readonly HashSet<string> Installed = LoadInstalled();

        private static HashSet<string> LoadInstalled()
        {
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (InstalledFontCollection collection = new InstalledFontCollection())
                    foreach (FontFamily family in collection.Families)
                        names.Add(family.Name);
            }
            catch { }
            return names;
        }

        private static string Pick(params string[] candidates)
        {
            foreach (string candidate in candidates)
                if (Installed.Contains(candidate))
                    return candidate;
            return "Segoe UI";
        }

        // Bahnschrift is Windows' own DIN: condensed, technical, built for dials.
        private static readonly string InstrumentName =
            Pick("Segoe UI", "Arial");
        private static readonly string ProseName = Pick("Segoe UI");
        private static readonly string ClockName = Pick("Cascadia Mono", "Consolas", "Courier New");
        private static readonly string IconName = Pick("Segoe MDL2 Assets", "Segoe UI Symbol");

        public static readonly bool HasIconFont = Installed.Contains("Segoe MDL2 Assets");

        public static Font Instrument(float size, FontStyle style)
        {
            return new Font(InstrumentName, size * 96f / 72f, style, GraphicsUnit.Pixel);
        }

        public static Font Prose(float size)
        {
            return new Font(ProseName, size * 96f / 72f, FontStyle.Regular, GraphicsUnit.Pixel);
        }

        public static Font ClockFace(float size)
        {
            return new Font(ClockName, size * 96f / 72f, FontStyle.Regular, GraphicsUnit.Pixel);
        }

        public static Font Icons(float size)
        {
            return new Font(IconName, size * 96f / 72f, FontStyle.Regular, GraphicsUnit.Pixel);
        }
    }

    // ------------------------------------------------------------ drawing --

    internal static class Draw
    {
        public const float GaugeStartAngle = 135f;
        public const float GaugeSweepAngle = 270f;

        public static void Symbol(Graphics g, RectangleF bounds, string symbol, Color color)
        {
            GraphicsState saved = g.Save();
            g.TranslateTransform(bounds.X, bounds.Y);
            g.ScaleTransform(bounds.Width / 24f, bounds.Height / 24f);
            using (Pen pen = new Pen(color, 1.7f))
            {
                pen.StartCap = pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                if (symbol == "claude")
                {
                    for (int i = 0; i < 10; i++)
                    {
                        double angle = i * Math.PI / 5;
                        g.DrawLine(pen, 12 + (float)Math.Cos(angle) * 4, 12 + (float)Math.Sin(angle) * 4,
                            12 + (float)Math.Cos(angle) * 10, 12 + (float)Math.Sin(angle) * 10);
                    }
                }
                else if (symbol == "codex")
                {
                    using (GraphicsPath cloud = new GraphicsPath())
                    {
                        cloud.AddBezier(6, 20, 0, 20, 0, 11, 5, 10);
                        cloud.AddBezier(5, 10, 4, 2, 15, 1, 17, 8);
                        cloud.AddBezier(17, 8, 24, 7, 25, 20, 18, 20);
                        cloud.CloseFigure();
                        g.DrawPath(pen, cloud);
                    }
                    g.DrawLines(pen, new PointF[] { new PointF(7, 11), new PointF(10, 14), new PointF(7, 17) });
                    g.DrawLine(pen, 13, 17, 17, 17);
                }
                else if (symbol == "close") { g.DrawLine(pen, 6, 6, 18, 18); g.DrawLine(pen, 6, 18, 18, 6); }
                else if (symbol == "refresh")
                {
                    g.DrawArc(pen, 4, 4, 16, 16, 35, 290);
                    g.DrawLines(pen, new PointF[] { new PointF(15, 4), new PointF(20, 4), new PointF(20, 9) });
                }
                else if (symbol == "expand" || symbol == "collapse")
                {
                    bool down = symbol == "expand";
                    g.DrawLines(pen, new PointF[] { new PointF(5, down ? 9 : 15), new PointF(12, down ? 16 : 8), new PointF(19, down ? 9 : 15) });
                }
                else
                {
                    g.DrawLines(pen, new PointF[] { new PointF(8, 3), new PointF(16, 3), new PointF(16, 10), new PointF(19, 14), new PointF(5, 14), new PointF(8, 10), new PointF(8, 3) });
                    g.DrawLine(pen, 12, 14, 12, 22);
                    if (symbol == "unpin") g.DrawLine(pen, 3, 3, 21, 21);
                }
            }
            g.Restore(saved);
        }

        public static void FocusGauge(Graphics g, RectangleF bounds, LimitWindow limit, Font font, Font narrow, Font caption, float progress)
        {
            RectangleF ring = Inset(bounds, 4);
            using (Pen track = new Pen(Theme.Track, 5))
            {
                track.StartCap = track.EndCap = LineCap.Round;
                g.DrawArc(track, ring, 135, 270);
            }
            if (limit != null && progress > 0)
                using (Pen fill = new Pen(Theme.Headroom((int)Math.Round(progress)), 5))
                {
                    fill.StartCap = fill.EndCap = LineCap.Round;
                    g.DrawArc(fill, ring, 135, 270 * progress / 100f);
                }
            using (StringFormat format = Centred())
            {
                string value = limit == null ? "--" : Math.Round(progress).ToString(CultureInfo.InvariantCulture);
                Text(g, value, value.Length > 2 ? narrow : font, Theme.Ink,
                    new RectangleF(bounds.X + 10, bounds.Y + bounds.Height * 0.22f, bounds.Width - 20, bounds.Height * 0.42f), format);
                Text(g, "% left", caption, Theme.Muted,
                    new RectangleF(bounds.X + 10, bounds.Y + bounds.Height * 0.62f, bounds.Width - 20, 16), format);
            }
        }

        public static GraphicsPath RoundedRect(RectangleF bounds, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float diameter = Math.Min(radius * 2f, Math.Min(bounds.Width, bounds.Height));
            if (diameter <= 0f)
            {
                path.AddRectangle(bounds);
                return path;
            }
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180f, 90f);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270f, 90f);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0f, 90f);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90f, 90f);
            path.CloseFigure();
            return path;
        }

        public static RectangleF Inset(RectangleF bounds, float amount)
        {
            return new RectangleF(
                bounds.X + amount,
                bounds.Y + amount,
                Math.Max(0f, bounds.Width - amount * 2f),
                Math.Max(0f, bounds.Height - amount * 2f));
        }

        public static StringFormat Centred()
        {
            return new StringFormat
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
                FormatFlags = StringFormatFlags.NoWrap,
                Trimming = StringTrimming.None
            };
        }

        public static StringFormat Left()
        {
            return new StringFormat
            {
                Alignment = StringAlignment.Near,
                LineAlignment = StringAlignment.Center,
                FormatFlags = StringFormatFlags.NoWrap,
                Trimming = StringTrimming.EllipsisCharacter
            };
        }

        public static StringFormat Right()
        {
            return new StringFormat
            {
                Alignment = StringAlignment.Far,
                LineAlignment = StringAlignment.Center,
                FormatFlags = StringFormatFlags.NoWrap,
                Trimming = StringTrimming.None
            };
        }

        public static void Text(Graphics g, string value, Font font, Color color, RectangleF bounds, StringFormat format)
        {
            if (String.IsNullOrEmpty(value))
                return;
            using (SolidBrush brush = new SolidBrush(color))
                g.DrawString(value, font, brush, bounds, format);
        }
    }

    // ------------------------------------------------------------- native --

    internal static class Native
    {
        public const int WsExNoActivate = 0x08000000;
        public const int WsExToolWindow = 0x00000080;
        public const int WmMouseActivate = 0x0021;
        public const int MaNoActivate = 3;

        public const uint SwpNoSize = 0x0001;
        public const uint SwpNoMove = 0x0002;
        public const uint SwpNoZOrder = 0x0004;
        public const uint SwpNoActivate = 0x0010;

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(int awareness);
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr window);

        public static void EnableDpiAwareness()
        {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
            catch (EntryPointNotFoundException) { }
            try { if (SetProcessDpiAwareness(2) == 0) return; }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            SetProcessDPIAware();
        }

        public static float WindowScale(IntPtr window)
        {
            try { uint dpi = GetDpiForWindow(window); if (dpi > 0) return dpi / 96f; }
            catch (EntryPointNotFoundException) { }
            using (Graphics graphics = Graphics.FromHwnd(window)) return graphics.DpiX / 96f;
        }

        public static readonly IntPtr HwndTopMost = new IntPtr(-1);
        public static readonly IntPtr HwndNoTopMost = new IntPtr(-2);

        [StructLayout(LayoutKind.Sequential)]
        public struct Rect { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MonitorInfo
        {
            public int Size;
            public Rect Monitor;
            public Rect Work;
            public uint Flags;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(
            IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

        [DllImport("user32.dll")]
        public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);

        [DllImport("shell32.dll")]
        public static extern int SHQueryUserNotificationState(out int state);

        /// <summary>
        /// True when something is presenting full screen -- a game, a slideshow.
        /// The frame keeps drawing on its own monitor but stops asserting
        /// top-most, which is what pulls an exclusive-fullscreen game out.
        /// </summary>
        public static bool FullScreenAppRunning(IntPtr ownHandle)
        {
            try
            {
                int state;
                if (SHQueryUserNotificationState(out state) == 0 && (state == 3 || state == 4))
                    return true;
            }
            catch { }

            try
            {
                IntPtr foreground = GetForegroundWindow();
                if (foreground == IntPtr.Zero || foreground == ownHandle)
                    return false;

                StringBuilder name = new StringBuilder(64);
                GetClassName(foreground, name, name.Capacity);
                string className = name.ToString();
                if (className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd")
                    return false;

                Rect window;
                if (!GetWindowRect(foreground, out window))
                    return false;

                MonitorInfo info = new MonitorInfo();
                info.Size = Marshal.SizeOf(typeof(MonitorInfo));
                IntPtr monitor = MonitorFromWindow(foreground, 2 /* NEAREST */);
                if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info))
                    return false;

                return window.Left <= info.Monitor.Left
                    && window.Top <= info.Monitor.Top
                    && window.Right >= info.Monitor.Right
                    && window.Bottom >= info.Monitor.Bottom;
            }
            catch { return false; }
        }
    }

    internal sealed class FrameState
    {
        public int X { get; set; }
        public int Y { get; set; }
        public bool Compact { get; set; }
        public bool Weekly { get; set; }
        public bool StayOnTop { get; set; }

        /// <summary>"wsl" reads the collector in the local WSL distribution;
        /// "ssh" reads it on the machine named by <see cref="SshTarget"/>.</summary>
        public string Source { get; set; }
        public string SshTarget { get; set; }

        public FrameState()
        {
            Weekly = true;
            X = Int32.MinValue;
            Y = Int32.MinValue;
            StayOnTop = true;
            Source = "wsl";
            SshTarget = "";
        }

        private static string Path
        {
            get
            {
                string directory = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AgentUsageFrame");
                return System.IO.Path.Combine(directory, "state.json");
            }
        }

        public static FrameState Load()
        {
            try
            {
                if (!File.Exists(Path))
                    return new FrameState();
                string json = File.ReadAllText(Path, Encoding.UTF8);
                if (json.Length > 4096)
                    return new FrameState();
                FrameState state = new JavaScriptSerializer().Deserialize<FrameState>(json);
                return state ?? new FrameState();
            }
            catch { return new FrameState(); }
        }

        public void Save()
        {
            try
            {
                string path = Path;
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
                File.WriteAllText(path, new JavaScriptSerializer().Serialize(this), Encoding.UTF8);
            }
            catch { }
        }
    }

    // --------------------------------------------------------------- form --

    internal sealed class UsageForm : Form
    {
        private const int ExpandedWidth = 420;
        private const int HeaderHeight = 90;
        private const int GutterLeft = 132;
        private const int GutterRight = 14;
        private const int MeterRowHeight = 46;
        private const int CompactCell = 60;
        private const int CompactPad = 6;
        private const int CompactHeight = 64;

        private const string WslCommand =
            "exec \"$HOME/.local/bin/agent-usage\" --timeout 20 --compact";
        private const string SshCommand =
            "~/.local/bin/agent-usage --timeout 20 --compact";

        private enum Hit { None, Pin, Refresh, Fold, Close, Hourly, Weekly }

        private readonly Font fName, fPlan, fLimit, fValue, fClock, fFoot, fError;
        private readonly Font fGauge, fGaugeNarrow, fCellLabel, fCellClock, fHeader, fIcon;

        private readonly FrameState state;
        private readonly Timer tick;
        private readonly Timer gaugeMotion = new Timer { Interval = 16 };
        private readonly Stopwatch gaugeClock = new Stopwatch();
        private readonly Dictionary<string, float> gaugeFrom = new Dictionary<string, float>();
        private readonly Dictionary<Hit, Rectangle> buttons = new Dictionary<Hit, Rectangle>();

        private Snapshot snapshot;
        private string failure;
        private DateTime lastSuccess = DateTime.MinValue;
        private DateTime nextPoll = DateTime.MinValue;
        private string lastFingerprint = "";
        private int quietPolls;
        private int errorStreak;
        private bool refreshing;
        private bool fullScreenApp;
        private bool hovering;
        private int hoveredAccount = -1;
        private string bankId;
        private bool bankTarget;
        private double bankAmount, bankFrom;
        private readonly Timer bankMotion = new Timer { Interval = 16 };
        private readonly Stopwatch bankClock = new Stopwatch();
        private readonly Dictionary<Rectangle, string> bankAreas = new Dictionary<Rectangle, string>();
        private readonly Timer motion = new Timer { Interval = 16 };
        private readonly Stopwatch motionClock = new Stopwatch();
        private Size motionFrom, motionTo;
        private Hit hotButton = Hit.None;
        private bool dragging;
        private Point dragOffset;
        private int tickCount;
        private float dpiScale = 1f;
        private int scrollOffset;
        private readonly ToolTip tips = new ToolTip { ShowAlways = true, AutoPopDelay = 20000 };
        private readonly Dictionary<Rectangle, string> bankTips = new Dictionary<Rectangle, string>();
        private string currentTip;
        private readonly Font fTiny = Theme.Instrument(10f, FontStyle.Bold);
        private readonly Font fTinyNarrow = Theme.Instrument(9f, FontStyle.Bold);

        public UsageForm()
        {
            state = FrameState.Load();

            fName = Theme.Instrument(11f, FontStyle.Bold);
            fPlan = Theme.Prose(8.5f);
            fLimit = Theme.Instrument(9f, FontStyle.Regular);
            fValue = Theme.Instrument(9.5f, FontStyle.Bold);
            fClock = Theme.Prose(8.5f);
            fFoot = Theme.Prose(8.5f);
            fError = Theme.Prose(8.25f);
            fGauge = Theme.Instrument(20f, FontStyle.Bold);
            fGaugeNarrow = Theme.Instrument(17f, FontStyle.Bold);
            fCellLabel = Theme.Instrument(8f, FontStyle.Regular);
            fCellClock = Theme.ClockFace(7.5f);
            fHeader = Theme.Prose(8.5f);
            fIcon = Theme.Icons(8.5f);

            Text = "Agent usage";
            try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            // Keep text opaque. Glass depth comes from the surface, not faded glyphs.
            AutoScaleMode = AutoScaleMode.None;
            AllowTransparency = false;
            Opacity = 1.0;
            BackColor = Theme.ShellBottom;
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

            ClientSize = new Size(ExpandedWidth, 200);
            ApplyStayOnTop();

            tick = new Timer { Interval = 1000 };
            tick.Tick += delegate { OnTick(); };
            gaugeMotion.Tick += delegate {
                if (gaugeClock.ElapsedMilliseconds >= 320) gaugeMotion.Stop();
                Invalidate();
            };
            motion.Tick += delegate {
                double t = Math.Min(1.0, motionClock.Elapsed.TotalMilliseconds / 180.0);
                double eased = 1.0 - Math.Pow(1.0 - t, 3.0);
                ResizeFrame(new Size((int)Math.Round(motionFrom.Width + (motionTo.Width - motionFrom.Width) * eased),
                    (int)Math.Round(motionFrom.Height + (motionTo.Height - motionFrom.Height) * eased)));
                if (t >= 1.0) motion.Stop();
            };

            bankMotion.Tick += delegate {
                double t = Math.Min(1.0, bankClock.Elapsed.TotalMilliseconds / 240.0);
                // Smooth start/stop, including acceleration; retarget from current height.
                double eased = t * t * t * (t * (6.0 * t - 15.0) + 10.0);
                bankAmount = bankFrom + ((bankTarget ? 1.0 : 0.0) - bankFrom) * eased;
                if (t >= 1.0) { bankMotion.Stop(); if (!bankTarget) bankId = null; }
                ApplySize();
                Invalidate();
            };

            Shown += delegate
            {
                dpiScale = Native.WindowScale(Handle);
                PlaceWindow();
                tick.Start();
                BeginRefresh();
            };
            FormClosing += delegate { PersistState(); };
        }

        // Never take focus: the frame lives beside a game, not in front of it.
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= Native.WsExNoActivate | Native.WsExToolWindow;
                return parameters;
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == Native.WmMouseActivate)
            {
                message.Result = new IntPtr(Native.MaNoActivate);
                return;
            }
            if (message.Msg == 0x02E0) // WM_DPICHANGED, physical coordinates
            {
                dpiScale = Math.Max(1f, (message.WParam.ToInt64() & 0xffff) / 96f);
                Native.Rect suggested = (Native.Rect)Marshal.PtrToStructure(message.LParam, typeof(Native.Rect));
                Native.SetWindowPos(Handle, IntPtr.Zero, suggested.Left, suggested.Top, 0, 0,
                    Native.SwpNoSize | Native.SwpNoZOrder | Native.SwpNoActivate);
                ApplySize();
                if (dragging) dragOffset = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
                message.Result = IntPtr.Zero;
                return;
            }
            base.WndProc(ref message);
        }

        // ------------------------------------------------------- geometry --

        private bool Compact { get { return state.Compact; } }

        private List<Account> Accounts
        {
            get { return snapshot != null ? snapshot.Accounts : new List<Account>(); }
        }

        private float GaugeProgress(Account account)
        {
            LimitWindow limit = account.Selected(state.Weekly);
            float target = limit == null ? 0 : limit.RemainingPercent;
            float from;
            if (!gaugeMotion.Enabled || !gaugeFrom.TryGetValue(account.Id, out from)) return target;
            double t = Math.Min(1.0, gaugeClock.Elapsed.TotalMilliseconds / 320.0);
            double eased = t * t * (3.0 - 2.0 * t);
            return from + (target - from) * (float)eased;
        }

        private string FootLeft(Account account)
        {
            if (account.Blocked)
            {
                LimitWindow blocking = null;
                foreach (LimitWindow limit in account.Limits)
                    if (limit.RemainingPercent == 0 && (blocking == null || limit.ResetsAt < blocking.ResetsAt))
                        blocking = limit;
                if (blocking != null && blocking.ResetsAt.HasValue)
                    return "Out until " + Clock.ShortTime(blocking.ResetsAt.Value);
                return "Out of requests";
            }
            foreach (LimitWindow limit in account.Limits)
            {
                long? empty = limit.ProjectedEmptyAt;
                if (empty.HasValue)
                    return "At this pace, empty by " + Clock.ShortTime(empty.Value);
            }
            return null;
        }

        private List<string> Details(Account account)
        {
            List<string> lines = new List<string>();
            if (account.ResetCredits.HasValue)
            {
                int count = account.ResetCredits.Value;
                lines.Add(count + (count == 1 ? " reset banked" : " resets banked"));
            }
            if (account.CreditBalance.HasValue)
                lines.Add(account.CreditBalance.Value < 0 ? "Unlimited credits" :
                    String.Format(CultureInfo.InvariantCulture, "{0:N2} credits available", account.CreditBalance.Value));
            if (account.ExtraUsageEnabled)
                lines.Add(account.ExtraUsageDollars.HasValue ?
                    String.Format(CultureInfo.InvariantCulture, "Extra usage on  /  ${0:N2} used", account.ExtraUsageDollars.Value) : "Extra usage on");
            if (!String.IsNullOrEmpty(account.Warning)) lines.Add(account.Warning);
            string pace = FootLeft(account);
            if (pace != null) lines.Add(pace);
            return lines;
        }

        private string BankTooltip(Account account)
        {
            if (account.ResetCredits.GetValueOrDefault() == 0) return "No banked resets available.";
            if (account.ResetCreditDetails == null || account.ResetCreditDetails.Count == 0)
                return "Expiration dates unavailable.";
            List<string> lines = new List<string>();
            foreach (ResetCredit credit in account.ResetCreditDetails)
                lines.Add(!credit.ExpirationKnown ? "Expiration date unavailable" : !credit.ExpiresAt.HasValue ? "No expiration" :
                    "Expires " + Clock.ToLocal(credit.ExpiresAt.Value).ToString("MMM d, yyyy 'at' h:mmtt", CultureInfo.InvariantCulture));
            int missing = account.ResetCredits.GetValueOrDefault() - account.ResetCreditDetails.Count;
            if (missing > 0) lines.Add(missing + " more: expiration unavailable");
            return String.Join(Environment.NewLine, lines.ToArray());
        }

        private int BankHeight(Account account)
        {
            return bankId == account.Id ? (int)Math.Round(BankTooltip(account).Split(new string[] { Environment.NewLine }, StringSplitOptions.None).Length * 20 * bankAmount) : 0;
        }

        private void RevealBank(string next)
        {
            if (Compact || (next == bankId && bankTarget) || (next == null && !bankTarget)) return;
            if (next != null && next != bankId) { bankId = next; bankAmount = 0; }
            bankFrom = bankAmount;
            bankTarget = next != null;
            if (!SystemInformation.IsMenuAnimationEnabled)
            {
                bankMotion.Stop(); bankAmount = bankTarget ? 1.0 : 0.0;
                if (!bankTarget) bankId = null;
                ApplySize(); Invalidate(); return;
            }
            bankClock.Restart(); bankMotion.Start();
        }

        private int BlockHeight(Account account)
        {
            if (!String.IsNullOrEmpty(account.Error)) return 96;
            return 40 + Math.Max(104, account.Limits.Count * MeterRowHeight) + Details(account).Count * 20 + BankHeight(account) + 20;
        }

        private Size DesiredSize()
        {
            List<Account> accounts = Accounts;
            int count = Math.Max(1, accounts.Count);

            if (Compact)
                return new Size(
                    (accounts.Count == 0 ? 192 : CompactPad * 2 + count * CompactCell) + (hovering ? 26 : 0),
                    CompactHeight + (hoveredAccount >= 0 ? 26 : 0));

            int height = HeaderHeight;
            if (accounts.Count == 0)
                height += 66;
            foreach (Account account in accounts)
                height += BlockHeight(account) + 1;
            int available = IsHandleCreated ? (int)(Screen.FromHandle(Handle).WorkingArea.Height / dpiScale) - 32 : height + 5;
            return new Size(ExpandedWidth, Math.Min(height + 5, Math.Max(HeaderHeight + 120, available)));
        }

        private void ApplySize()
        {
            Size logical = DesiredSize();
            Size wanted = new Size((int)Math.Round(logical.Width * dpiScale), (int)Math.Round(logical.Height * dpiScale));
            motion.Stop();
            ResizeFrame(wanted);
        }

        private void AnimateCompact()
        {
            if (!Compact) return;
            Size logical = DesiredSize();
            Size wanted = new Size((int)Math.Round(logical.Width * dpiScale), (int)Math.Round(logical.Height * dpiScale));
            if (!SystemInformation.IsMenuAnimationEnabled) { motion.Stop(); ResizeFrame(wanted); return; }
            if (motion.Enabled && motionTo == wanted) return;
            motionFrom = ClientSize;
            motionTo = wanted;
            motionClock.Restart();
            motion.Start();
        }

        private void ResizeFrame(Size wanted)
        {
            if (ClientSize == wanted && Region != null)
                return;

            if (!IsHandleCreated)
            {
                ClientSize = wanted;
            }
            else
            {
                // Resize through SetWindowPos so a top-most resize never
                // re-asserts z-order and drops a full-screen game out.
                Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, wanted.Width, wanted.Height,
                    Native.SwpNoMove | Native.SwpNoZOrder | Native.SwpNoActivate);
            }

            Region previous = Region;
            using (GraphicsPath path = Draw.RoundedRect(
                new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), 16f * dpiScale))
                Region = new Region(path);
            if (previous != null)
                previous.Dispose();
            Invalidate();
        }

        private void PlaceWindow()
        {
            Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
            ApplySize();
            int x = state.X, y = state.Y;
            if (x == Int32.MinValue || y == Int32.MinValue || !AnyScreenHolds(x, y))
            {
                x = area.Right - Width - 16;
                y = area.Top + 16;
            }
            Native.SetWindowPos(Handle, IntPtr.Zero, x, y, 0, 0,
                Native.SwpNoSize | Native.SwpNoZOrder | Native.SwpNoActivate);
        }

        private static bool AnyScreenHolds(int x, int y)
        {
            foreach (Screen screen in Screen.AllScreens)
                if (screen.WorkingArea.Contains(new Point(x + 40, y + 20)))
                    return true;
            return false;
        }

        private void ApplyStayOnTop()
        {
            bool onTop = state.StayOnTop && !fullScreenApp;
            if (!IsHandleCreated)
            {
                TopMost = onTop;
                return;
            }
            Native.SetWindowPos(
                Handle,
                onTop ? Native.HwndTopMost : Native.HwndNoTopMost,
                0, 0, 0, 0,
                Native.SwpNoMove | Native.SwpNoSize | Native.SwpNoActivate);
        }

        private void PersistState()
        {
            state.X = Left;
            state.Y = Top;
            state.Save();
        }

        // -------------------------------------------------------- painting --

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Theme.ShellBottom);
            g.ScaleTransform(dpiScale, dpiScale);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.PixelOffsetMode = PixelOffsetMode.Default;
            SizeF logical = new SizeF(ClientSize.Width / dpiScale, ClientSize.Height / dpiScale);
            RectangleF shell = new RectangleF(0, 0, logical.Width, logical.Height);
            using (LinearGradientBrush brush = new LinearGradientBrush(shell,
                Theme.ShellTop, Theme.ShellBottom, LinearGradientMode.ForwardDiagonal))
                g.FillRectangle(brush, shell);
            // A continuous inset rim avoids the former bright line near the corner.
            using (GraphicsPath path = Draw.RoundedRect(Draw.Inset(shell, 1f), 15f))
            using (Pen border = new Pen(Theme.Hairline, 1f)) g.DrawPath(border, path);
            buttons.Clear();
            bankTips.Clear();
            bankAreas.Clear();
            if (!Compact) PaintHeader(g);
            if (Compact) PaintCompact(g); else PaintExpanded(g);
        }

        private void TextLine(Graphics g, string text, Font font, Color color, RectangleF bounds, bool centered)
        {
            using (StringFormat format = centered ? Draw.Centred() : Draw.Left())
                Draw.Text(g, text, font, color, bounds, format);
        }

        private void PaintExpanded(Graphics g)
        {
            if (Accounts.Count == 0)
            {
                TextLine(g, failure ?? "Reading limits...", fError, Theme.Muted,
                    new RectangleF(18, HeaderHeight + 8, ExpandedWidth - 36, 40), false);
                return;
            }
            int contentHeight = 0;
            foreach (Account account in Accounts) contentHeight += BlockHeight(account) + 1;
            int viewport = DesiredSize().Height - HeaderHeight - 5;
            if (contentHeight > viewport) viewport -= 19;
            int maximum = Math.Max(0, contentHeight - viewport);
            scrollOffset = Math.Min(scrollOffset, maximum);
            GraphicsState saved = g.Save();
            g.SetClip(new Rectangle(0, HeaderHeight, ExpandedWidth, viewport));
            g.TranslateTransform(0, -scrollOffset);
            int y = HeaderHeight;
            foreach (Account account in Accounts)
            {
                PaintAccount(g, account, y, BlockHeight(account));
                y += BlockHeight(account) + 1;
            }
            g.Restore(saved);
            if (maximum > 0)
                TextLine(g, "Scroll to see all usage details", fPlan, Theme.Muted,
                    new RectangleF(18, DesiredSize().Height - 24, ExpandedWidth - 36, 20), true);
        }

        private void PaintHeader(Graphics g)
        {
            int width = DesiredSize().Width;
            TextLine(g, "Usage", fName, Theme.Ink, new RectangleF(18, 10, 120, 22), false);
            string status = refreshing ? "Reading limits..." : failure != null ? "Offline - showing last read" :
                lastSuccess == DateTime.MinValue ? "Waiting for first read" :
                (DateTime.Now - lastSuccess).TotalMinutes > 20 ? "Stale - refresh to update" : "Updated " + LocalShort(lastSuccess);
            if (fullScreenApp && state.StayOnTop) status = "Pin paused for full screen";
            TextLine(g, status, fHeader, failure != null ? Theme.Tight : Theme.Muted,
                new RectangleF(18, 31, width - 36, 18), false);
            PaintButton(g, Hit.Pin, new Rectangle(width - 136, 10, 28, 28));
            PaintButton(g, Hit.Refresh, new Rectangle(width - 106, 10, 28, 28));
            PaintButton(g, Hit.Fold, new Rectangle(width - 76, 10, 28, 28));
            PaintButton(g, Hit.Close, new Rectangle(width - 46, 10, 28, 28));
            PaintButton(g, Hit.Hourly, new Rectangle(18, 55, 84, 27));
            PaintButton(g, Hit.Weekly, new Rectangle(106, 55, 84, 27));

        }

        private void PaintButton(Graphics g, Hit id, Rectangle bounds)
        {
            buttons[id] = bounds;
            bool selected = (id == Hit.Weekly && state.Weekly) || (id == Hit.Hourly && !state.Weekly);
            bool hot = hotButton == id;
            if (selected || hot)
                using (GraphicsPath path = Draw.RoundedRect(bounds, 8f))
                using (SolidBrush brush = new SolidBrush(selected ? Color.FromArgb(69, 79, 94) : Theme.Track))
                    g.FillPath(brush, path);
            Color color = selected || hot || (id == Hit.Pin && state.StayOnTop) ? Theme.Ink : Theme.Muted;
            if (id == Hit.Hourly || id == Hit.Weekly)
            {
                TextLine(g, Compact ? (state.Weekly ? "W" : "5h") : id == Hit.Weekly ? "Weekly" : "5-hour", Compact ? fCellLabel : fLimit, color, bounds, true);
                return;
            }
            string icon = id == Hit.Close ? "close" : id == Hit.Refresh ? "refresh" :
                id == Hit.Fold ? (Compact ? "expand" : "collapse") : state.StayOnTop ? "pin" : "unpin";
            Draw.Symbol(g, new RectangleF(bounds.X + (bounds.Width - 16) / 2f, bounds.Y + (bounds.Height - 16) / 2f, 16, 16), icon, color);
        }

        private void PaintAccount(Graphics g, Account account, int top, int height)
        {
            using (Pen line = new Pen(Theme.Hairline)) g.DrawLine(line, 18, top, ExpandedWidth - 18, top);
            Draw.Symbol(g, new RectangleF(18, top + 12, 18, 18), account.Provider, Theme.Mark(account.Provider));
            TextLine(g, account.DisplayName, fName, Theme.Ink, new RectangleF(44, top + 9, 220, 24), false);
            string plan = (account.Active ? "Active / " : "") + (account.Plan ?? "");
            using (StringFormat right = Draw.Right())
                Draw.Text(g, plan, fPlan, Theme.Muted, new RectangleF(240, top + 9, 162, 24), right);
            if (!String.IsNullOrEmpty(account.Error))
            {
                TextLine(g, account.Error, fError, Theme.Spent, new RectangleF(18, top + 40, 384, 42), false);
                return;
            }
            LimitWindow selected = account.Selected(state.Weekly);
            Draw.FocusGauge(g, new RectangleF(22, top + 43, 88, 88), selected, fGauge, fGaugeNarrow, fPlan, GaugeProgress(account));
            for (int index = 0; index < account.Limits.Count; index++)
            {
                LimitWindow limit = account.Limits[index];
                int y = top + 40 + index * MeterRowHeight;
                TextLine(g, limit.Label, fLimit, Theme.Muted, new RectangleF(GutterLeft, y, 128, 18), false);
                using (StringFormat right = Draw.Right())
                    Draw.Text(g, Clock.Countdown(limit.ResetsAt), fClock, Theme.Muted,
                        new RectangleF(GutterLeft + 120, y, 148, 18), right);
                RectangleF meter = new RectangleF(GutterLeft, y + 20, 270, 22);
                using (GraphicsPath path = Draw.RoundedRect(meter, 7f))
                using (SolidBrush track = new SolidBrush(Theme.Track)) g.FillPath(track, path);
                if (limit.RemainingPercent > 0)
                {
                    RectangleF fill = new RectangleF(meter.X, meter.Y, meter.Width * limit.RemainingPercent / 100f, meter.Height);
                    using (GraphicsPath path = Draw.RoundedRect(fill, Math.Min(7f, fill.Width / 2)))
                    using (SolidBrush brush = new SolidBrush(Color.FromArgb(48, Theme.Headroom(limit.RemainingPercent))))
                        g.FillPath(brush, path);
                }
                if (limit.ClockLeftPercent.HasValue)
                {
                    float x = meter.X + meter.Width * (float)limit.ClockLeftPercent.Value / 100f;
                    using (Pen notch = new Pen(Theme.Muted)) g.DrawLine(notch, x, meter.Bottom - 4, x, meter.Bottom - 1);
                }
                TextLine(g, limit.RemainingPercent + "%", fValue, Theme.Ink, meter, true);
            }
            int detailTop = top + 40 + Math.Max(104, account.Limits.Count * MeterRowHeight);
            foreach (string detail in Details(account))
            {
                bool bank = detail.EndsWith("reset banked") || detail.EndsWith("resets banked");
                int reveal = bank ? BankHeight(account) : 0;
                if (bank)
                {
                    bankAreas[new Rectangle(18, detailTop - scrollOffset, 384, 20 + reveal)] = account.Id;
                }
                bool warning = detail.StartsWith("Claude is rate limited") || detail.StartsWith("Expired") || detail.StartsWith("Out ") || detail.StartsWith("At this pace");
                TextLine(g, detail, fFoot, warning ? Theme.Tight : Theme.Muted,
                    new RectangleF(18, detailTop, 384, 20), false);
                detailTop += 20;
                if (reveal > 0)
                {
                    GraphicsState saved = g.Save();
                    g.SetClip(new Rectangle(18, detailTop, 384, reveal), CombineMode.Intersect);
                    int lineTop = detailTop;
                    foreach (string date in BankTooltip(account).Split(new string[] { Environment.NewLine }, StringSplitOptions.None))
                    {
                        TextLine(g, date, fFoot, Theme.Muted, new RectangleF(26, lineTop, 376, 20), false);
                        lineTop += 20;
                    }
                    g.Restore(saved);
                    detailTop += reveal;
                }
            }
        }

        private void PaintCompact(Graphics g)
        {
            if (Accounts.Count == 0)
                TextLine(g, failure ?? "Reading limits...", fError, Theme.Muted, new RectangleF(6, 6, 180, 50), true);
            for (int index = 0; index < Accounts.Count; index++)
            {
                Account account = Accounts[index];
                int x = CompactPad + index * CompactCell;
                LimitWindow selected = account.Selected(state.Weekly);
                float progress = GaugeProgress(account);
                RectangleF ring = new RectangleF(x + 12, 8, 36, 36);
                using (Pen track = new Pen(Theme.Track, 3)) g.DrawArc(track, ring, 135, 270);
                bool healthy = String.IsNullOrEmpty(account.Error) && selected != null;
                if (healthy && progress > 0)
                    using (Pen fill = new Pen(Theme.Headroom((int)Math.Round(progress)), 3))
                    {
                        fill.StartCap = fill.EndCap = LineCap.Round;
                        g.DrawArc(fill, ring, 135, 270 * progress / 100f);
                    }
                string value = healthy ? Math.Round(progress).ToString() : "--";
                TextLine(g, value, value.Length > 2 ? fTinyNarrow : fTiny, Theme.Ink, ring, true);
                using (StringFormat labelFormat = Draw.Centred())
                {
                    float labelWidth = Math.Min(46, g.MeasureString(account.DisplayName, fCellLabel, 1000, labelFormat).Width);
                    float left = x + (CompactCell - labelWidth - 13) / 2f;
                    Draw.Symbol(g, new RectangleF(left, 49, 10, 10), account.Provider, Theme.Mark(account.Provider));
                    Draw.Text(g, account.DisplayName, fCellLabel, Theme.Muted,
                        new RectangleF(left + 13, 45, labelWidth, 18), labelFormat);
                }
            }
            if (hoveredAccount >= 0 && hoveredAccount < Accounts.Count)
            {
                Account account = Accounts[hoveredAccount];
                LimitWindow selected = account.Selected(state.Weekly);
                string reset = !String.IsNullOrEmpty(account.Error) ? "Usage unavailable" :
                    selected == null || !selected.ResetsAt.HasValue ? "Reset time unavailable" :
                    "Resets " + Clock.ToLocal(selected.ResetsAt.Value).ToString("MMM d, h:mmtt", CultureInfo.InvariantCulture);
                TextLine(g, reset, fPlan, Theme.Muted,
                    new RectangleF(6, 64, ClientSize.Width / dpiScale - 12, 22), true);
            }
            if (hovering)
            {
                int x = CompactPad * 2 + Math.Max(1, Accounts.Count) * CompactCell;
                PaintButton(g, state.Weekly ? Hit.Hourly : Hit.Weekly, new Rectangle(x, 6, 22, 22));
                PaintButton(g, Hit.Fold, new Rectangle(x, 33, 22, 24));
            }
        }

        private static string LocalShort(DateTime value)
        {
            return value.ToString("h:mmtt", CultureInfo.InvariantCulture).ToLowerInvariant();
        }

        // ----------------------------------------------------- interaction --

        private Hit HitTest(Point point)
        {
            point = new Point((int)(point.X / dpiScale), (int)(point.Y / dpiScale));
            foreach (KeyValuePair<Hit, Rectangle> entry in buttons)
                if (entry.Value.Contains(point))
                    return entry.Key;
            return Hit.None;
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            if (Compact) return;
            scrollOffset = Math.Max(0, scrollOffset - e.Delta / 120 * 46);
            Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            hovering = true;
            AnimateCompact();
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            hovering = false;
            RevealBank(null);
            hoveredAccount = -1;
            AnimateCompact();
            hotButton = Hit.None;
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (dragging)
            {
                Point cursor = Cursor.Position;
                Native.SetWindowPos(Handle, IntPtr.Zero,
                    cursor.X - dragOffset.X, cursor.Y - dragOffset.Y, 0, 0,
                    Native.SwpNoSize | Native.SwpNoZOrder | Native.SwpNoActivate);
                return;
            }

            Hit hit = HitTest(e.Location);
            string tip = hit == Hit.Pin ? "Toggle always on top" :
                hit == Hit.Refresh ? "Refresh usage (Claude cooldown is respected)" : hit == Hit.Close ? "Close usage frame" : null;
            Point logical = new Point((int)(e.X / dpiScale), (int)(e.Y / dpiScale));
            if (Compact)
            {
                int next = logical.X >= CompactPad && logical.X < CompactPad + Accounts.Count * CompactCell
                    ? (logical.X - CompactPad) / CompactCell : -1;
                if (next != hoveredAccount) { hoveredAccount = next; AnimateCompact(); Invalidate(); }
            }
            if (!Compact)
            {
                string nextBank = null;
                if (logical.Y >= HeaderHeight)
                    foreach (KeyValuePair<Rectangle, string> area in bankAreas)
                        if (area.Key.Contains(logical)) { nextBank = area.Value; break; }
                RevealBank(nextBank);
            }
            if (tip == null && (Compact || logical.Y >= HeaderHeight))
                foreach (KeyValuePair<Rectangle, string> entry in bankTips)
                    if (entry.Key.Contains(logical)) { tip = entry.Value; break; }
            if (tip != currentTip) { currentTip = tip; tips.SetToolTip(this, tip); }
            if (hit != hotButton)
            {
                hotButton = hit;
                Cursor = hit == Hit.None ? Cursors.SizeAll : Cursors.Hand;
                Invalidate();
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left)
                return;

            switch (HitTest(e.Location))
            {
                case Hit.Hourly:
                case Hit.Weekly:
                    foreach (Account account in Accounts) gaugeFrom[account.Id] = GaugeProgress(account);
                    state.Weekly = HitTest(e.Location) == Hit.Weekly;
                    gaugeClock.Restart();
                    if (SystemInformation.IsMenuAnimationEnabled) gaugeMotion.Start();
                    else gaugeMotion.Stop();
                    state.Save();
                    Invalidate();
                    return;
                case Hit.Close:
                    Close();
                    return;
                case Hit.Refresh:
                    nextPoll = DateTime.MinValue;
                    BeginRefresh();
                    return;
                case Hit.Fold:
                    ToggleCompact();
                    return;
                case Hit.Pin:
                    state.StayOnTop = !state.StayOnTop;
                    ApplyStayOnTop();
                    state.Save();
                    Invalidate();
                    return;
            }

            Capture = true;
            dragging = true;
            dragOffset = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!dragging)
                return;
            dragging = false;
            Capture = false;
            PersistState();
        }

        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            base.OnMouseDoubleClick(e);
            if (HitTest(e.Location) == Hit.None)
                ToggleCompact();
        }

        private void ToggleCompact()
        {
            dragging = false;
            scrollOffset = 0;
            hoveredAccount = -1;
            bankMotion.Stop(); bankId = null; bankAmount = 0; bankTarget = false;
            state.Compact = !state.Compact;
            hotButton = Hit.None;
            ApplySize();
            state.Save();
        }

        // -------------------------------------------------------- refresh --

        private void OnTick()
        {
            tickCount++;

            if (tickCount % 2 == 0)
            {
                bool nowFullScreen = Native.FullScreenAppRunning(Handle);
                if (nowFullScreen != fullScreenApp)
                {
                    fullScreenApp = nowFullScreen;
                    ApplyStayOnTop();
                    Invalidate();
                }
            }

            // A full-screen game does not need a per-second redraw behind it.
            if (!fullScreenApp || tickCount % 5 == 0)
                Invalidate();

            if (!refreshing && Visible && DateTime.Now >= nextPoll)
                BeginRefresh();
        }

        private async void BeginRefresh()
        {
            if (refreshing)
                return;
            refreshing = true;
            Invalidate();

            try
            {
                string fileName, arguments;
                BuildCommand(out fileName, out arguments);
                string output = await Task.Run(() => RunCollector(fileName, arguments));
                Snapshot parsed = SnapshotParser.Parse(output);

                string fingerprint = parsed.Fingerprint;
                quietPolls = fingerprint == lastFingerprint ? quietPolls + 1 : 0;
                lastFingerprint = fingerprint;

                snapshot = parsed;
                failure = null;
                errorStreak = 0;
                lastSuccess = DateTime.Now;
                ApplySize();
            }
            catch (Exception exception)
            {
                failure = SnapshotParser.Sanitize(exception.Message);
                errorStreak = Math.Min(errorStreak + 1, 8);
            }
            finally
            {
                refreshing = false;
                ScheduleNextPoll();
                Invalidate();
            }
        }

        /// <summary>
        /// Poll on change, not on a metronome. Both providers answer from a
        /// cheap metadata endpoint that costs no model tokens, but there is no
        /// reason to ask every minute when nobody is running an agent.
        /// </summary>
        private void ScheduleNextPoll()
        {
            int seconds;
            if (errorStreak > 0)
            {
                seconds = (int)Math.Min(300.0, 30.0 * Math.Pow(2, errorStreak - 1));
            }
            else
            {
                bool busy = snapshot != null && snapshot.ActivityAt.HasValue
                    && Clock.UnixNow - snapshot.ActivityAt.Value < 360;
                if (busy) seconds = 60;
                else if (quietPolls <= 0) seconds = 90;
                else if (quietPolls == 1) seconds = 150;
                else if (quietPolls == 2) seconds = 300;
                else seconds = 600;

                if (fullScreenApp && !busy)
                    seconds = Math.Max(seconds, 300);

                long? soonest = SoonestReset();
                if (soonest.HasValue)
                {
                    long until = soonest.Value - Clock.UnixNow + 8;
                    if (until > 20 && until < seconds)
                        seconds = (int)until;
                }
            }

            nextPoll = DateTime.Now.AddSeconds(Math.Max(45, Math.Min(900, seconds)));
        }

        private long? SoonestReset()
        {
            if (snapshot == null)
                return null;
            long now = Clock.UnixNow;
            long? soonest = null;
            foreach (Account account in snapshot.Accounts)
                foreach (LimitWindow limit in account.Limits)
                    if (limit.ResetsAt.HasValue && limit.ResetsAt.Value > now)
                        if (!soonest.HasValue || limit.ResetsAt.Value < soonest.Value)
                            soonest = limit.ResetsAt;
            return soonest;
        }

        /// <summary>
        /// Read where the work happens. Agents driven on another box burn the
        /// same server-side quota, but only that box knows when a prompt ran,
        /// so pointing the frame at it keeps the activity signal honest.
        /// </summary>
        private bool UsesSsh
        {
            get
            {
                return String.Equals(state.Source, "ssh", StringComparison.OrdinalIgnoreCase)
                    && IsValidSshTarget(state.SshTarget);
            }
        }

        public static bool IsValidSshTarget(string target)
        {
            return !String.IsNullOrEmpty(target)
                && target.Length <= 120
                && Regex.IsMatch(target, "^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$");
        }

        private void BuildCommand(out string fileName, out string arguments)
        {
            if (UsesSsh)
            {
                fileName = "ssh.exe";
                arguments =
                    "-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "
                    + state.SshTarget + " \"" + SshCommand + "\"";
            }
            else
            {
                fileName = "wsl.exe";
                arguments = "--exec sh -lc \"" + WslCommand.Replace("\"", "\\\"") + "\"";
            }
        }

        private static string RunCollector(string fileName, string arguments)
        {
            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            using (Process process = new Process { StartInfo = start })
            {
                if (!process.Start())
                    throw new InvalidOperationException("Could not start " + fileName + ".");
                Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                Task<string> stderr = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(90000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("The collector did not answer in time.");
                }
                Task.WaitAll(new Task[] { stdout, stderr }, 5000);
                if (process.ExitCode != 0)
                {
                    string detail = String.IsNullOrWhiteSpace(stderr.Result)
                        ? "The collector failed."
                        : stderr.Result.Trim();
                    throw new InvalidOperationException(SnapshotParser.Sanitize(detail));
                }
                if (stdout.Result.Length > 1024 * 1024)
                    throw new InvalidOperationException("The collector returned too much data.");
                return stdout.Result;
            }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            motion.Stop();
            motion.Dispose();
            gaugeMotion.Stop();
            gaugeMotion.Dispose();
            bankMotion.Stop();
            bankMotion.Dispose();
            tick.Stop();
            tick.Dispose();
            tips.Dispose();
            foreach (Font font in new Font[] { fName, fPlan, fLimit, fValue, fClock, fFoot, fError, fGauge, fGaugeNarrow, fCellLabel, fCellClock, fHeader, fIcon, fTiny, fTinyNarrow }) font.Dispose();
            base.OnFormClosed(e);
        }
    }

    // ---------------------------------------------------------- self test --

    internal static class SelfTest
    {
        public static bool Run()
        {
            try
            {
                const string Fixture =
                    "{\"schema\":2,\"generatedAt\":1788837269,\"activityAt\":1788837091,\"accounts\":[" +
                    "{\"id\":\"codex:a\",\"provider\":\"codex\",\"label\":\"a\",\"plan\":\"plus\",\"active\":true," +
                    "\"error\":null,\"blocked\":false,\"resetCredits\":3,\"creditBalance\":1294.14,\"extraUsage\":null," +
                    "\"limits\":[{\"label\":\"5 hours\",\"usedPercent\":62,\"windowMins\":300,\"resetsAt\":1788853701}," +
                    "{\"label\":\"Weekly\",\"usedPercent\":30,\"windowMins\":10080,\"resetsAt\":1789400570}]}," +
                    "{\"id\":\"claude\",\"provider\":\"claude\",\"label\":\"Claude\",\"plan\":\"pro\",\"active\":false," +
                    "\"error\":null,\"blocked\":true,\"resetCredits\":null,\"creditBalance\":null," +
                    "\"extraUsage\":{\"enabled\":true,\"usedDollars\":83.85,\"reason\":null}," +
                    "\"limits\":[{\"label\":\"5 hours\",\"usedPercent\":100,\"windowMins\":300,\"resetsAt\":1788853701}]}," +
                    "{\"id\":\"codex:b\",\"provider\":\"codex\",\"label\":\"b\",\"error\":\"codex is not on PATH\"," +
                    "\"limits\":[]}]}";

                Snapshot snapshot = SnapshotParser.Parse(Fixture);
                List<bool> checks = new List<bool>
                {
                    snapshot.Accounts.Count == 3,
                    snapshot.ActivityAt == 1788837091,
                    snapshot.Accounts[0].DisplayName == "Codex a",
                    snapshot.Accounts[0].Active,
                    snapshot.Accounts[0].Selected(false).RemainingPercent == 38,
                    snapshot.Accounts[0].Selected(true).RemainingPercent == 70,
                    snapshot.Accounts[1].Selected(true) == null,
                    snapshot.Accounts[0].ResetCreditDetails == null,
                    snapshot.Accounts[0].ResetCredits == 3,
                    Math.Abs(snapshot.Accounts[0].CreditBalance.Value - 1294.14) < 0.001,
                    snapshot.Accounts[0].Limits.Count == 2,
                    snapshot.Accounts[0].Limits[0].RemainingPercent == 38,
                    snapshot.Accounts[0].Binding.Label == "5 hours",
                    snapshot.Accounts[1].DisplayName == "Claude",
                    snapshot.Accounts[1].Blocked,
                    snapshot.Accounts[1].ExtraUsageEnabled,
                    snapshot.Accounts[2].Error == "codex is not on PATH",
                    snapshot.Accounts[2].Limits.Count == 0,
                    snapshot.Fingerprint == SnapshotParser.Parse(Fixture).Fingerprint,
                    Theme.Headroom(100) == Theme.Plenty,
                    Theme.Headroom(38) == Theme.Tight,
                    Theme.Headroom(0) == Theme.Spent,
                    Clock.Countdown(Clock.UnixNow + 3600 * 26) == "1d 2h",
                    Clock.Countdown(Clock.UnixNow + 3600 * 2 + 240) == "2h 04m",
                    Clock.Countdown(Clock.UnixNow + 125) == "2:05",
                    Clock.Countdown(null) == "--",
                    UsageForm.IsValidSshTarget("user@host"),
                    UsageForm.IsValidSshTarget("nas"),
                    !UsageForm.IsValidSshTarget(""),
                    !UsageForm.IsValidSshTarget("user@host; rm -rf /"),
                    !UsageForm.IsValidSshTarget("user@host\" --oProxyCommand=x \"")
                };

                Snapshot withExpiry = SnapshotParser.Parse(Fixture.Replace("\"resetCredits\":3", "\"resetCredits\":3,\"resetCreditDetails\":[{\"expiresAt\":1893456000,\"expirationKnown\":true},{\"expiresAt\":null,\"expirationKnown\":true},{\"expiresAt\":null,\"expirationKnown\":false}]"));
                checks.Add(withExpiry.Accounts[0].ResetCreditDetails.Count == 3);
                checks.Add(withExpiry.Accounts[0].ResetCreditDetails[0].ExpiresAt == 1893456000);
                checks.Add(withExpiry.Accounts[0].ResetCreditDetails.Exists(delegate(ResetCredit c) { return !c.ExpiresAt.HasValue && c.ExpirationKnown; }));
                checks.Add(withExpiry.Accounts[0].ResetCreditDetails.Exists(delegate(ResetCredit c) { return !c.ExpirationKnown; }));
                bool sane = true;
                for (int index = 0; index < checks.Count; index++)
                    if (!checks[index])
                    {
                        Console.Error.WriteLine("self-test failed at check " + index);
                        sane = false;
                    }

                bool threw = false;
                try { SnapshotParser.Parse("not json"); }
                catch (Exception) { threw = true; }
                if (!threw)
                {
                    Console.Error.WriteLine("self-test failed: bad JSON was accepted");
                    sane = false;
                }
                return sane;
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine("self-test crashed: " + exception.Message);
                return false;
            }
        }
    }
}
