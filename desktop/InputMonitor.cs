using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Reports only the chosen shortcut, Escape and the left mouse button, never typed text.
internal static class InputMonitor
{
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
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
                string previous = "";
                int tick = 0;
                while (true)
                {
                    if (++tick % 50 == 0 && owner.HasExited) return;
                    bool held = Down(key) && ((modifiers & 2) == 0 || Down(0x11))
                        && ((modifiers & 4) == 0 || Down(0x10)) && ((modifiers & 1) == 0 || Down(0x12));
                    string value = (held ? "1" : "0") + (Down(0x1b) ? "1" : "0") + (Down(1) ? "1" : "0");
                    if (value != previous) { Console.WriteLine(value); Console.Out.Flush(); previous = value; }
                    Thread.Sleep(20);
                }
            }
        }
        catch { /* Pipe or owning application closed. */ }
    }
}
