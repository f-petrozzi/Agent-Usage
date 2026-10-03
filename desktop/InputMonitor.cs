using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Reports only the chosen shortcut, Ctrl + Scroll Lock and the left mouse button, never typed text.
internal static class InputMonitor
{
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    private delegate IntPtr KeyboardProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr SetWindowsHookEx(int id, KeyboardProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string name);
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr window; public uint id; public UIntPtr word; public IntPtr data; public uint time; public int x, y; public uint reserved; }
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint first, uint last);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    private static readonly KeyboardProc sessionCallback = SessionKey;
    private static int sessionPresses;
    private static bool scrollPressed;
    private static IntPtr SessionKey(int code, IntPtr message, IntPtr data)
    {
        // Catch short hardware/macro taps between polls. Ignore every key except Scroll Lock,
        // never consume it, and leave pipe output on the polling thread so this callback stays tiny.
        if (code >= 0 && Marshal.ReadInt32(data) == 0x91)
        {
            int kind = message.ToInt32();
            if (kind == 0x100 || kind == 0x104)
            {
                if (!scrollPressed && Down(0x11)) Interlocked.Increment(ref sessionPresses);
                scrollPressed = true;
            }
            else if (kind == 0x101 || kind == 0x105) scrollPressed = false;
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    private static void WatchSessionKey()
    {
        IntPtr hook = SetWindowsHookEx(13, sessionCallback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) return; // Polling remains available if a hook cannot be installed.
        try { Message message; while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); } }
        finally { UnhookWindowsHookEx(hook); }
    }
    private static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    private static void Main(string[] args)
    {
        if (args.Length != 3) return;
        int parent, key, modifiers;
        if (!Int32.TryParse(args[0], out parent) || !Int32.TryParse(args[1], out key) || !Int32.TryParse(args[2], out modifiers)) return;
        try
        {
            using (Process owner = Process.GetProcessById(parent))
            {
                new Thread(WatchSessionKey) { IsBackground = true }.Start();
                string previous = "";
                int tick = 0;
                bool suppressScroll = false;
                while (true)
                {
                    if (++tick % 50 == 0 && owner.HasExited) return;
                    bool tapped = Interlocked.Exchange(ref sessionPresses, 0) > 0;
                    bool control = Down(0x11), scroll = Down(0x91), sessions = (control && scroll) || tapped;
                    if (sessions) suppressScroll = true;
                    if (!scroll) suppressScroll = false;
                    bool held = Down(key) && ((modifiers & 2) == 0 || control)
                        && ((modifiers & 4) == 0 || Down(0x10)) && ((modifiers & 1) == 0 || Down(0x12));
                    // Ctrl + Scroll Lock belongs to the session switcher, not the held reveal shortcut.
                    if (key == 0x91 && modifiers == 0 && (control || suppressScroll)) held = false;
                    string value = (held ? "1" : "0") + (sessions ? "1" : "0") + (Down(1) ? "1" : "0");
                    if (value != previous) { Console.WriteLine(value); Console.Out.Flush(); previous = value; }
                    Thread.Sleep(8);
                }
            }
        }
        catch { /* Pipe or owning application closed. */ }
    }
}
