using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Collections.Generic;

public class Wrapper
{
    public static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string real = Path.Combine(dir, "7za-orig.exe");

        List<string> outArgs = new List<string>();
        bool isExtract = args.Length > 0 && (args[0] == "x" || args[0] == "e");

        for (int i = 0; i < args.Length; i++)
        {
            outArgs.Add(args[i]);
            if (isExtract && i == 0)
            {
                outArgs.Add("-xr!darwin*");
            }
        }

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < outArgs.Count; i++)
        {
            if (i > 0) sb.Append(' ');
            string a = outArgs[i];
            if (a.IndexOf(' ') >= 0 || a.IndexOf('\t') >= 0)
            {
                sb.Append('"');
                sb.Append(a.Replace("\"", "\\\""));
                sb.Append('"');
            }
            else
            {
                sb.Append(a);
            }
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = real;
        psi.Arguments = sb.ToString();
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;

        Process p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
        {
            if (e.Data != null) Console.Out.WriteLine(e.Data);
        };
        p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
        {
            if (e.Data != null) Console.Error.WriteLine(e.Data);
        };
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();
        return p.ExitCode;
    }
}
