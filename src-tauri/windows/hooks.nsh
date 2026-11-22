; Extra steps for the Windows installer (see bundle.windows.nsis.installerHooks).
!include LogicLib.nsh

; Waits up to 20 seconds until the program file in $R9 is no longer running.
; A running program file can't be opened for writing; once that works, the
; program has quit. Nothing is written to the file.
Function MiWaitForExit
  Push $0
  Push $1
  StrCpy $1 0
  mi_wait_loop:
    ClearErrors
    FileOpen $0 "$R9" a
    ${IfNot} ${Errors}
      FileClose $0
    ${ElseIf} $1 < 80
      ${IfThen} $1 = 0 ${|} DetailPrint "Waiting for the app to close..." ${|}
      Sleep 250
      IntOp $1 $1 + 1
      Goto mi_wait_loop
    ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Push $R8
  Push $R9

  ; 1. When the app updates itself, it starts this installer and then quits.
  ; The installer's own "is the app still running?" check can come before the
  ; app has finished quitting, and then the update aborts with "Failed to kill
  ; magic-image" (tauri-apps/tauri#16277). So first wait for it to quit.
  ${If} $UpdateMode = 1
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R9 "$INSTDIR\${MAINBINARYNAME}.exe"
    Call MiWaitForExit
  ${EndIf}

  ; 2. The app used to be called "image-magic" (up to version 0.7.4), which
  ; Windows treats as a different app. Remove that old install so it doesn't
  ; stay next to this one. Its settings live under the app identifier, which
  ; didn't change, and a quiet uninstall keeps them.
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\image-magic" "InstallLocation"
  ${If} $R8 != ""
    ; Stored with quotes around it.
    StrCpy $R9 $R8 1
    ${If} $R9 == '"'
      StrCpy $R8 $R8 "" 1
      StrCpy $R8 $R8 -1
    ${EndIf}
    ${If} ${FileExists} "$R8\uninstall.exe"
      DetailPrint "Removing the old image-magic app..."
      ${If} ${FileExists} "$R8\image-magic.exe"
        StrCpy $R9 "$R8\image-magic.exe"
        Call MiWaitForExit
      ${EndIf}
      ; _?= runs the uninstaller in place, so this waits until it's done.
      ExecWait '"$R8\uninstall.exe" /S _?=$R8'
      Delete "$R8\uninstall.exe"
      RMDir "$R8"
    ${EndIf}
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\image-magic"
    DeleteRegKey HKCU "Software\${MANUFACTURER}\image-magic"
    ; The old uninstaller removed the Start menu entry, and an update doesn't
    ; create one, so install like a first install from here on.
    StrCpy $UpdateMode 0
  ${EndIf}

  Pop $R9
  Pop $R8
!macroend
