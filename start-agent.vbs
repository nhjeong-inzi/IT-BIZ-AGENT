Dim objShell, objFSO, projectDir
Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")

projectDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

' 포트 3001 리스닝 여부 확인
Dim result
result = objShell.Run("cmd /c netstat -ano | findstr "":3001 "" | findstr ""LISTENING"" > ""%TEMP%\g_port.txt""", 0, True)

Dim f, isRunning
isRunning = False
If objFSO.FileExists(Environ("TEMP") & "\g_port.txt") Then
    Set f = objFSO.OpenTextFile(Environ("TEMP") & "\g_port.txt", 1)
    If Not f.AtEndOfStream Then
        isRunning = Len(Trim(f.ReadAll)) > 0
    End If
    f.Close
End If

' 서버가 꺼져 있으면 실행
If Not isRunning Then
    objShell.CurrentDirectory = projectDir
    objShell.Run "cmd /c node --env-file=.env server/index.js", 0, False
    WScript.Sleep 3000
End If

' 브라우저 열기
objShell.Run "http://localhost:3001/", 1, False
