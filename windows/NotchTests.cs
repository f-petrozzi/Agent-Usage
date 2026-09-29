using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace AgentUsageFrame
{
    internal static class NotchTests
    {
        private static int checks;
        private static void Check(bool condition, string message)
        {
            checks++;
            if (!condition) throw new Exception(message);
        }
        internal static bool Run(string previewDirectory)
        {
            try
            {
                checks = 0;
                foreach (Rectangle screen in new Rectangle[] { new Rectangle(0, 0, 1920, 1080),
                    new Rectangle(-2560, -360, 2560, 1440), new Rectangle(1920, -1080, 1080, 1920) })
                {
                    NotchTrack track = new NotchTrack(screen);
                    Check(track.NearestEdge(new Point(screen.Left + 10, screen.Top + 100), -1, 0) == 3, "left edge");
                    Check(track.NearestEdge(new Point(screen.Right - 10, screen.Top + 100), -1, 0) == 1, "right edge");
                    Check(track.NearestEdge(new Point(screen.Left + 100, screen.Top + 10), -1, 0) == 0, "top edge");
                    Check(track.NearestEdge(new Point(screen.Left + 100, screen.Bottom - 10), -1, 0) == 2, "bottom edge");
                    Check(track.NearestEdge(new Point(screen.Left + 95, screen.Top + 100), 0, 28) == 0, "hysteresis keeps edge at diagonal");
                    Check(track.NearestEdge(new Point(screen.Left + 40, screen.Top + 100), 0, 28) == 3, "hysteresis eventually switches");
                    Check(Math.Abs(track.Delta(track.Perimeter - 10, 10) - 20) < 0.001, "short travel across top-left seam");
                    Check(Math.Abs(track.Delta(10, track.Perimeter - 10) + 20) < 0.001, "reverse seam travel");
                    Check(track.Project(new Point(screen.Left + 100, screen.Top), 0) == 100, "top projection");
                    Check(track.Project(new Point(screen.Right, screen.Top + 100), 1) == screen.Width + 100, "right projection");
                    Check(track.Project(new Point(screen.Right - 100, screen.Bottom), 2) == screen.Width + screen.Height + 100, "bottom projection");
                    Check(track.Project(new Point(screen.Left, screen.Bottom - 100), 3) == 2 * screen.Width + screen.Height + 100, "left projection");
                    foreach (float scale in new float[] { 1, 1.25f, 1.5f, 2 })
                        foreach (double corner in new double[] { 0, screen.Width, screen.Width + screen.Height, 2 * screen.Width + screen.Height })
                            foreach (double offset in new double[] { -100, -1, 0, 1, 100 })
                                using (GraphicsPath shape = track.Shape(corner + offset * scale, 188 * scale, 82 * scale))
                                {
                                    Check(shape.PointCount > 0, "shape survives corner");
                                    foreach (PointF p in shape.PathPoints)
                                        Check(!Single.IsNaN(p.X) && !Single.IsNaN(p.Y) && !Single.IsInfinity(p.X) && !Single.IsInfinity(p.Y), "finite geometry");
                                    PointF inside = track.PointAt(corner + offset * scale, 20 * scale);
                                    inside.X = Math.Max(screen.Left + 1f, Math.Min(screen.Right - 1f, inside.X));
                                    inside.Y = Math.Max(screen.Top + 1f, Math.Min(screen.Bottom - 1f, inside.Y));
                                    Check(shape.IsVisible(inside), "body attached through corner: screen=" + screen + " scale=" + scale + " corner=" + corner + " offset=" + offset + " point=" + inside);
                                    Check(!shape.IsVisible(new Point(screen.Left + screen.Width / 2, screen.Top + screen.Height / 2)), "desktop center stays click-through");
                                }
                    // Sweeping across the wrap must not send the spring through the screen.
                    double position = track.Perimeter - 40, velocity = 0;
                    for (int i = 0; i < 240; i++)
                    {
                        NotchTrack.Spring(ref position, ref velocity, track.Delta(position, 40), i == 3 ? 2 : 1.0 / 60);
                        position = track.Wrap(position);
                        Check(Math.Abs(track.Delta(position, 0)) < 100, "spring stays near the corner despite dropped frame");
                    }
                    Check(Math.Abs(track.Delta(position, 40)) < 0.01, "spring settles");
                }
                RenderChecks(previewDirectory);
                Console.WriteLine("Notch: " + checks + " checks passed.");
                return true;
            }
            catch (Exception error) { Console.Error.WriteLine("Notch self-test: " + error); return false; }
        }
        private static void RenderChecks(string directory)
        {
            Account account = new Account { Id = "claude", Provider = "claude", Label = "Claude", Plan = "Pro", ResetCredits = 3 };
            account.Limits.Add(new LimitWindow { Label = "Current session", UsedPercent = 73, WindowMins = 300, ResetsAt = Clock.UnixNow + 3060 });
            account.Limits.Add(new LimitWindow { Label = "Weekly", UsedPercent = 7, WindowMins = 10080, ResetsAt = Clock.UnixNow + 86400 * 3 });
            using (Font title = new Font("DejaVu Sans", 14, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font text = new Font("DejaVu Sans", 12, FontStyle.Regular, GraphicsUnit.Pixel))
            using (Font small = new Font("DejaVu Sans", 10, FontStyle.Regular, GraphicsUnit.Pixel))
            using (Bitmap bitmap = new Bitmap(800, 600, PixelFormat.Format32bppPArgb))
            using (Graphics g = Graphics.FromImage(bitmap))
            {
                Check(NotchArtwork.UsageColor(30) != NotchArtwork.UsageColor(90), "colored headroom states");
                float normal = NotchArtwork.Content(g, account, "Updated just now", text, 294, false);
                account.Warning = new string('W', 200) + " long stale reading warning";
                float warning = NotchArtwork.Content(g, account, "Updated just now", text, 294, false);
                Check(warning > normal, "wrapped warnings increase scroll height");
                account.Warning = null;
                if (directory != null) Directory.CreateDirectory(directory);
                foreach (int edge in new int[] { 0, 1, 2, 3 })
                {
                    g.ResetTransform(); g.Clear(Color.FromArgb(63, 83, 102));
                    NotchTrack track = new NotchTrack(new Rectangle(0, 0, 800, 600));
                    Point cursor = edge == 0 ? new Point(400, 0) : edge == 1 ? new Point(800, 300) : edge == 2 ? new Point(400, 600) : new Point(0, 300);
                    double position = track.Project(cursor, edge);
                    using (GraphicsPath path = track.Shape(position, 188, 82)) g.FillPath(Brushes.Black, path);
                    for (int i = 0; i < 2; i++)
                    {
                        PointF center = track.PointAt(position + (i - 0.5) * 84, 41);
                        GraphicsState saved = g.Save(); g.TranslateTransform(center.X, center.Y);
                        NotchArtwork.Cell(g, account, false, 73, 1, false, text, small); g.Restore(saved);
                    }
                    g.TranslateTransform(edge == 3 ? 94 : edge == 1 ? 374 : 230, edge == 0 ? 94 : edge == 2 ? 250 : 150);
                    NotchArtwork.Card(g, account, "Updated just now", 330, 254, 0, 0, title, text, small);
                    if (directory != null) bitmap.Save(Path.Combine(directory, "notch-edge-" + edge + ".png"), ImageFormat.Png);
                }
                g.ResetTransform(); g.Clear(Color.Transparent);
                NotchTrack bend = new NotchTrack(new Rectangle(0, 0, 800, 600));
                using (GraphicsPath path = bend.Shape(800, 188, 82)) g.FillPath(Brushes.Black, path);
                Check(bitmap.GetPixel(798, 2).A > 0, "corner is filled");
                Check(bitmap.GetPixel(400, 300).A == 0, "outside notch stays transparent");
                if (directory != null)
                {
                    g.Clear(Color.FromArgb(63, 83, 102));
                    using (GraphicsPath path = bend.Shape(800, 188, 82)) g.FillPath(Brushes.Black, path);
                    bitmap.Save(Path.Combine(directory, "notch-corner.png"), ImageFormat.Png);
                }
            }
        }
    }
}
