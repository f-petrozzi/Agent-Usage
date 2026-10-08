param([string]$Mode,[string]$File,[int]$X=0,[int]$Y=0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
if ($Mode -eq 'image') {
  $image = [System.Drawing.Image]::FromFile($File)
  try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }
  exit
}
if ($Mode -eq 'file') {
  $files = New-Object System.Collections.Specialized.StringCollection
  [void]$files.Add($File)
  [System.Windows.Forms.Clipboard]::SetFileDropList($files)
  exit
}
if ($Mode -eq 'paste') {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HoverPaste {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  public static void Paste(){keybd_event(0x11,0,0,UIntPtr.Zero);keybd_event(0x56,0,0,UIntPtr.Zero);keybd_event(0x56,0,2,UIntPtr.Zero);keybd_event(0x11,0,2,UIntPtr.Zero);}
}
'@
  [void][HoverPaste]::SetCursorPos($X,$Y)
  Start-Sleep -Milliseconds 300
  [HoverPaste]::Paste()
  exit
}
if ($Mode -eq 'drag') {
  Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Drawing;
public static class RealFileDrag {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  public static void Run(string file,int x,int y){
    using(var form=new Form())using(var timer=new Timer()){
      form.Text="Attachment drag fixture";form.StartPosition=FormStartPosition.Manual;
      form.Location=new Point(160,260);form.Size=new Size(160,100);
      int step=0;timer.Interval=100;
      timer.Tick+=(sender,args)=>{
        step++;
        if(step==1)SetCursorPos(x-8,y);
        else if(step<14)SetCursorPos(x+(step%2),y);
        else{timer.Stop();mouse_event(4,0,0,0,UIntPtr.Zero);}
      };
      form.Shown+=(sender,args)=>{
        SetCursorPos(200,300);mouse_event(2,0,0,0,UIntPtr.Zero);timer.Start();
        var data=new DataObject(DataFormats.FileDrop,new string[]{file});
        var result=form.DoDragDrop(data,DragDropEffects.Copy);
        Console.WriteLine("drop="+result);form.Close();
      };
      Application.Run(form);
    }
  }
}
'@
  [RealFileDrag]::Run($File,$X,$Y)
  exit
}
throw 'Unknown attachment fixture operation'
