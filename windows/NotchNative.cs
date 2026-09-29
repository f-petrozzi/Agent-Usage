using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AgentUsageFrame
{
    internal static class NotchNative
    {
        [StructLayout(LayoutKind.Sequential)] internal struct XY { public int X, Y; public XY(int x, int y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential, Pack = 1)] internal struct Blend { public byte Operation, Flags, Alpha, Format; }
        [StructLayout(LayoutKind.Sequential)] internal struct MouseData { public XY Point; public uint Data, Flags, Time; public UIntPtr Extra; }
        internal delegate IntPtr MouseHook(int code, IntPtr message, IntPtr data);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
        [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr window, int id);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowsHookEx(int kind, MouseHook callback, IntPtr module, uint thread);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
        [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
        [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool UpdateLayeredWindow(IntPtr window, IntPtr screen,
            ref XY destination, ref XY size, IntPtr source, ref XY sourcePoint, uint key, ref Blend blend, uint flags);
        [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(XY point, uint flags);
        internal static bool Down(Keys key) { return (GetAsyncKeyState((int)key) & 0x8000) != 0; }
        internal static float Scale(Point point)
        {
            try
            {
                uint x, y;
                if (GetDpiForMonitor(MonitorFromPoint(new XY(point.X, point.Y), 2), 0, out x, out y) == 0)
                    return Math.Max(1f, x / 96f);
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            return 1f;
        }
        internal static void Present(IntPtr window, Bitmap bitmap, Point location, byte opacity)
        {
            IntPtr screen = GetDC(IntPtr.Zero), memory = IntPtr.Zero, handle = IntPtr.Zero, previous = IntPtr.Zero;
            try
            {
                memory = CreateCompatibleDC(screen);
                handle = bitmap.GetHbitmap(Color.FromArgb(0));
                previous = SelectObject(memory, handle);
                XY destination = new XY(location.X, location.Y), size = new XY(bitmap.Width, bitmap.Height), source = new XY();
                Blend blend = new Blend { Alpha = opacity, Format = 1 };
                if (!UpdateLayeredWindow(window, screen, ref destination, ref size, memory, ref source, 0, ref blend, 2))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            finally
            {
                if (previous != IntPtr.Zero) SelectObject(memory, previous);
                if (handle != IntPtr.Zero) DeleteObject(handle);
                if (memory != IntPtr.Zero) DeleteDC(memory);
                if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
            }
        }
    }

    internal sealed class NotchWindow : Form
    {
        public event Action Shortcut;
        public NotchWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            Text = "Agent Usage notch";
        }
        protected override CreateParams CreateParams
        {
            get { CreateParams p = base.CreateParams; p.ExStyle |= 0x00080000 | Native.WsExNoActivate | Native.WsExToolWindow; return p; }
        }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == Native.WmMouseActivate) { message.Result = new IntPtr(Native.MaNoActivate); return; }
            if (message.Msg == 0x0312) { if (Shortcut != null) Shortcut(); return; }
            // Our geometry owns physical pixels, including across mixed-DPI screens.
            if (message.Msg == 0x02E0) { message.Result = IntPtr.Zero; return; }
            base.WndProc(ref message);
        }
        public void Present(Bitmap bitmap, Point location, byte opacity)
        {
            NotchNative.Present(Handle, bitmap, location, opacity);
            if (!Visible) Show();
            Native.SetWindowPos(Handle, Native.HwndTopMost, 0, 0, 0, 0,
                Native.SwpNoMove | Native.SwpNoSize | Native.SwpNoActivate);
        }
    }
}
