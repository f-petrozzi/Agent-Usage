!macro customInit
  ; Migrate the ZIP install in place. Keep all settings in Roaming AppData.
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\AgentUsage"
  ${EndIf}
!macroend

!macro customCheckAppRunning
  ; Only this application's processes, including its retired prototypes.
  ${nsProcess::KillProcess} "AgentUsage.exe" $0
  ${nsProcess::KillProcess} "AgentUsageFrame.exe" $0
  ${nsProcess::KillProcess} "CodexUsageFrame.exe" $0
  ; The key helper notices a stopped parent within one second.
  Sleep 1200
!macroend

!macro customInstall
  Delete "$SMSTARTUP\Agent Usage.lnk"
  Delete "$SMSTARTUP\Codex Usage.lnk"
  Delete "$SMPROGRAMS\Codex Usage.lnk"
  Delete "$SMPROGRAMS\Update Agent Usage.lnk"
  Delete "$INSTDIR\uninstall.ps1"
  Delete "$INSTDIR\update.ps1"
  FileOpen $0 "$INSTDIR\resources\installer-managed" w
  FileWrite $0 "3"
  FileClose $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Agent Usage"
  ${endIf}
!macroend
