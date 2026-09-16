; Each installer run gets a new receipt, including a same-version reinstall.
; This file is installation metadata, not the clinical installation identity.
!macro customInstall
  Push $0
  Push $1
  Push $2
  System::Call 'ole32::CoCreateGuid(g .r0) i .r1'
  ${If} $1 != 0
    Abort "Unable to create the installation configuration receipt."
  ${EndIf}
  ClearErrors
  FileOpen $2 "$INSTDIR\resources\installation-receipt.txt" w
  ${If} ${Errors}
    Abort "Unable to save the installation configuration receipt."
  ${EndIf}
  FileWrite $2 "$0"
  FileClose $2
  ${If} ${Errors}
    Abort "Unable to save the installation configuration receipt."
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend
