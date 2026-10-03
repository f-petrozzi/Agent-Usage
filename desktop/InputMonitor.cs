using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Reports only the chosen shortcut, Ctrl + Scroll Lock and the left mouse button, never typed text.
internal static class InputMonitor
{
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
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
    private static int controlMask;
    private static bool scrollPressed;
    private static IntPtr SessionKey(int code, IntPtr message, IntPtr data)
    {
        // Catch short hardware/macro taps between polls. Only modifier state and Scroll Lock matter;
        // never consume it, and leave pipe output on the polling thread so this callback stays tiny.
        if (code >= 0)
        {
            int key = Marshal.ReadInt32(data), kind = message.ToInt32();
            bool down = kind == 0x100 || kind == 0x104, up = kind == 0x101 || kind == 0x105;
            if (key == 0xA2 || key == 0xA3 || key == 0x11)
            {
                int bit = key == 0xA3 ? 2 : 1;
                if (down) controlMask |= bit;
                else if (up) controlMask &= ~bit;
            }
            else if (key == 0x91 && down)
            {
                if (!scrollPressed && (controlMask != 0 || ControlDown())) Interlocked.Increment(ref sessionPresses);
                scrollPressed = true;
            }
            else if (key == 0x91 && up) scrollPressed = false;
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    private static void WatchSessionKey()
    {
        // Own the Windows hotkey in this message loop. Electron must not register the same chord.
        bool registered = RegisterHotKey(IntPtr.Zero, 1, 0x4002, 0x91); // Ctrl + no repeat
        IntPtr hook = SetWindowsHookEx(13, sessionCallback, GetModuleHandle(null), 0);
        Console.Error.WriteLine("sessions-ready hotkey=" + (registered ? "1" : "0") + " hook=" + (hook != IntPtr.Zero ? "1" : "0") + " thread=" + GetCurrentThreadId());
        Console.Error.Flush();
        try {
            Message message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
                if (message.id == 0x312 && message.word.ToUInt64() == 1) {
                    Interlocked.Increment(ref sessionPresses);
                    Console.Error.WriteLine("sessions-event hotkey"); Console.Error.Flush();
                }
                TranslateMessage(ref message); DispatchMessage(ref message);
            }
        }
        finally { if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); if (registered) UnregisterHotKey(IntPtr.Zero, 1); }
    }
    private static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    private static bool ControlDown() { return Down(0x11) || Down(0xA2) || Down(0xA3); }
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
                long sessionUntil = 0;
                while (true)
                {
                    if (++tick % 50 == 0 && owner.HasExited) return;
                    bool tapped = Interlocked.Exchange(ref sessionPresses, 0) > 0;
                    if (tapped) { Console.Error.WriteLine("sessions-event detected"); Console.Error.Flush(); }
                    long now = Stopwatch.GetTimestamp();
                    if (tapped) sessionUntil = now + Stopwatch.Frequency * 9 / 100;
                    bool control = ControlDown(), scroll = Down(0x91), sessions = (control && scroll) || now < sessionUntil;
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
