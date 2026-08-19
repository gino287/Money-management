; 記帳系統 — Windows 桌面快捷鍵
;
; 按 Ctrl+Alt+J 跳出一個小輸入框，打一句話（例如「剛剛午餐 150」），
; 按確定就會用瀏覽器開記帳頁，而且那句話已經幫你填好，按「送出」就好。
;
; 為什麼是開瀏覽器而不是直接寫進資料庫：直接寫的話這支腳本要自己保管登入
; 密碼，還要自己實作一份驗證與寫入邏輯，等於系統多了一條沒人測的後門。
; 開網址只是把你原本就要做的事少做兩步，風險是零。
;
; ── 怎麼用 ─────────────────────────────────────────────
; 1. 裝 AutoHotkey v2：https://www.autohotkey.com/
; 2. 把下面的 APP_URL 換成你自己的網址
; 3. 對這個檔案按右鍵 → Run Script
; 4. 想開機就自動生效的話：按 Win+R 打 shell:startup，
;    把這個檔案的捷徑丟進去
;
; 注意：這是 AutoHotkey **v2** 的語法，v1 跑不動（v1 沒有 InputBox 的回傳物件）。
; 我沒辦法在寫這支腳本的機器上測（那台沒裝 AutoHotkey），
; 有哪裡不動跟我說，我照你的錯誤訊息修。

#Requires AutoHotkey v2.0
#SingleInstance Force

APP_URL := "https://你的網址.vercel.app"

^!j:: {
    result := InputBox("打一句話就好，例如：剛剛跟朋友吃午餐 150", "記一筆", "w420 h130")
    if (result.Result != "OK")
        return

    text := Trim(result.Value)
    if (text = "")
        return

    Run(APP_URL . "/?say=" . UriEncode(text))
}

; AutoHotkey 沒有內建的網址編碼，中文一定要編過，不然網址會壞掉
UriEncode(str) {
    static doc := ""
    if (doc = "") {
        doc := ComObject("HTMLFile")
        doc.write("<meta http-equiv='X-UA-Compatible' content='IE=edge'>")
    }
    return doc.parentWindow.encodeURIComponent(str)
}
