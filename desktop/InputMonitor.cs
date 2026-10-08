using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Reports shortcut/button state and coalesced pointer coordinates while interacting, never typed text.
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
    private static readonly KeyboardProc pointerCallback = PointerMoved;
    private static readonly AutoResetEvent pointerWake = new AutoResetEvent(false);
    private static int pointerSequence, pointerX, pointerY, pointerActive;
    private static long pointerTime;
    private static IntPtr PointerMoved(int code, IntPtr message, IntPtr data)
    {
        // Lock-free snapshot; never write to the pipe or wait in a low-level hook.
        if (code >= 0 && message.ToInt32() == 0x200) {
            Interlocked.Increment(ref pointerSequence);
            pointerX = Marshal.ReadInt32(data, 0); pointerY = Marshal.ReadInt32(data, 4);
            Interlocked.Exchange(ref pointerTime, Stopwatch.GetTimestamp());
            Interlocked.Increment(ref pointerSequence); if (Volatile.Read(ref pointerActive) != 0) pointerWake.Set();
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
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
        IntPtr mouseHook = SetWindowsHookEx(14, pointerCallback, GetModuleHandle(null), 0);
        Console.Error.WriteLine("sessions-ready hotkey=" + (registered ? "1" : "0") + " hook=" + (hook != IntPtr.Zero ? "1" : "0") + " thread=" + GetCurrentThreadId());
        Console.Error.WriteLine("pointer-ready hook=" + (mouseHook != IntPtr.Zero ? "1" : "0"));
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
        finally { if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook); if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); if (registered) UnregisterHotKey(IntPtr.Zero, 1); }
    }
    private static long Milliseconds(long time) { return (time / Stopwatch.Frequency) * 1000 + (time % Stopwatch.Frequency) * 1000 / Stopwatch.Frequency; }
    private static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    private static bool ControlDown() { return Down(0x11) || Down(0xA2) || Down(0xA3); }
    private static int ReadClipboard()
    {
        for(int attempt=0;attempt<4;attempt++)try {
            // Explorer's FileDrop and Snipping Tool's DIB/bitmap formats are native Windows
            // clipboard data; neither needs to be an Electron-authored PNG.
            if(System.Windows.Forms.Clipboard.ContainsFileDropList()){
                var files=System.Windows.Forms.Clipboard.GetFileDropList();
                if(files.Count==0||files.Count>5)return 2;
                foreach(string file in files)Console.WriteLine("file "+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(file)));
                return 0;
            }
            if(System.Windows.Forms.Clipboard.ContainsImage())using(var image=System.Windows.Forms.Clipboard.GetImage()){
                if(image==null||(long)image.Width*image.Height>32000000)return 2;
                using(var stream=new System.IO.MemoryStream()){
                    image.Save(stream,System.Drawing.Imaging.ImageFormat.Png);
                    if(stream.Length>8*1024*1024)return 2;
                    Console.WriteLine("image "+Convert.ToBase64String(stream.ToArray()));return 0;
                }
            }
            return 1;
        }catch(System.Runtime.InteropServices.ExternalException){Thread.Sleep(40);}
        return 1;
    }
    [STAThread]
    private static void Main(string[] args)
    {
        if(args.Length==1&&args[0]=="--clipboard"){Environment.ExitCode=ReadClipboard();return;}
        if (args.Length != 3) return;
        int parent, key, modifiers;
        if (!Int32.TryParse(args[0], out parent) || !Int32.TryParse(args[1], out key) || !Int32.TryParse(args[2], out modifiers)) return;
        try
        {
            using (Process owner = Process.GetProcessById(parent))
            {
                new Thread(WatchSessionKey) { IsBackground = true }.Start();
                string previous = "";
                long checkedOwner = 0, lastPointer = 0;
                int sentSequence = 0;
                bool suppressScroll = false;
                long sessionUntil = 0;
                while (true)
                {
                    long checkedAt = Stopwatch.GetTimestamp();
                    if (checkedAt - checkedOwner > Stopwatch.Frequency / 2) { checkedOwner = checkedAt; if (owner.HasExited) return; }
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
                    bool mouse = Down(1);
                    Volatile.Write(ref pointerActive, held || mouse ? 1 : 0);
                    string value = (held ? "1" : "0") + (sessions ? "1" : "0") + (mouse ? "1" : "0");
                    if (value != previous) { Console.WriteLine(value); Console.Out.Flush(); previous = value; }
                    if ((held || mouse) && now - lastPointer >= Stopwatch.Frequency / 250) {
                        int sequence = Volatile.Read(ref pointerSequence);
                        if ((sequence & 1) == 0 && sequence != sentSequence) {
                            int x = pointerX, y = pointerY; long time = Interlocked.Read(ref pointerTime);
                            if (sequence == Volatile.Read(ref pointerSequence)) {
                                Console.WriteLine("pointer " + x + " " + y + " " + Milliseconds(time));
                                Console.Out.Flush(); sentSequence = sequence; lastPointer = now;
                            }
                        }
                    }
                    // Wake on input, with a 4 ms delivery ceiling. Key polling remains a fallback.
                    int wait = (held || mouse) ? 4 : 8;
                    pointerWake.WaitOne(wait);
                    if (held || mouse) {
                        long remaining = Stopwatch.Frequency / 250 - (Stopwatch.GetTimestamp() - lastPointer);
                        if (remaining > 0) Thread.Sleep((int)Math.Ceiling(remaining * 1000.0 / Stopwatch.Frequency));
                    }
                }
            }
        }
        catch { /* Pipe or owning application closed. */ }
    }
}
