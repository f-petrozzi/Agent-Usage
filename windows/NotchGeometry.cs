using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace AgentUsageFrame
{
    // Clockwise perimeter coordinates keep travel continuous through all four corners.
    // All coordinates here are physical pixels; no primary-monitor or work-area assumptions.
    internal sealed class NotchTrack
    {
        public readonly Rectangle Screen;
        public double Perimeter { get { return 2.0 * (Screen.Width + Screen.Height); } }
        public NotchTrack(Rectangle screen) { Screen = screen; }
        public double Wrap(double value) { return (value % Perimeter + Perimeter) % Perimeter; }
        public double Delta(double from, double to)
        {
            double delta = Wrap(to - from);
            return delta > Perimeter / 2 ? delta - Perimeter : delta;
        }
        public int NearestEdge(Point cursor, int previous, double hysteresis)
        {
            double[] distances = { Math.Abs(cursor.Y - Screen.Top), Math.Abs(Screen.Right - cursor.X),
                Math.Abs(Screen.Bottom - cursor.Y), Math.Abs(cursor.X - Screen.Left) };
            int edge = 0;
            for (int i = 1; i < 4; i++) if (distances[i] < distances[edge]) edge = i;
            if (previous >= 0 && previous < 4 && distances[previous] <= distances[edge] + hysteresis) return previous;
            return edge;
        }
        public double Project(Point cursor, int edge)
        {
            double x = Math.Max(0, Math.Min(Screen.Width, cursor.X - Screen.Left));
            double y = Math.Max(0, Math.Min(Screen.Height, cursor.Y - Screen.Top));
            switch (edge)
            {
                case 0: return x;
                case 1: return Screen.Width + y;
                case 2: return 2 * Screen.Width + Screen.Height - x;
                default: return Wrap(Perimeter - y);
            }
        }
        public int Edge(double position)
        {
            double p = Wrap(position);
            if (p < Screen.Width) return 0;
            if (p < Screen.Width + Screen.Height) return 1;
            if (p < 2 * Screen.Width + Screen.Height) return 2;
            return 3;
        }
        public PointF PointAt(double position, float inset)
        {
            double p = Wrap(position);
            switch (Edge(p))
            {
                case 0: return new PointF(Screen.Left + (float)p, Screen.Top + inset);
                case 1: return new PointF(Screen.Right - inset, Screen.Top + (float)p - Screen.Width);
                case 2: return new PointF(Screen.Right - ((float)p - Screen.Width - Screen.Height), Screen.Bottom - inset);
                default: return new PointF(Screen.Left + inset, Screen.Bottom - ((float)p - 2 * Screen.Width - Screen.Height));
            }
        }
        public double RestingPosition(double position, float length, float padding)
        {
            double[] starts = { 0, Screen.Width, Screen.Width + Screen.Height, 2 * Screen.Width + Screen.Height };
            int edge = Edge(position);
            double size = edge % 2 == 0 ? Screen.Width : Screen.Height;
            double margin = Math.Min(size / 2, length / 2 + padding);
            double along = Wrap(position) - starts[edge];
            return starts[edge] + Math.Max(margin, Math.Min(size - margin, along));
        }
        public double CornerDistance(double position)
        {
            double best = Double.MaxValue;
            foreach (double corner in new double[] { 0, Screen.Width, Screen.Width + Screen.Height, 2 * Screen.Width + Screen.Height })
                best = Math.Min(best, Math.Abs(Delta(position, corner)));
            return best;
        }
        public static void Spring(ref double position, ref double velocity, double gap, double elapsed)
        {
            // Bound elapsed after sleep/debugging, and substep so dropped frames stay stable.
            double dt = Math.Min(0.05, Math.Max(0, elapsed));
            int steps = Math.Max(1, (int)Math.Ceiling(dt / 0.008));
            double target = position + gap;
            for (int i = 0; i < steps; i++)
            {
                double h = dt / steps;
                velocity += (900 * (target - position) - 51 * velocity) * h;
                position += velocity * h;
            }
        }
        public GraphicsPath Shape(double center, float length, float depth)
        {
            GraphicsPath result = new GraphicsPath(FillMode.Winding);
            double start = Wrap(center - length / 2);
            double[] offsets = { 0, Screen.Width, Screen.Width + Screen.Height, 2 * Screen.Width + Screen.Height };
            for (int lap = -1; lap <= 1; lap++)
                for (int edge = 0; edge < 4; edge++)
                {
                    float size = edge % 2 == 0 ? Screen.Width : Screen.Height;
                    double origin = offsets[edge] + lap * Perimeter;
                    float a = (float)Math.Max(0, start - origin);
                    float b = (float)Math.Min(size, start + length - origin);
                    if (b <= a) continue;
                    using (GraphicsPath part = Segment(a, b, depth, size))
                    using (Matrix matrix = EdgeMatrix(edge))
                    {
                        part.Transform(matrix);
                        result.AddPath(part, false);
                    }
                }
            return result;
        }
        private Matrix EdgeMatrix(int edge)
        {
            switch (edge)
            {
                case 0: return new Matrix(1, 0, 0, 1, Screen.Left, Screen.Top);
                case 1: return new Matrix(0, 1, -1, 0, Screen.Right, Screen.Top);
                case 2: return new Matrix(-1, 0, 0, -1, Screen.Right, Screen.Bottom);
                default: return new Matrix(0, -1, 1, 0, Screen.Left, Screen.Bottom);
            }
        }
        private static GraphicsPath Segment(float a, float b, float depth, float edgeLength)
        {
            GraphicsPath path = new GraphicsPath();
            float r = Math.Min(depth * 0.36f, (b - a) / 3);
            bool first = a <= 0, last = b >= edgeLength;
            // Concave shoulders join the bezel; convex inner corners form the cutout.
            if (first) path.AddLine(a, 0, a, depth);
            else
            {
                path.AddBezier(a - r, 0, a - r * 0.35f, 0, a, r * 0.35f, a, r);
                path.AddLine(a, r, a, depth - r);
                path.AddBezier(a, depth - r, a, depth - r * 0.35f, a + r * 0.35f, depth, a + r, depth);
            }
            path.AddLine(first ? a : a + r, depth, last ? b : b - r, depth);
            if (last) path.AddLine(b, depth, b, 0);
            else
            {
                path.AddBezier(b - r, depth, b - r * 0.35f, depth, b, depth - r * 0.35f, b, depth - r);
                path.AddLine(b, depth - r, b, r);
                path.AddBezier(b, r, b, r * 0.35f, b + r * 0.35f, 0, b + r, 0);
            }
            path.CloseFigure();
            return path;
        }
    }
}
