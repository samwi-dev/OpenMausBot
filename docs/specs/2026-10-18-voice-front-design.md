# 語音前台＋bot 後台：Take turns 低延遲通話

日期：2026-10-18　分支：`mac`

## 目標
一對一 Take turns 通話，從使用者說完到聽見回覆，一般問答 ≤ 2.5 秒（現況 6–7 秒）。

## 實測基準（2026-10-18，Windows，TFD `qwen3.8-flash-next`，Edge HsiaoChen）
| 階段 | 現況 | 目標 |
|---|---|---|
| 停頓判定 | 0.5 s（設定可調） | 不變 |
| TFD STT | 0.3 s | 不變 |
| 模型首字 | 3.5–4 s（每輪約 2.7 萬 token 系統提示＋工具） | 前台 ≈ 0.7 s（短提示實測 0.6–0.8 s） |
| 第一句語音 | 1.3–2.7 s（每句重啟 edge-tts CLI，啟動 0.7 s） | ≈ 1.0 s（常駐程式實測 0.97–1.31 s） |

## A. 語音合成加速（不改行為）
1. `server/tts/edge-worker.py`（新）：常駐 Python 程式，用 edge-tts 套件的 `Communicate`。stdin 每行一個 JSON `{id,text,voice}`，stdout 每行一個 `{id,ok,audio(base64)|error}`。
2. `server/tts/edge.ts`：優先用 uv 工具環境的 python（`%APPDATA%/uv/tools/edge-tts/Scripts/python.exe`，macOS 是 `~/.local/share/uv/tools/edge-tts/bin/python`）啟動 worker 並重用。找不到或 worker 掛掉時，退回現有 CLI 路徑。worker 閒置 5 分鐘自動結束。
3. `src/components/CallView.tsx` 唸稿佇列：句子一進佇列就先發 `/api/tts/speak`，播放仍依序。播這句時下一句已經在合成。

## B. 語音前台
### 流程
1. 辨識出文字後，CallView 改呼叫 `POST /api/bots/:id/voice-front`（限桌面 app，跟 send 同一套驗證），body 為 `{threadId, text}`。
2. 伺服器組精簡提示，呼叫 bot 目前的 openai-compat 模型（串流）：
   - bot 名稱、title，人設前 400 字
   - 規則：一兩句話、先講重點、繁中口語；凡是需要對話裡沒有的事實（天氣、查資料、檔案、記憶、操作電腦）或使用者要求做事，一律 delegate，不准猜
   - 最近 8 則對話（沿用 `liveHistoryFrom`／`liveInitialInput` 的截斷規則）
   - 一個工具 `delegate({ack})`：`ack` 是要先唸的一句短話，例如「我查一下」
3. 回應以 SSE 串流給 renderer，事件有 `delta`（文字）、`delegate`（`{ack}`）、`done`、`error`。
4. **直接回答**：renderer 邊收邊唸，沿用現有分句與唸稿佇列。伺服器把「使用者這句」和「前台回覆」寫進對話串（沿用 Live call 的 `recordLiveCall`／`spokenLineFields`），聊天室照常顯示。這一輪不跑完整 agent。
5. **交給 bot**：先唸 `ack`，再走現有 `send({via:"call"})`。bot 回覆沿用已完成的串流朗讀。
6. **退回**：bot 不是 openai-compat、前台 2.5 秒沒出第一個字、或出錯，一律改走現有 `send({via:"call"})`，使用者只會感覺比較慢。

### 範圍外
群組通話、Live call、文字聊天都不動。

## 待驗證（計畫階段先查）
- 前台寫入對話串的訊息，完整 agent 下一輪看不看得到（resumeCursors 是否只帶 runtime 自己的 session）。看不到的話，delegate 時要把最近的前台問答附在 turn 文字前面。
- `delegate` 的 tool call 在 TFD `qwen3.8-flash-next` 串流下的格式。

## 驗收
- 單元測試：提示組裝、SSE 解析、delegate 判斷、退回路徑、worker 協定。
- 實測腳本：10 句一般問答量「說完→首個音訊」，中位數 ≤ 2.5 s；5 句需要查資料的話全部走 delegate，沒有一句是猜的。
- 使用者在 Voice Test 實際通話確認。
