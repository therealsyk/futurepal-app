; FuturePal: verificação própria de "a app está aberta?" no instalador/desinstalador.
; A verificação do electron-builder dava falsos avisos ("FuturePal cannot be closed") no Windows.
; Aqui: fecha o FuturePal deste utilizador se estiver aberto e espera que os ficheiros fiquem livres.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 2000
!macroend

; Ao atualizar, o instalador corria primeiro o desinstalador da versão instalada. Os desinstaladores até à 0.2.9
; tinham a verificação antiga e falhavam ("Failed to uninstall old application files: 2").
; Apagar o desinstalador antigo faz o instalador saltar esse passo e escrever os ficheiros novos por cima
; (os dados da pessoa ficam noutra pasta e não são tocados). No fim é criado um desinstalador novo.
!macro customInit
  ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R8 "" 0 +2
    StrCpy $R8 "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  Delete "$R8\Uninstall ${PRODUCT_FILENAME}.exe"
!macroend
