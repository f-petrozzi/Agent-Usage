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

    internal sealed class Account
    {
        public string Id { get; set; }
        public string Provider { get; set; }
        public string Label { get; set; }
        public string Plan { get; set; }
        public bool Active { get; set; }
        public bool Blocked { get; set; }
        public string Error { get; set; }
        public int? ResetCredits { get; set; }
        public double? CreditBalance { get; set; }
        public bool ExtraUsageEnabled { get; set; }
        public double? ExtraUsageDollars { get; set; }
        public List<LimitWindow> Limits { get; private set; }

        public Account() { Limits = new List<LimitWindow>(); }

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
                    ResetCredits = (int?)Long(row, "resetCredits"),
                    CreditBalance = Number(row, "creditBalance")
                };

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
        public static readonly Color ShellTop = Color.FromArgb(24, 32, 41);
        public static readonly Color ShellBottom = Color.FromArgb(17, 22, 29);
        public static readonly Color Hairline = Color.FromArgb(38, 50, 65);
        public static readonly Color Track = Color.FromArgb(31, 41, 53);
        public static readonly Color Ink = Color.FromArgb(232, 238, 244);
        public static readonly Color Muted = Color.FromArgb(138, 154, 171);
        public static readonly Color Faint = Color.FromArgb(94, 110, 127);

        // Headroom ramp. Colour answers "how much is left", never "which brand".
        public static readonly Color Plenty = Color.FromArgb(79, 209, 176);
        public static readonly Color Tight = Color.FromArgb(242, 178, 76);
        public static readonly Color Spent = Color.FromArgb(255, 107, 114);

        public static readonly Color CodexMark = Color.FromArgb(15, 164, 127);
        public static readonly Color ClaudeMark = Color.FromArgb(201, 113, 79);

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
            Pick("Bahnschrift SemiCondensed", "Bahnschrift", "Segoe UI Semibold");
        private static readonly string ProseName = Pick("Segoe UI");
        private static readonly string ClockName = Pick("Cascadia Mono", "Consolas", "Courier New");
        private static readonly string IconName = Pick("Segoe MDL2 Assets", "Segoe UI Symbol");

        public static readonly bool HasIconFont = Installed.Contains("Segoe MDL2 Assets");

        public static Font Instrument(float size, FontStyle style)
        {
            return new Font(InstrumentName, size, style, GraphicsUnit.Point);
        }

        public static Font Prose(float size)
        {
            return new Font(ProseName, size, FontStyle.Regular, GraphicsUnit.Point);
        }

        public static Font ClockFace(float size)
        {
            return new Font(ClockName, size, FontStyle.Regular, GraphicsUnit.Point);
        }

        public static Font Icons(float size)
        {
            return new Font(IconName, size, FontStyle.Regular, GraphicsUnit.Point);
        }
    }

    // ------------------------------------------------------------ drawing --

    internal static class Draw
    {
        public const float GaugeStartAngle = 135f;
        public const float GaugeSweepAngle = 270f;

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

        /// <summary>
        /// Concentric depletion arcs: the outer ring is the short window, the inner
        /// ring the long one. Both drain as usage climbs, and a notch marks how much
        /// of the window's clock is left -- fill past the notch means you are ahead.
        /// </summary>
        public static void Gauge(
            Graphics g, RectangleF bounds, Account account, Font centreFont, Font narrowFont)
        {
            float thickness = bounds.Width >= 44f ? 5f : 4f;
            // Rings sit close together so the well at the centre stays wide
            // enough for a two-digit readout in any fallback face.
            float gap = thickness + 1.5f;

            for (int index = 0; index < 2; index++)
            {
                RectangleF ring = Inset(bounds, thickness / 2f + index * gap);
                if (ring.Width <= 2f)
                    break;

                LimitWindow limit = index < account.Limits.Count ? account.Limits[index] : null;
                float ringThickness = index == 0 ? thickness : Math.Max(2.5f, thickness - 1.5f);

                using (Pen track = new Pen(Theme.Track, ringThickness))
                {
                    track.StartCap = LineCap.Round;
                    track.EndCap = LineCap.Round;
                    g.DrawArc(track, ring, GaugeStartAngle, GaugeSweepAngle);
                }

                if (limit == null || !String.IsNullOrEmpty(account.Error))
                    continue;

                float remaining = limit.RemainingPercent / 100f;
                if (remaining > 0.004f)
                {
                    using (Pen fill = new Pen(Theme.Headroom(limit.RemainingPercent), ringThickness))
                    {
                        fill.StartCap = LineCap.Round;
                        fill.EndCap = LineCap.Round;
                        g.DrawArc(fill, ring, GaugeStartAngle, GaugeSweepAngle * remaining);
                    }
                }

                double? clockLeft = limit.ClockLeftPercent;
                if (clockLeft.HasValue)
                    PaceNotch(g, ring, (float)(clockLeft.Value / 100.0), ringThickness);
            }

            LimitWindow binding = account.Binding;
            string centre = "--";
            Color centreColor = Theme.Faint;
            if (!String.IsNullOrEmpty(account.Error))
            {
                centre = "!";
                centreColor = Theme.Spent;
            }
            else if (binding != null)
            {
                centre = binding.RemainingPercent.ToString(CultureInfo.InvariantCulture);
                centreColor = Theme.Headroom(binding.RemainingPercent);
            }

            using (SolidBrush brush = new SolidBrush(centreColor))
            using (StringFormat format = Centred())
                g.DrawString(centre, centre.Length > 2 ? narrowFont : centreFont, brush, bounds, format);
        }

        private static void PaceNotch(Graphics g, RectangleF ring, float fraction, float thickness)
        {
            double angle = (GaugeStartAngle + GaugeSweepAngle * fraction) * Math.PI / 180.0;
            float cx = ring.Left + ring.Width / 2f;
            float cy = ring.Top + ring.Height / 2f;
            float radius = ring.Width / 2f;
            float inner = radius - thickness / 2f - 0.5f;
            float outer = radius + thickness / 2f + 0.5f;
            PointF from = new PointF(cx + (float)(Math.Cos(angle) * inner), cy + (float)(Math.Sin(angle) * inner));
            PointF to = new PointF(cx + (float)(Math.Cos(angle) * outer), cy + (float)(Math.Sin(angle) * outer));

            using (Pen shadow = new Pen(Theme.ShellBottom, 2.6f))
                g.DrawLine(shadow, from, to);
            using (Pen mark = new Pen(Color.FromArgb(210, Theme.Ink), 1.1f))
                g.DrawLine(mark, from, to);
        }

        /// <summary>A linear depletion meter carrying the same notch as the gauge.</summary>
        public static void Meter(Graphics g, RectangleF bounds, LimitWindow limit)
        {
            using (GraphicsPath track = RoundedRect(bounds, bounds.Height / 2f))
            using (SolidBrush brush = new SolidBrush(Theme.Track))
                g.FillPath(brush, track);

            float remaining = limit.RemainingPercent / 100f;
            if (remaining > 0.004f)
            {
                float width = Math.Max(bounds.Height, bounds.Width * remaining);
                RectangleF fill = new RectangleF(bounds.X, bounds.Y, width, bounds.Height);
                using (GraphicsPath path = RoundedRect(fill, bounds.Height / 2f))
                using (SolidBrush brush = new SolidBrush(Theme.Headroom(limit.RemainingPercent)))
                    g.FillPath(brush, path);
            }

            double? clockLeft = limit.ClockLeftPercent;
            if (!clockLeft.HasValue)
                return;

            float x = bounds.X + bounds.Width * (float)(clockLeft.Value / 100.0);
            x = Math.Max(bounds.X + 1f, Math.Min(bounds.Right - 1f, x));
            using (SolidBrush gapBrush = new SolidBrush(Theme.ShellBottom))
                g.FillRectangle(gapBrush, x - 1.5f, bounds.Y - 1.5f, 3f, bounds.Height + 3f);
            using (SolidBrush markBrush = new SolidBrush(Color.FromArgb(210, Theme.Ink)))
                g.FillRectangle(markBrush, x - 0.5f, bounds.Y - 1.5f, 1f, bounds.Height + 3f);
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
        public bool StayOnTop { get; set; }

        /// <summary>"wsl" reads the collector in the local WSL distribution;
        /// "ssh" reads it on the machine named by <see cref="SshTarget"/>.</summary>
        public string Source { get; set; }
        public string SshTarget { get; set; }

        public FrameState()
        {
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
        private const int ExpandedWidth = 404;
        private const int HeaderHeight = 34;
        private const int GutterLeft = 74;
        private const int GutterRight = 14;
        private const int MeterRowHeight = 28;
        private const int CompactCell = 82;
        private const int CompactPad = 10;
        private const int CompactHeight = 82;

        private const string WslCommand =
            "exec \"$HOME/.local/bin/agent-usage\" --timeout 20 --compact";
        private const string SshCommand =
            "~/.local/bin/agent-usage --timeout 20 --compact";

        private enum Hit { None, Pin, Refresh, Fold, Close }

        private readonly Font fName, fPlan, fLimit, fValue, fClock, fFoot, fError;
        private readonly Font fGauge, fGaugeNarrow, fCellLabel, fCellClock, fHeader, fIcon;

        private readonly FrameState state;
        private readonly Timer tick;
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
        private Hit hotButton = Hit.None;
        private bool dragging;
        private Point dragOffset;
        private int tickCount;

        public UsageForm()
        {
            state = FrameState.Load();

            fName = Theme.Instrument(10f, FontStyle.Bold);
            fPlan = Theme.Prose(7.5f);
            fLimit = Theme.Instrument(9f, FontStyle.Regular);
            fValue = Theme.Instrument(9.5f, FontStyle.Bold);
            fClock = Theme.ClockFace(8f);
            fFoot = Theme.Prose(7.5f);
            fError = Theme.Prose(8.25f);
            fGauge = Theme.Instrument(11f, FontStyle.Bold);
            fGaugeNarrow = Theme.Instrument(8.5f, FontStyle.Bold);
            fCellLabel = Theme.Instrument(8f, FontStyle.Regular);
            fCellClock = Theme.ClockFace(7.5f);
            fHeader = Theme.Prose(8f);
            fIcon = Theme.Icons(8.5f);

            Text = "Agent usage";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AllowTransparency = true;
            Opacity = 0.96;
            BackColor = Theme.ShellBottom;
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

            ClientSize = new Size(ExpandedWidth, 200);
            ApplyStayOnTop();

            tick = new Timer { Interval = 1000 };
            tick.Tick += delegate { OnTick(); };

            Shown += delegate
            {
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
            base.WndProc(ref message);
        }

        // ------------------------------------------------------- geometry --

        private bool Compact { get { return state.Compact; } }

        private List<Account> Accounts
        {
            get { return snapshot != null ? snapshot.Accounts : new List<Account>(); }
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

        private string FootRight(Account account)
        {
            if (account.ResetCredits.HasValue && account.ResetCredits.Value > 0)
                return account.ResetCredits.Value == 1
                    ? "1 reset banked"
                    : account.ResetCredits.Value + " resets banked";
            if (account.CreditBalance.HasValue && account.CreditBalance.Value > 0)
                return String.Format(CultureInfo.InvariantCulture, "{0:N0} credits", account.CreditBalance.Value);
            if (account.ExtraUsageEnabled)
                return account.ExtraUsageDollars.HasValue
                    ? String.Format(CultureInfo.InvariantCulture, "${0:N2} extra usage", account.ExtraUsageDollars.Value)
                    : "Extra usage on";
            return null;
        }

        private int BlockHeight(Account account)
        {
            if (!String.IsNullOrEmpty(account.Error))
                return 66;
            int rows = Math.Min(3, account.Limits.Count);
            int height = 8 + 18 + 4 + rows * MeterRowHeight + 8;
            if (FootLeft(account) != null || FootRight(account) != null)
                height += 15;
            return height;
        }

        private Size DesiredSize()
        {
            List<Account> accounts = Accounts;
            int count = Math.Max(1, accounts.Count);

            if (Compact)
                return new Size(
                    accounts.Count == 0 ? 200 : CompactPad * 2 + count * CompactCell,
                    CompactHeight);

            int height = HeaderHeight;
            if (accounts.Count == 0)
                height += 66;
            foreach (Account account in accounts)
                height += BlockHeight(account) + 1;
            return new Size(ExpandedWidth, height + 5);
        }

        private void ApplySize()
        {
            Size wanted = DesiredSize();
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
                new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), 10f))
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
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;

            RectangleF shell = new RectangleF(0, 0, ClientSize.Width, ClientSize.Height);
            using (GraphicsPath path = Draw.RoundedRect(shell, 10f))
            using (LinearGradientBrush brush = new LinearGradientBrush(
                new RectangleF(0, -1, shell.Width, shell.Height + 2),
                Theme.ShellTop, Theme.ShellBottom, LinearGradientMode.Vertical))
                g.FillPath(brush, path);

            // A single lit edge along the top reads as glass rather than paint.
            using (Pen edge = new Pen(Color.FromArgb(26, 255, 255, 255)))
                g.DrawLine(edge, 10, 1, shell.Width - 10, 1);
            using (GraphicsPath path = Draw.RoundedRect(Draw.Inset(shell, 0.5f), 9.5f))
            using (Pen border = new Pen(Color.FromArgb(150, Theme.Hairline)))
                g.DrawPath(border, path);

            buttons.Clear();
            if (Compact)
                PaintCompact(g);
            else
                PaintExpanded(g);
        }

        private void PaintExpanded(Graphics g)
        {
            PaintHeader(g);

            int y = HeaderHeight;
            List<Account> accounts = Accounts;
            if (accounts.Count == 0)
            {
                using (StringFormat format = Draw.Left())
                    Draw.Text(g, failure ?? "Reading limits\u2026", fError, failure != null ? Theme.Spent : Theme.Muted,
                        new RectangleF(GutterLeft - 60, y, ExpandedWidth - GutterLeft, 66), format);
                return;
            }

            for (int index = 0; index < accounts.Count; index++)
            {
                Account account = accounts[index];
                int height = BlockHeight(account);
                PaintAccount(g, account, y, height);
                y += height;
                if (index < accounts.Count - 1)
                    using (Pen line = new Pen(Theme.Hairline))
                        g.DrawLine(line, 14, y, ExpandedWidth - 14, y);
                y += 1;
            }
        }

        private void PaintHeader(Graphics g)
        {
            string status;
            Color color;
            if (refreshing)
            {
                status = "Reading limits\u2026";
                color = Theme.Faint;
            }
            else if (failure != null)
            {
                status = "Can't read limits";
                color = Theme.Spent;
            }
            else if (lastSuccess == DateTime.MinValue)
            {
                status = "Waiting";
                color = Theme.Faint;
            }
            else
            {
                bool stale = (DateTime.Now - lastSuccess).TotalMinutes > 20;
                status = (stale ? "Last read " : "Updated ") + LocalShort(lastSuccess);
                color = stale ? Theme.Tight : Theme.Muted;
            }
            if (fullScreenApp && state.StayOnTop)
                status += "   pin paused for full screen";

            using (StringFormat format = Draw.Left())
                Draw.Text(g, status, fHeader, color, new RectangleF(14, 0, 260, HeaderHeight), format);

            int right = ExpandedWidth - 8;
            PaintButton(g, Hit.Close, new Rectangle(right - 24, 6, 24, 22), Glyph.Close);
            PaintButton(g, Hit.Fold, new Rectangle(right - 48, 6, 24, 22), Glyph.Collapse);
            PaintButton(g, Hit.Refresh, new Rectangle(right - 72, 6, 24, 22), Glyph.Refresh);
            PaintButton(g, Hit.Pin, new Rectangle(right - 96, 6, 24, 22),
                state.StayOnTop ? Glyph.Pinned : Glyph.Unpinned);

            using (Pen line = new Pen(Theme.Hairline))
                g.DrawLine(line, 14, HeaderHeight - 1, ExpandedWidth - 14, HeaderHeight - 1);
        }

        private void PaintButton(Graphics g, Hit id, Rectangle bounds, string glyph)
        {
            buttons[id] = bounds;
            bool hot = hotButton == id;
            if (hot)
                using (GraphicsPath path = Draw.RoundedRect(new RectangleF(bounds.X, bounds.Y, bounds.Width, bounds.Height), 5f))
                using (SolidBrush brush = new SolidBrush(Theme.Track))
                    g.FillPath(brush, path);

            Color color = Theme.Faint;
            if (hot)
                color = id == Hit.Close ? Theme.Spent : Theme.Ink;
            else if (id == Hit.Pin && state.StayOnTop)
                color = fullScreenApp ? Theme.Tight : Theme.Muted;

            using (StringFormat format = Draw.Centred())
                Draw.Text(g, glyph, fIcon, color, bounds, format);
        }

        private void PaintAccount(Graphics g, Account account, int top, int height)
        {
            Color mark = Theme.Mark(account.Provider);
            using (GraphicsPath bar = Draw.RoundedRect(new RectangleF(1.5f, top + 12, 2.5f, height - 24), 1.25f))
            using (SolidBrush brush = new SolidBrush(mark))
                g.FillPath(brush, bar);

            RectangleF gauge = new RectangleF(14, top + 8, 48, 48);
            using (SolidBrush tint = new SolidBrush(Color.FromArgb(22, mark)))
                g.FillEllipse(tint, Draw.Inset(gauge, 9f));
            Draw.Gauge(g, gauge, account, fGauge, fGaugeNarrow);

            int width = ExpandedWidth - GutterLeft - GutterRight;
            using (StringFormat left = Draw.Left())
            using (StringFormat right = Draw.Right())
            {
                if (account.Active)
                    using (SolidBrush dot = new SolidBrush(Theme.Plenty))
                        g.FillEllipse(dot, GutterLeft - 9, top + 15, 4.5f, 4.5f);

                Draw.Text(g, account.DisplayName, fName, Theme.Ink,
                    new RectangleF(GutterLeft, top + 8, width - 90, 18), left);
                if (!String.IsNullOrEmpty(account.Plan))
                    Draw.Text(g, account.Plan, fPlan, Theme.Faint,
                        new RectangleF(GutterLeft, top + 9, width, 18), right);

                if (!String.IsNullOrEmpty(account.Error))
                {
                    using (StringFormat wrap = new StringFormat { Trimming = StringTrimming.EllipsisCharacter })
                        Draw.Text(g, account.Error, fError, Theme.Spent,
                            new RectangleF(GutterLeft, top + 29, width, 30), wrap);
                    return;
                }

                int rows = Math.Min(3, account.Limits.Count);
                for (int index = 0; index < rows; index++)
                {
                    LimitWindow limit = account.Limits[index];
                    int rowTop = top + 30 + index * MeterRowHeight;
                    Color headroom = Theme.Headroom(limit.RemainingPercent);

                    Draw.Text(g, limit.Label, fLimit, Theme.Muted,
                        new RectangleF(GutterLeft, rowTop, 130, 15), left);
                    Draw.Text(g,
                        limit.RemainingPercent.ToString(CultureInfo.InvariantCulture) + "% left",
                        fValue, headroom,
                        new RectangleF(GutterLeft + 120, rowTop, 134, 15), right);

                    bool urgent = limit.ResetsAt.HasValue && limit.ResetsAt.Value - Clock.UnixNow < 600;
                    Draw.Text(g, Clock.Countdown(limit.ResetsAt), fClock,
                        urgent ? Theme.Tight : Theme.Faint,
                        new RectangleF(GutterLeft, rowTop, width, 15), right);

                    Draw.Meter(g, new RectangleF(GutterLeft, rowTop + 18, width, 5), limit);
                }

                string footLeft = FootLeft(account);
                string footRight = FootRight(account);
                if (footLeft != null || footRight != null)
                {
                    int footTop = top + 30 + rows * MeterRowHeight + 2;
                    if (footLeft != null)
                        Draw.Text(g, footLeft, fFoot, account.Blocked ? Theme.Spent : Theme.Tight,
                            new RectangleF(GutterLeft, footTop, width - 110, 14), left);
                    if (footRight != null)
                        Draw.Text(g, footRight, fFoot, Theme.Faint,
                            new RectangleF(GutterLeft, footTop, width, 14), right);
                }
            }
        }

        private void PaintCompact(Graphics g)
        {
            List<Account> accounts = Accounts;
            using (StringFormat centred = Draw.Centred())
            {
                if (accounts.Count == 0)
                {
                    Draw.Text(g, failure != null ? "Can't read limits" : "Reading limits\u2026", fError,
                        failure != null ? Theme.Spent : Theme.Muted,
                        new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), centred);
                }

                for (int index = 0; index < accounts.Count; index++)
                {
                    Account account = accounts[index];
                    int cellX = CompactPad + index * CompactCell;
                    LimitWindow binding = account.Binding;
                    RectangleF gauge = new RectangleF(cellX + 19, 8, 44, 44);
                    using (SolidBrush tint = new SolidBrush(Color.FromArgb(22, Theme.Mark(account.Provider))))
                        g.FillEllipse(tint, Draw.Inset(gauge, 8f));
                    Draw.Gauge(g, gauge, account, fGauge, fGaugeNarrow);

                    Draw.Text(g, account.DisplayName, fCellLabel, Theme.Muted,
                        new RectangleF(cellX, 53, CompactCell, 12), centred);

                    bool healthy = String.IsNullOrEmpty(account.Error) && binding != null;
                    string clock = healthy ? Clock.Countdown(binding.ResetsAt) : "--";
                    bool urgent = healthy && binding.ResetsAt.HasValue
                        && binding.ResetsAt.Value - Clock.UnixNow < 600;
                    Draw.Text(g, clock, fCellClock, urgent ? Theme.Tight : Theme.Faint,
                        new RectangleF(cellX, 65, CompactCell, 12), centred);
                }
            }

            if (hovering)
            {
                int right = ClientSize.Width - 4;
                PaintButton(g, Hit.Close, new Rectangle(right - 20, 3, 20, 18), Glyph.Close);
                PaintButton(g, Hit.Fold, new Rectangle(right - 40, 3, 20, 18), Glyph.Expand);
            }
        }

        private static string LocalShort(DateTime value)
        {
            return value.ToString("h:mmtt", CultureInfo.InvariantCulture).ToLowerInvariant();
        }

        private static class Glyph
        {
            public static string Close { get { return Theme.HasIconFont ? "\uE711" : "\u00D7"; } }
            public static string Refresh { get { return Theme.HasIconFont ? "\uE72C" : "\u21BB"; } }
            public static string Collapse { get { return Theme.HasIconFont ? "\uE70E" : "\u2303"; } }
            public static string Expand { get { return Theme.HasIconFont ? "\uE70D" : "\u2304"; } }
            public static string Pinned { get { return Theme.HasIconFont ? "\uE718" : "\u25CF"; } }
            public static string Unpinned { get { return Theme.HasIconFont ? "\uE77A" : "\u25CB"; } }
        }

        // ----------------------------------------------------- interaction --

        private Hit HitTest(Point point)
        {
            foreach (KeyValuePair<Hit, Rectangle> entry in buttons)
                if (entry.Value.Contains(point))
                    return entry.Key;
            return Hit.None;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            hovering = true;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            hovering = false;
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

            dragging = true;
            dragOffset = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!dragging)
                return;
            dragging = false;
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
            tick.Stop();
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
