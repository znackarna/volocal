; Czech text for the strings Tauri's own installer script defines.
; Without this file every one of them is empty when the installer runs in
; Czech: Tauri emits only English.nsh and defines each LangString for
; ${LANG_ENGLISH} alone, while installer.nsi loads Czech first. The visible
; result was an unlabelled checkbox on the last page — and, on an upgrade, a
; maintenance page with a blank title and blank radio buttons.
;
; UTF-8 with a BOM and CRLF endings, like every NSIS text file.
; Keep $R4, $0, $1 and $\n exactly as they are: NSIS substitutes them.

LangString addOrReinstall ${LANG_CZECH} "Přidat nebo přeinstalovat součásti"
LangString alreadyInstalled ${LANG_CZECH} "Už je nainstalováno"
LangString alreadyInstalledLong ${LANG_CZECH} "${PRODUCTNAME} ${VERSION} je už nainstalovaný. Vyberte, co chcete udělat, a pokračujte tlačítkem Další."
LangString appRunning ${LANG_CZECH} "${PRODUCTNAME} běží. Nejdřív ho zavřete a zkuste to znovu."
LangString appRunningOkKill ${LANG_CZECH} "${PRODUCTNAME} běží!$\nTlačítkem OK ho ukončíte."
LangString chooseMaintenanceOption ${LANG_CZECH} "Vyberte, co chcete provést."
LangString choowHowToInstall ${LANG_CZECH} "Vyberte, jak chcete ${PRODUCTNAME} nainstalovat."
LangString createDesktop ${LANG_CZECH} "Vytvořit zástupce na ploše"
LangString dontUninstall ${LANG_CZECH} "Neodinstalovávat"
LangString dontUninstallDowngrade ${LANG_CZECH} "Neodinstalovávat (přechod na starší verzi bez odinstalace je v tomto instalátoru zakázaný)"
LangString failedToKillApp ${LANG_CZECH} "${PRODUCTNAME} se nepodařilo ukončit. Nejdřív ho zavřete a zkuste to znovu."
LangString installingWebview2 ${LANG_CZECH} "Instaluji WebView2…"
LangString newerVersionInstalled ${LANG_CZECH} "Je nainstalovaná novější verze ${PRODUCTNAME}. Instalovat starší verzi se nedoporučuje. Pokud to opravdu chcete, je lepší současnou verzi nejdřív odinstalovat. Vyberte, co chcete udělat, a pokračujte tlačítkem Další."
LangString older ${LANG_CZECH} "starší"
LangString olderOrUnknownVersionInstalled ${LANG_CZECH} "V počítači je nainstalovaná $R4 verze ${PRODUCTNAME}. Doporučujeme ji před instalací odinstalovat. Vyberte, co chcete udělat, a pokračujte tlačítkem Další."
LangString silentDowngrades ${LANG_CZECH} "Přechod na starší verzi je v tomto instalátoru zakázaný, takže tichá instalace nemůže pokračovat. Použijte instalátor s grafickým rozhraním.$\n"
LangString unableToUninstall ${LANG_CZECH} "Odinstalace se nezdařila."
LangString uninstallApp ${LANG_CZECH} "Odinstalovat ${PRODUCTNAME}"
LangString uninstallBeforeInstalling ${LANG_CZECH} "Odinstalovat před instalací"
LangString unknown ${LANG_CZECH} "neznámá"
LangString webview2AbortError ${LANG_CZECH} "WebView2 se nepodařilo nainstalovat. Bez něj aplikace nepoběží. Zkuste instalátor spustit znovu."
LangString webview2DownloadError ${LANG_CZECH} "Chyba: stahování WebView2 se nezdařilo – $0"
LangString webview2DownloadSuccess ${LANG_CZECH} "Instalátor WebView2 je stažený."
LangString webview2Downloading ${LANG_CZECH} "Stahuji instalátor WebView2…"
LangString webview2InstallError ${LANG_CZECH} "Chyba: instalace WebView2 skončila s kódem $1"
LangString webview2InstallSuccess ${LANG_CZECH} "WebView2 je nainstalovaný."
LangString deleteAppData ${LANG_CZECH} "Smazat data aplikace (archiv s přepisy)"
