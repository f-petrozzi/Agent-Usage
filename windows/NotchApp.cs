using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace AgentUsageFrame
{
    internal sealed class NotchApp : ApplicationContext
    {
        private readonly FrameState state = FrameState.Load();
        private readonly NotchWindow body = new NotchWindow(), detail = new NotchWindow();
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 50 };
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly EventWaitHandle revealEvent, quitEvent;
        private readonly ContextMenuStrip menu = new ContextMenuStrip();
        private readonly Font title = new Font("Segoe UI", 14, FontStyle.Bold, GraphicsUnit.Pixel);
        private readonly Font text = new Font("Segoe UI", 12, FontStyle.Regular, GraphicsUnit.Pixel);
        private readonly Font small = new Font("Segoe UI", 10, FontStyle.Regular, GraphicsUnit.Pixel);
        private readonly Dictionary<string, double> readings = new Dictionary<string, double>();
        private readonly List<RectangleF> cells = new List<RectangleF>();
        private readonly NotchNative.MouseHook mouseCallback;
        private IntPtr mouseHook;
        private Snapshot snapshot;
        private string failure, lastFingerprint;
        private DateTime lastSuccess, nextPoll = DateTime.MinValue;
        private bool refreshing, disposed, wasHeld, dismissed, dirty = true, registered;
        private int hotkeyId, failures, quietPolls, selected = -1, firstAccount, detailScroll, detailMaximum, edge;
        private Keys hotkey;
        private NotchTrack track;
        private Rectangle pendingScreen, detailBounds;
        private GraphicsPath hitShape;
        private float scale = 1;
        private double position, velocity, target, amount, detailAmount, lastTime, visibleUntil, detailUntil;
        private int lastSecond = -1;

        public NotchApp(EventWaitHandle reveal, EventWaitHandle quit)
        {
            revealEvent = reveal; quitEvent = quit;
            // Creating the HWND also installs WinForms' synchronization context before async reads.
            IntPtr handle = body.Handle;
            body.Shortcut += delegate { if (!dismissed) Reveal(); };
            body.MouseUp += OnMouseUp;
            detail.MouseUp += OnMouseUp;
            mouseCallback = MouseInput;
            BuildMenu();
            RegisterShortcut(state.NotchHotkey, false);
            timer.Tick += delegate { Tick(); };
            timer.Start();
        }
        private List<Account> Accounts { get { return snapshot == null ? emptyAccounts : snapshot.Accounts; } }
        private static readonly List<Account> emptyAccounts = new List<Account>();
        private double Now { get { return clock.Elapsed.TotalSeconds; } }
        private bool Held
        {
            get
            {
                return registered && NotchNative.Down(hotkey & Keys.KeyCode)
                    && ((hotkey & Keys.Control) == 0 || NotchNative.Down(Keys.ControlKey))
                    && ((hotkey & Keys.Shift) == 0 || NotchNative.Down(Keys.ShiftKey))
                    && ((hotkey & Keys.Alt) == 0 || NotchNative.Down(Keys.Menu));
            }
        }
        private void RegisterShortcut(string value, bool save)
        {
            Keys candidate;
            if (!Enum.TryParse<Keys>(value ?? "", out candidate) || (candidate & Keys.KeyCode) == Keys.None)
                candidate = Keys.Control | Keys.Shift | Keys.Space;
            if (registered && candidate == hotkey) return;
            uint modifiers = 0x4000;
            if ((candidate & Keys.Control) != 0) modifiers |= 2;
            if ((candidate & Keys.Shift) != 0) modifiers |= 4;
            if ((candidate & Keys.Alt) != 0) modifiers |= 1;
            // Register the replacement before releasing the old binding, so a collision is recoverable.
            int nextId = hotkeyId == 1 ? 2 : 1;
            if (!NotchNative.RegisterHotKey(body.Handle, nextId, modifiers, (uint)(candidate & Keys.KeyCode)))
            {
                MessageBox.Show("That shortcut is already in use. " + (registered ? "Your previous shortcut is still active." :
                    "Open Agent Usage from Start to reveal it, then right-click and choose another shortcut."),
                    "Agent Usage", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (registered) NotchNative.UnregisterHotKey(body.Handle, hotkeyId);
            hotkeyId = nextId;
            registered = true;
            hotkey = candidate;
            if (save) { state.NotchHotkey = candidate.ToString(); state.Save(); }
        }
        private void BuildMenu()
        {
            menu.Items.Add("5-hour rings", null, delegate { state.Weekly = false; state.Save(); dirty = true; });
            menu.Items.Add("Weekly rings", null, delegate { state.Weekly = true; state.Save(); dirty = true; });
            menu.Items.Add("Refresh usage", null, delegate { Refresh(); });
            ToolStripMenuItem shortcut = new ToolStripMenuItem("Held shortcut");
            foreach (string binding in new string[] { "Control, Shift, Space", "F13", "F14", "F15" })
            {
                string choice = binding;
                shortcut.DropDownItems.Add(choice.Replace(", ", "+"), null, delegate { RegisterShortcut(choice, true); });
            }
            menu.Items.Add(shortcut);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Hide", null, delegate { Dismiss(); });
            menu.Items.Add("Quit Agent Usage", null, delegate { ExitThread(); });
            menu.Closed += delegate { visibleUntil = Now + 0.5; dirty = true; };
        }
        private void OnMouseUp(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right) menu.Show(Cursor.Position);
        }
        private void Reveal()
        {
            if (menu.Visible) return;
            Point cursor = Cursor.Position;
            if (track == null) Attach(Screen.FromPoint(cursor).Bounds, cursor);
            visibleUntil = Now + 1.5;
            dirty = true;
        }
        private void Attach(Rectangle screen, Point cursor)
        {
            track = new NotchTrack(screen);
            scale = NotchNative.Scale(cursor);
            edge = track.NearestEdge(cursor, -1, 0);
            position = target = track.Project(cursor, edge);
            velocity = 0; selected = -1; detailScroll = 0;
            pendingScreen = Rectangle.Empty;
            dirty = true;
        }
        private void Dismiss()
        {
            dismissed = true; visibleUntil = 0; selected = -1; detailUntil = 0;
            menu.Close();
            visibleUntil = 0;
        }
        private int Slots
        {
            get
            {
                int room = track == null ? 1 : Math.Max(1, (int)((Math.Min(track.Screen.Width, track.Screen.Height) / scale - 100) / 84));
                return Math.Min(Math.Max(1, Accounts.Count), Math.Min(6, room));
            }
        }
        private bool OnBody(Point point) { return body.Visible && track != null && track.Screen.Contains(point) && hitShape != null && hitShape.IsVisible(point); }
        private bool OnDetail(Point point) { return detail.Visible && detailBounds.Contains(point); }
        private void Tick()
        {
            if (disposed) return;
            if (quitEvent.WaitOne(0)) { ExitThread(); return; }
            if (revealEvent.WaitOne(0)) { dismissed = false; Reveal(); }
            double now = Now, dt = Math.Min(0.05, Math.Max(0.001, now - lastTime)); lastTime = now;
            bool held = Held;
            if (!held && amount == 0) dismissed = false;
            if (held && !wasHeld) { dismissed = false; Reveal(); }
            Point cursor = Cursor.Position;
            if (track != null && !Array.Exists(Screen.AllScreens, delegate(Screen s) { return s.Bounds == track.Screen; }))
            {
                HideSurfaces(); track = null; amount = 0;
                if (held && !dismissed) Reveal();
            }
            if (body.Visible && NotchNative.Down(Keys.Escape)) Dismiss();
            if (!refreshing && DateTime.Now >= nextPoll) Refresh();
            if (track == null) { wasHeld = held; return; }
            bool tracking = held && !dismissed && !menu.Visible;
            if (tracking)
            {
                Rectangle screen = Screen.FromPoint(cursor).Bounds;
                pendingScreen = screen != track.Screen ? screen : Rectangle.Empty;
                if (pendingScreen.IsEmpty)
                {
                    edge = track.NearestEdge(cursor, edge, 28 * scale);
                    target = track.Project(cursor, edge);
                }
                selected = -1; detailUntil = 0;
                visibleUntil = now + 1.5;
            }
            else if (wasHeld && !dismissed) visibleUntil = now + 1.5;
            wasHeld = held;
            bool inside = !dismissed && (OnBody(cursor) || OnDetail(cursor));
            if (!tracking && inside)
            {
                visibleUntil = now + 0.45;
                if (OnBody(cursor))
                {
                    for (int i = 0; i < cells.Count; i++)
                        if (cells[i].Contains(cursor) && (Accounts.Count == 0 || firstAccount + i < Accounts.Count))
                        {
                            int next = Accounts.Count == 0 ? -2 : firstAccount + i;
                            if (selected != next) { selected = next; detailScroll = 0; dirty = true; }
                            detailUntil = now + 0.35;
                        }
                }
                if (OnDetail(cursor)) detailUntil = now + 0.35;
            }
            if (menu.Visible) { visibleUntil = now + 0.45; detailUntil = now + 0.35; }
            bool wanted = !dismissed && pendingScreen.IsEmpty && (tracking || now < visibleUntil);
            double previousAmount = amount;
            bool animate = SystemInformation.IsMenuAnimationEnabled;
            amount = animate ? amount + ((wanted ? 1 : 0) - amount) * (1 - Math.Exp(-dt * 20)) : (wanted ? 1 : 0);
            if (Math.Abs(amount - (wanted ? 1 : 0)) < 0.003) amount = wanted ? 1 : 0;
            if (!pendingScreen.IsEmpty && amount < 0.015)
            {
                HideSurfaces(); amount = 0;
                Attach(pendingScreen, cursor); visibleUntil = now + 1.5; wanted = !dismissed;
            }
            if (amount == 0 && pendingScreen.IsEmpty && !wanted)
            {
                HideSurfaces(); track = null; timer.Interval = 50; return;
            }
            double oldPosition = position;
            // Release near a corner settles onto an edge so faded bend content is readable.
            double goal = tracking ? target : track.RestingPosition(position, (Slots * 84 + 48) * scale, 30 * scale);
            if (animate && Math.Abs(track.Delta(position, goal)) > 0.01)
                NotchTrack.Spring(ref position, ref velocity, track.Delta(position, goal), dt);
            else { position = goal; velocity = 0; }
            position = track.Wrap(position);
            bool detailWanted = !tracking && (selected == -2 || (selected >= 0 && selected < Accounts.Count)) && now < detailUntil && wanted;
            double oldDetail = detailAmount;
            detailAmount = animate ? detailAmount + ((detailWanted ? 1 : 0) - detailAmount) * (1 - Math.Exp(-dt * 24)) : (detailWanted ? 1 : 0);
            if (Math.Abs(detailAmount - (detailWanted ? 1 : 0)) < 0.003) detailAmount = detailWanted ? 1 : 0;
            bool gaugesMoving = false;
            foreach (Account account in Accounts)
            {
                LimitWindow limit = account.Selected(state.Weekly);
                double aim = limit == null ? 0 : Math.Max(0, Math.Min(100, limit.UsedPercent)), value;
                if (!readings.TryGetValue(account.Id, out value)) value = aim;
                if (Math.Abs(aim - value) > 0.05) { value += (aim - value) * (animate ? 1 - Math.Exp(-dt * 10) : 1); gaugesMoving = true; }
                else value = aim;
                readings[account.Id] = value;
            }
            bool moving = Math.Abs(track.Delta(oldPosition, position)) > 0.01 || previousAmount != amount || oldDetail != detailAmount || gaugesMoving;
            if ((int)now != lastSecond) { lastSecond = (int)now; dirty = true; }
            if (dirty || moving)
            {
                RenderBody();
                RenderDetail();
                dirty = false;
            }
            timer.Interval = tracking || moving ? 16 : 50;
            if (body.Visible && mouseHook == IntPtr.Zero)
                mouseHook = NotchNative.SetWindowsHookEx(14, mouseCallback, NotchNative.GetModuleHandle(null), 0);
        }
        private IntPtr MouseInput(int code, IntPtr message, IntPtr data)
        {
            if (code >= 0 && message.ToInt64() == 0x020A && !menu.Visible)
            {
                NotchNative.MouseData mouse = (NotchNative.MouseData)Marshal.PtrToStructure(data, typeof(NotchNative.MouseData));
                Point point = new Point(mouse.Point.X, mouse.Point.Y);
                bool overDetail = OnDetail(point), overBody = OnBody(point);
                if (overDetail || overBody)
                {
                    int delta = (short)(mouse.Data >> 16);
                    // Keep the hook short. Rendering and model changes run after it returns.
                    body.BeginInvoke((Action)delegate { Scroll(delta, overDetail); });
                    return new IntPtr(1);
                }
            }
            return NotchNative.CallNextHookEx(mouseHook, code, message, data);
        }
        private int wheelRemainder;
        private void Scroll(int delta, bool inDetail)
        {
            if (disposed) return;
            wheelRemainder += delta;
            int steps = wheelRemainder / 120; wheelRemainder %= 120;
            if (inDetail) detailScroll = Math.Max(0, Math.Min(detailMaximum, detailScroll - steps * 40));
            else
            {
                firstAccount = Math.Max(0, Math.Min(Math.Max(0, Accounts.Count - Slots), firstAccount - steps));
                selected = -1; detailUntil = 0;
            }
            dirty = true;
        }
        private async void Refresh()
        {
            if (refreshing || disposed) return;
            refreshing = true; dirty = true;
            try
            {
                Snapshot next = await Task.Run(() => SnapshotParser.Parse(UsageForm.ReadCollector(state)));
                if (disposed) return;
                quietPolls = next.Fingerprint == lastFingerprint ? quietPolls + 1 : 0;
                lastFingerprint = next.Fingerprint;
                string selectedId = selected >= 0 && selected < Accounts.Count ? Accounts[selected].Id : null;
                snapshot = next;
                selected = selectedId == null ? -1 : Accounts.FindIndex(delegate(Account a) { return a.Id == selectedId; });
                firstAccount = Math.Min(firstAccount, Math.Max(0, Accounts.Count - Slots));
                failure = null; failures = 0; lastSuccess = DateTime.Now;
            }
            catch (Exception error)
            {
                if (disposed) return;
                failure = SnapshotParser.Sanitize(error.Message); failures = Math.Min(failures + 1, 5);
            }
            finally
            {
                if (!disposed)
                {
                    bool busy = snapshot != null && snapshot.ActivityAt.HasValue && Clock.UnixNow - snapshot.ActivityAt.Value < 360;
                    int seconds = failures > 0 ? Math.Min(600, 45 * (1 << (failures - 1))) : busy ? 60 : Math.Min(600, 90 + quietPolls * 90);
                    nextPoll = DateTime.Now.AddSeconds(seconds);
                    refreshing = false; dirty = true;
                }
            }
        }
        private void HideSurfaces()
        {
            body.Hide(); detail.Hide(); detailAmount = 0; detailBounds = Rectangle.Empty;
            if (hitShape != null) { hitShape.Dispose(); hitShape = null; }
            cells.Clear();
            if (mouseHook != IntPtr.Zero) { NotchNative.UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        }
        protected override void ExitThreadCore()
        {
            if (disposed) return;
            disposed = true;
            timer.Stop(); timer.Dispose(); HideSurfaces();
            NotchNative.UnregisterHotKey(body.Handle, 1); NotchNative.UnregisterHotKey(body.Handle, 2);
            menu.Dispose(); body.Dispose(); detail.Dispose(); title.Dispose(); text.Dispose(); small.Dispose();
            base.ExitThreadCore();
        }
        private void RenderBody()
        {
            if (amount < 0.005 || track == null) return;
            float length = (Slots * 84 + 48) * scale;
            // A little stretch follows velocity, without changing the data-cell spacing.
            float stretch = (float)Math.Min(0.08, Math.Abs(velocity) / (30000 * scale));
            float depth = 82 * scale * (float)amount;
            using (GraphicsPath shape = track.Shape(position, length * (1 + stretch), depth))
            {
                Rectangle bounds = Rectangle.Intersect(track.Screen, Rectangle.Ceiling(shape.GetBounds()));
                if (bounds.Width < 1 || bounds.Height < 1) return;
                using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppPArgb))
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    g.TranslateTransform(-bounds.Left, -bounds.Top);
                    g.FillPath(Brushes.Black, shape);
                    g.SetClip(shape);
                    cells.Clear();
                    for (int i = 0; i < Slots; i++)
                    {
                        double place = position + (i - (Slots - 1) / 2.0) * 84 * scale;
                        PointF center = track.PointAt(place, depth / 2);
                        // Content fades at the bend while the black body wraps continuously.
                        float fade = (float)Math.Min(1, Math.Max(0, (track.CornerDistance(place) / scale - 20) / 28));
                        fade *= (float)Math.Max(0, (amount - 0.35) / 0.65);
                        RectangleF cell = new RectangleF(center.X - 37 * scale, center.Y - 37 * scale, 74 * scale, 74 * scale);
                        cells.Add(fade > 0.8 ? cell : RectangleF.Empty);
                        GraphicsState saved = g.Save();
                        g.TranslateTransform(center.X, center.Y);
                        g.ScaleTransform(scale, scale);
                        Account account = firstAccount + i < Accounts.Count ? Accounts[firstAccount + i] : Placeholder;
                        if (failure != null) fade *= 0.6f;
                        double reading = 0;
                        if (account != null) readings.TryGetValue(account.Id, out reading);
                        NotchArtwork.Cell(g, account, state.Weekly, reading, fade,
                            firstAccount + i == selected, text, small);
                        g.Restore(saved);
                    }
                    if (hitShape != null) hitShape.Dispose();
                    hitShape = (GraphicsPath)shape.Clone();
                    body.Present(bitmap, bounds.Location, 255);
                }
            }
        }
        private Account Placeholder
        {
            get { return new Account { Id = "placeholder", Provider = "", Label = failure == null ? "Loading" : "Unavailable" }; }
        }
        private string Status
        {
            get
            {
                if (failure != null) return lastSuccess == DateTime.MinValue ? failure : "Read failed; showing last reading. " + failure;
                if (refreshing && snapshot == null) return "Reading usage from your collector…";
                if (refreshing) return "Refreshing…";
                return lastSuccess == DateTime.MinValue ? "Waiting for the collector" : "Updated " + lastSuccess.ToString("h:mm tt");
            }
        }
        private void RenderDetail()
        {
            if (detailAmount < 0.005 || (selected != -2 && (selected < 0 || selected >= Accounts.Count || selected < firstAccount || selected >= firstAccount + Slots)))
            {
                detail.Hide(); detailBounds = Rectangle.Empty; return;
            }
            Account account = selected == -2 ? Placeholder : Accounts[selected];
            float width = Math.Min(330, track.Screen.Width / scale - 20), contentHeight;
            using (Bitmap measuring = new Bitmap(1, 1))
            using (Graphics g = Graphics.FromImage(measuring))
                contentHeight = NotchArtwork.Content(g, account, Status, text, width - 36, false);
            float height = Math.Min(86 + contentHeight, Math.Min(470, track.Screen.Height / scale - 24));
            detailMaximum = Math.Max(0, (int)Math.Ceiling(contentHeight - (height - 86)));
            detailScroll = Math.Min(detailScroll, detailMaximum);
            double place = position + ((selected == -2 ? 0 : selected - firstAccount) - (Slots - 1) / 2.0) * 84 * scale;
            PointF anchor = track.PointAt(place, 82 * scale);
            int w = (int)Math.Ceiling(width * scale), h = (int)Math.Ceiling(height * scale);
            int x = (int)(anchor.X - w / 2), y = (int)(anchor.Y - h / 2);
            int gap = (int)((8 + (1 - detailAmount) * 10) * scale);
            switch (track.Edge(place))
            {
                case 0: y = (int)anchor.Y + gap; break;
                case 1: x = (int)anchor.X - w - gap; break;
                case 2: y = (int)anchor.Y - h - gap; break;
                case 3: x = (int)anchor.X + gap; break;
            }
            x = Math.Max(track.Screen.Left + 4, Math.Min(track.Screen.Right - w - 4, x));
            y = Math.Max(track.Screen.Top + 4, Math.Min(track.Screen.Bottom - h - 4, y));
            detailBounds = new Rectangle(x, y, w, h);
            using (Bitmap bitmap = new Bitmap(w, h, PixelFormat.Format32bppPArgb))
            using (Graphics g = Graphics.FromImage(bitmap))
            {
                g.ScaleTransform(scale, scale);
                NotchArtwork.Card(g, account, Status, width, height, detailScroll, detailMaximum, title, text, small);
                detail.Present(bitmap, detailBounds.Location, (byte)(detailAmount * 255));
            }
        }
    }

    internal static class NotchArtwork
    {
        private static readonly Color Muted = Color.FromArgb(160, 164, 174);
        internal static Color UsageColor(double used)
        {
            if (used < 50) return Color.FromArgb(53, 226, 143);
            if (used < 80) return Color.FromArgb(247, 204, 72);
            return Color.FromArgb(255, 112, 74);
        }
        private static void Label(Graphics g, string value, Font font, Color color, RectangleF box, bool center)
        {
            using (Brush brush = new SolidBrush(color))
            using (StringFormat format = new StringFormat { Alignment = center ? StringAlignment.Center : StringAlignment.Near,
                LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString(value, font, brush, box, format);
        }
        internal static void Cell(Graphics g, Account account, bool weekly, double reading, float opacity, bool selected, Font text, Font small)
        {
            int alpha = Math.Max(0, Math.Min(255, (int)(opacity * 255)));
            if (selected)
                using (Brush brush = new SolidBrush(Color.FromArgb(alpha, 24, 24, 27)))
                using (GraphicsPath p = Draw.RoundedRect(new RectangleF(-34, -37, 68, 74), 18)) g.FillPath(brush, p);
            RectangleF ring = new RectangleF(-18, -27, 36, 36);
            using (Pen pen = new Pen(Color.FromArgb(alpha, 48, 49, 53), 3)) g.DrawEllipse(pen, ring);
            LimitWindow limit = account == null ? null : account.Selected(weekly);
            bool stale = account != null && (!String.IsNullOrEmpty(account.Error) || !String.IsNullOrEmpty(account.Warning));
            if (limit != null && reading > 0)
                using (Pen pen = new Pen(Color.FromArgb(stale ? alpha / 2 : alpha, UsageColor(reading)), 3))
                {
                    pen.StartCap = pen.EndCap = LineCap.Round;
                    int steps = Math.Max(1, (int)Math.Ceiling(reading * 1.8));
                    PointF[] points = new PointF[steps + 1];
                    for (int i = 0; i <= steps; i++)
                    {
                        double angle = (-90 + 3.6 * Math.Min(100, reading) * i / steps) * Math.PI / 180;
                        points[i] = new PointF((float)Math.Cos(angle) * 18, -9 + (float)Math.Sin(angle) * 18);
                    }
                    g.DrawLines(pen, points);
                }
            if (account != null && !String.IsNullOrEmpty(account.Provider)) Draw.Symbol(g, new RectangleF(-10, -19, 20, 20), account.Provider, Color.FromArgb(alpha, Color.White));
            else Label(g, "…", text, Color.FromArgb(alpha, Color.White), new RectangleF(-16, -23, 32, 24), true);
            string value = limit == null ? "—" : limit.UsedPercent + "%";
            Label(g, value + (stale ? " !" : ""), text, Color.FromArgb(alpha, Color.White), new RectangleF(-35, 11, 70, 18), true);
            Label(g, account == null ? "Loading" : account.DisplayName, small, Color.FromArgb(alpha, Muted), new RectangleF(-36, 28, 72, 13), true);
        }
        // The same pass measures and paints wrapped content, so scroll limits match the pixels.
        internal static float Content(Graphics g, Account account, string status, Font font, float width, bool paint)
        {
            float y = 0;
            foreach (LimitWindow limit in account.Limits)
            {
                if (paint)
                {
                    Label(g, limit.Label, font, Color.White, new RectangleF(0, y, width - 70, 20), false);
                    Label(g, limit.UsedPercent + "% used", font, UsageColor(limit.UsedPercent), new RectangleF(width - 70, y, 70, 20), false);
                    using (Brush track = new SolidBrush(Color.FromArgb(43, 44, 48)))
                    using (GraphicsPath path = Draw.RoundedRect(new RectangleF(0, y + 27, width, 5), 2.5f)) g.FillPath(track, path);
                    float filled = width * Math.Max(0, Math.Min(100, limit.UsedPercent)) / 100f;
                    if (filled > 0) using (Brush brush = new SolidBrush(UsageColor(limit.UsedPercent))) g.FillRectangle(brush, 0, y + 27, filled, 5);
                    Label(g, "Resets in " + Clock.Countdown(limit.ResetsAt), font, Muted, new RectangleF(0, y + 38, width, 20), false);
                }
                y += 76;
            }
            List<string> lines = new List<string>();
            if (account.Limits.Count == 0) lines.Add("No usage windows available.");
            if (!String.IsNullOrEmpty(account.Error)) lines.Add("Usage unavailable or stale: " + account.Error);
            if (!String.IsNullOrEmpty(account.Warning)) lines.Add(account.Warning);
            if (account.Blocked) lines.Add("Limit reached — waiting for reset.");
            if (account.ResetCredits.HasValue) lines.Add(account.ResetCredits + " banked resets");
            if (account.ResetCreditDetails != null)
                foreach (ResetCredit credit in account.ResetCreditDetails)
                    lines.Add(!credit.ExpirationKnown ? "Reset expiry unknown" : !credit.ExpiresAt.HasValue ? "Reset does not expire" :
                        "Reset expires " + Clock.ToLocal(credit.ExpiresAt.Value).ToString("MMM d, h:mm tt"));
            if (account.CreditBalance.HasValue) lines.Add(account.CreditBalance.Value < 0 ? "Unlimited credits" : account.CreditBalance.Value.ToString("N2") + " credits available");
            if (account.ExtraUsageEnabled) lines.Add(account.ExtraUsageDollars.HasValue ? "$" + account.ExtraUsageDollars.Value.ToString("N2") + " extra usage" : "Extra usage enabled");
            if (account.SampledAt.HasValue) lines.Add("Sampled " + Clock.ToLocal(account.SampledAt.Value).ToString("MMM d, h:mm tt"));
            lines.Add(status);
            foreach (string line in lines)
            {
                float h = Math.Max(22, g.MeasureString(line, font, (int)width).Height + 8);
                if (paint) using (Brush brush = new SolidBrush(Muted)) g.DrawString(line, font, brush, new RectangleF(0, y, width, h));
                y += h;
            }
            return y;
        }
        internal static void Card(Graphics g, Account account, string status, float width, float height, int scroll, int maximum,
            Font title, Font text, Font small)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (GraphicsPath path = Draw.RoundedRect(new RectangleF(0, 0, width, height), 20)) g.FillPath(Brushes.Black, path);
            if (!String.IsNullOrEmpty(account.Provider)) Draw.Symbol(g, new RectangleF(18, 18, 23, 23), account.Provider, Theme.Mark(account.Provider));
            Label(g, account.DisplayName + " usage", title, Color.White, new RectangleF(50, 13, width - 66, 23), false);
            Label(g, String.IsNullOrEmpty(account.Plan) ? "Allowance and reset times" : account.Plan,
                small, Muted, new RectangleF(50, 36, width - 66, 16), false);
            GraphicsState saved = g.Save();
            g.SetClip(new RectangleF(18, 66, width - 36, height - 86));
            g.TranslateTransform(18, 66 - scroll);
            Content(g, account, status, text, width - 36, true);
            g.Restore(saved);
            if (maximum > 0)
            {
                float viewport = height - 86, thumb = Math.Max(20, viewport * viewport / (viewport + maximum));
                float top = 66 + (viewport - thumb) * scroll / maximum;
                using (Brush brush = new SolidBrush(Color.FromArgb(92, 94, 101))) g.FillRectangle(brush, width - 8, top, 2, thumb);
            }
        }
    }
}
