# Fork 交接紀錄（samwi-dev/OpenMausBot，分支 `mac`）

> 給接手的 agent／另一台機器：先讀完本檔再動工。最後更新 2026-10-18（Windows 端，HEAD `56dafc4`）。

## 這個 fork 做了什麼
在原版 OpenMausBot 加上以 TFD（openai-compat 雲端端點）為底的語音通話，不在本機跑任何模型。

| 功能 | 主要 commit | 重點檔案 |
|---|---|---|
| TFD TTS provider＋`POST /api/stt/transcribe` | `da24a30` | `server/tts/tfd.ts`、`server/stt/tfd.ts`、`server/tfd-credential.ts` |
| Windows Take turns 通話（renderer 錄音→TFD STT） | `5e7c374` | `src/lib/web-dictation.ts`、`src/lib/endpointer.ts`、`src/lib/speech-bridge.ts` |
| macOS 通話也走 TFD 辨識 | `4a7f8a2` | `src/lib/speech-bridge.ts` |
| 通話鈕旁常駐語音設定鈕 | `d508906` | `src/components/CallView.tsx` |
| 語音通話改成浮動、可拖曳的小窗，聊天室保留原位 | `dfa157d` `34a8bb9` `5f0f2d8` | `src/components/CallDock.tsx` |
| 通話回覆精簡（`via:"call"` → `SPOKEN_TURN_PROMPT`） | `a138478` | `server/system-prompt.ts`、`server/routes/bot-messages.ts` |
| Edge（Microsoft）語音，透過 edge-tts CLI | `49d8629` | `server/tts/edge.ts` |
| 設定頁的「語速」「回話延遲」滑桿 | `fe12d78` | `src/lib/voice-tuning.ts`、`src/components/VoiceSettings.tsx` |
| 回覆邊串流邊逐句朗讀，打斷後不重唸 | `5320b5c` `9d3edf6` | `src/lib/sentence-chunker.ts`、`src/lib/reply-stream.ts` |
| edge-tts 常駐 worker；下一句在播放時預先合成 | `6038a9c` | `server/tts/edge-worker.py`、`src/lib/tts/index.ts` |
| 語音前台：簡單的話由精簡提示直接回答，需要做事的轉交完整 bot | `0220237` | `server/voice-front.ts`、`src/lib/voice-front.ts` |
| 前台 0.9 秒沒出字就重送一次、第一個逗號就合成、開通話先預熱語音 | `56dafc4` | `server/voice-front.ts`、`src/lib/sentence-chunker.ts`、`src/lib/tts/index.ts` |

設計文件：
- `docs/specs/2026-10-17-tfd-voice-call-design.md`
- `docs/specs/2026-10-18-voice-front-design.md`

## 在 Mac 上接手的步驟
1. `git checkout mac && git pull`
2. `pnpm install --frozen-lockfile`
3. 安裝 edge-tts：`uv tool install edge-tts==7.3.1`。
   - CLI 裝在 `~/.local/bin/edge-tts`。
   - 常駐 worker 用的 python 在 `~/.local/share/uv/tools/edge-tts/bin/python`，`server/tts/edge.ts` 的 `edgePython()` 會自動找。找不到時退回 CLI。
4. 設定（`~/.openmausbot/config.json`，**不進 repo**）：
   - `instances.tfd`：driver `openai-compat`，key 走 `environment[apiKeyEnv]`。
   - `tts.provider = "edge"`，`tts.voice = "zh-TW-HsiaoChenNeural"`。
5. 開發模式要開三個程序：
   - `pnpm dev:server`（harness，127.0.0.1:8799）
   - `pnpm dev`（Vite，5199）
   - `npx electron .`
   - 不要用 `pnpm dev:desktop -- --flag`，`--` 會被原樣傳進去。

## 在 Mac 上要驗證的事
- [ ] 一對一 Take turns 通話：
  - 閒聊（你好、謝謝、再說一次）應由前台直接回答，從說完到出聲約 2–2.5 秒。
  - 需要查的事（天氣、記憶、操作電腦）應先唸「我查一下」，再由完整 bot 回答，不能亂答。
- [ ] 聊天室要出現前台的問答，下一輪 bot 要接得上前文。
- [ ] 打斷：bot 說話時插話，剩下的句子要停掉，不能重唸。
- [ ] 設定 → Voice 的語速、回話延遲滑桿有作用。
- [ ] 通話設定按鈕（齒輪）在 Mac 上看得到、點得開。
- [ ] 打包版（`pnpm package:mac`）裡 `dist-server/tts/edge-worker.py` 有在。

## Windows 實測的延遲（2026-10-18）
| 階段 | 原本 | 現在 |
|---|---|---|
| 停頓判定 | 0.5 s | 0.5 s（可調 0.3–1.5 s） |
| TFD STT | 0.3 s | 0.3 s |
| 模型首字 | 3.5–4 s（約 2.7 萬 token 提示） | 前台中位數 0.7–1.4 s；TFD 抖動時 0.4–4.9 s |
| 第一句語音 | 1.3–2.7 s | 1.0–1.3 s |

## 已知問題／未完成
- 每 10 句閒聊約有 1 句被前台誤判成要轉交，結果只是變慢。
- 前台唸到一半出錯時，轉交給 bot 可能重複唸一小段。
- 群組通話（`GroupCallView.tsx`）沒有串流朗讀，也沒有語音前台。
- `server/tts/tfd.ts` 的繁轉簡（opencc-js，`b2ac595`）在改用 Edge 後已經用不到，還沒決定要不要移除。
- Live call 只接 OpenAI（`gpt-live-1`），這台沒設 key。TFD 沒有即時語音模型，`/v1/realtime*` 全部 404；已決定請 TFD 上架，等回覆。
- 跟上游的關係還沒決定：開 PR 回原作者，或是只合併到 fork 的 main。
- 全套測試有已知的無關失敗：`ApprovalCard`、`WidgetFields`、`memory.test.ts` 的 relativeTime（日期寫死）。

## 規則
- 這個 repo 是 **public**：
  - key、`config.json`、`.env`、個人路徑都不准進 commit。
  - TFD key 也不准印出來或放進瀏覽器。
- 永遠不要 commit `electron/vendor/electron-updater.cjs`。
- 新開的連接埠只綁 `127.0.0.1`。
- 不在本機跑模型，語音辨識、語音合成、LLM 全部走雲端端點。
- 建立或修改 bot 必須從桌面 app 內送出，伺服器會擋外部的 POST。
- 程式碼風格依 `AGENTS.md`：註解只寫外部事實和不變式。
