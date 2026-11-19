; FuturePal: verificação própria de "a app está aberta?" no instalador/desinstalador.
; A verificação do electron-builder dava falsos avisos ("FuturePal cannot be closed") no Windows.
; Aqui: fecha o FuturePal deste utilizador se estiver aberto e espera que os ficheiros fiquem livres.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 2000
!macroend
