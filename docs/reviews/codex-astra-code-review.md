**9件です。Critical はありません。** ファイルは変更していません。主要な停止経路はメモリ上で再現しました。実際のClaude・TTS・JUNOによる通し実行はしていません。

1. **High — Claudeの応答待ちに期限がなく、代行処理へ移れない**

   **場所:** [brain/claude.py:125](/Users/charokoukuu/piano-coach/apps/server/piano_coach/brain/claude.py:125)、[lesson/orchestrator.py:103](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/orchestrator.py:103)

   **起きること:** 曲紹介・ヒアリング・講評の途中でClaudeが応答しなくなると、`receive_response()` を待ち続けます。例外が発生しない限りfallbackに到達せず、質問に回答した後や「結果を確認しています」のまま止まります。楽譜解析にも同じ問題があります。

   **修正案:** 応答の消費全体に期限を設け、タイムアウトしたセッションを閉じて既存fallbackへ進めます。運指・解析にも期限が必要です。

   ```python
   try:
       async with asyncio.timeout(20):
           async for event in self.brain.send(message):
               ...  # 既存のイベント処理
   except TimeoutError:
       await self.brain.close()
       self.brain = None
       failed = True  # 既存の fallback へ
   ```

2. **High — 手動の「お手本を再生」でレッスンが停止する**

   **場所:** [ui/Hud.tsx:123](/Users/charokoukuu/piano-coach/apps/web/src/ui/Hud.tsx:123)、[midi/Player.ts:198](/Users/charokoukuu/piano-coach/apps/web/src/midi/Player.ts:198)、[lesson/orchestrator.py:191](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/orchestrator.py:191)

   **起きること:** 自動のお手本が終わり、練習開始待ちになってから「お手本を再生」を押します。フロントだけが`demo`になり、終了時に`reviewing`・`waitingForStart: false`になります。一方、サーバーは`briefing`なので`demo.finished`を無視します。次の課題も開始ボタンも出ません。このフロントの状態遷移は再現済みです。

   **修正案:** 今夜は手動再生をサーバーが開始したお手本中だけに制限します。通常の練習中から再生できるようにするには、別途サーバーとの同期が必要です。

   ```ts
   export function playDemo(): void {
     const state = useAppStore.getState();
     const timeline = state.timeline;
     if (
       state.lessonState !== "demo" ||
       timeline?.spec.mode !== "watch"
     ) return;
     // 既存の再生処理
   }
   ```

3. **High — 切断しても音声タスクと運指用Claude処理が残る**

   **場所:** [lesson/orchestrator.py:59](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/orchestrator.py:59)、[lesson/orchestrator.py:100](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/orchestrator.py:100)、[api/app.py:130](/Users/charokoukuu/piano-coach/apps/server/piano_coach/api/app.py:130)

   **起きること:** Claude応答中にブラウザを再読み込みすると、親の`handle`はキャンセルされますが、`voice_worker`には終了通知もキャンセルも届きません。実際に`voice_worker`と`VoiceService._read`の2タスクが残りました。また、運指タスクはWS側の管理対象に入っておらず、キャッシュ未生成時の別Claudeセッションも切断後に継続します。

   **修正案:** 音声workerを`finally`で回収し、運指タスクもレッスンが所有して切断時にcancel・awaitします。

   ```python
   worker = asyncio.create_task(voice_worker())
   try:
       ...  # Claude 応答の処理
       queue.put_nowait(_END)
       await worker
   finally:
       worker.cancel()
       await asyncio.gather(worker, return_exceptions=True)
   ```

   運指タスクにも同じ回収を行う`lesson.aclose()`を設け、WSの`finally`から呼びます。`VoiceService.speak()`側も`reader.cancel()`後に`await asyncio.gather(reader, return_exceptions=True)`が必要です。

4. **Medium — `start_exercise`の`mode: "watch"`が検証を通り、開始不能になる**

   **場所:** [lesson/actions.py:64](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/actions.py:64)、[lesson/orchestrator.py:220](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/orchestrator.py:220)、[midi/Player.ts:43](/Users/charokoukuu/piano-coach/apps/web/src/midi/Player.ts:43)

   **起きること:** Claudeが`{"type":"start_exercise","exercise":{...,"mode":"watch"}}`を返すと、そのまま`briefing`になります。`demo.play`は送られず、鍵盤を押してもフロントがwatch課題の開始を拒否します。この出力の受理と停止状態を再現しました。`retry`でwatchを指定しても同様です。

   **修正案:** アクションとモードの組合せを検証し、不一致は既存fallbackへ渡します。

   ```python
   if action.type in {"start_exercise", "retry"}:
       if action.exercise.mode == "watch":
           raise ValueError("watch requires demo action")
   ```

5. **Medium — 課題生成の例外で停止し、`exerciseVersion`だけ進む**

   **場所:** [lesson/actions.py:70](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/actions.py:70)、[lesson/orchestrator.py:170](/Users/charokoukuu/piano-coach/apps/server/piano_coach/lesson/orchestrator.py:170)、[exercise/builder.py:74](/Users/charokoukuu/piano-coach/apps/server/piano_coach/exercise/builder.py:74)

   **起きること:** `set_plan`内の各課題には曲の小節数チェックがありません。例えば32小節のメヌエットに`[33, 36]`のステップを含めると、実行時に例外となり、エラー表示だけで止まります。また、音符のない課題でも生成に失敗し、版番号の更新だけが残ります。再現ではサーバーがversion 2、保持中のtimelineがversion 1になりました。以後、旧課題の通知は無視されます。

   **修正案:** 計画内の課題も適用前に検証し、生成成功後にだけ版番号を確定します。生成失敗時には既存の有効な課題へfallbackします。

   ```python
   # validate_action: plan 内も範囲検証
   if action.plan and measure_count:
       for step in action.plan.steps:
           if step.exercise.measures[1] > measure_count:
               raise ValueError("plan exercise exceeds score")

   # prepare_exercise: 成功後にまとめて更新
   version = self.exercise_version + 1
   timeline = self._builder.build(self.score, spec, version)
   self.exercise_version, self.timeline = version, timeline
   ```

6. **Medium — カウントインの古いコールバックが別課題を上書きする**

   **場所:** [midi/Player.ts:64](/Users/charokoukuu/piano-coach/apps/web/src/midi/Player.ts:64)、[midi/Player.ts:130](/Users/charokoukuu/piano-coach/apps/web/src/midi/Player.ts:130)

   **起きること:** カウントインのタイマーを保存しておらず、課題変更・お手本開始・MIDI切断でも取り消されません。カウントイン中に課題が差し替わると、旧課題のjudgeで開始し、提出時だけ現在のtimelineを参照します。再現では`practice.started`がversion 1、同じ演奏の`attempt.submit`がversion 2になりました。MIDI切断時も、まだ`running=false`なので停止処理が効かず、その後演奏が始まります。

   **修正案:** タイマーを回収し、開始時にIDと版を再確認します。提出も開始時に固定したtimelineを使います。

   ```ts
   let countInTimer = 0;
   let activeAttempt: ExerciseTimeline | null = null;

   countInTimer = window.setTimeout(() => {
     const current = currentTimeline();
     if (
       current?.exerciseId !== timeline.exerciseId ||
       current.exerciseVersion !== timeline.exerciseVersion
     ) return;
     activeAttempt = timeline;
     // 既存の演奏開始処理
   }, timeline.countInMs);
   ```

   課題変更・切断・お手本開始では`clearTimeout(countInTimer)`も実行します。

7. **Medium — WebSocketが一度切れると、送信が永久にキューへ溜まる**

   **場所:** [state/ws.ts:31](/Users/charokoukuu/piano-coach/apps/web/src/state/ws.ts:31)、[state/ws.ts:38](/Users/charokoukuu/piano-coach/apps/web/src/state/ws.ts:38)、[App.tsx:139](/Users/charokoukuu/piano-coach/apps/web/src/App.tsx:139)

   **起きること:** レッスン中にサーバーを再起動すると、`socket`が消えるだけで再接続されません。その後の回答・演奏結果は`pending`へ入り、画面は回答待ちや講評待ちのままです。初回接続失敗後にサーバーを起動した場合も同じです。

   **修正案:** サーバーにはresumeがないため、旧メッセージを再送するのではなく、切断時に演奏を取り消して再開始を案内します。今夜の最小修正なら明示的な再読み込み導線で十分です。

   ```ts
   socket.onclose = () => {
     socket = undefined;
     pending.length = 0;
     useAppStore.getState().set({
       running: false,
       waitingForStart: false,
       error: "接続が切れました。ページを再読み込みしてください。",
     });
     // RAF・カウントイン・音声もキャンセルする
   };
   ```

8. **Medium・要確認 — JUNO再接続後にポートを再選択できない**

   **場所:** [midi/MidiInput.ts:47](/Users/charokoukuu/piano-coach/apps/web/src/midi/MidiInput.ts:47)、[ui/Setup.tsx:101](/Users/charokoukuu/piano-coach/apps/web/src/ui/Setup.tsx:101)

   **起きること:** レッスン中にUSBが抜けると`input`と選択状態を消します。再接続時はポート一覧を更新するだけで、新しいポートにリスナーを付けません。ポート選択UIは準備画面にしかないため、新しい`MIDIInput`として戻るケースでは復旧できません。Chromeが同じポートオブジェクトを再利用するかは実機確認が必要です。また、`addEventListener`で登録したリスナーは`onmidimessage = null`では解除できません。

   **修正案:** 選択したポートを記憶し、切断時に正しく解除、再接続時に再登録します。

   ```ts
   let preferredName: string | undefined;

   // selectMidi 内
   preferredName = name;

   // 切断検出時
   input.removeEventListener("midimessage", onMessage);
   input = undefined;

   // refresh 内
   if (!input && preferredName &&
       ports.some(p => p.state === "connected" &&
         (p.name ?? p.id) === preferredName)) {
     selectMidi(preferredName);
   }
   ```

9. **Medium — WebSocketが任意のOriginを受け入れる**

   **場所:** [api/app.py:89](/Users/charokoukuu/piano-coach/apps/server/piano_coach/api/app.py:89)

   **起きること:** `/ws`はOrigin検査なしで接続を受け入れ、`lesson.start`でローカルのClaudeを起動できます。任意Originを付けた接続が受理されることをインメモリのTestClientで確認しました。ブラウザ側がlocalhostへの接続を許可する環境では、別サイトからClaude/TTS処理を繰り返し起動できます。外部サイトからの到達可否はChromeの設定・制限に依存するため**要確認**です。

   **修正案:** `accept()`前に、実際のフロントのOriginだけを許可します。

   ```python
   allowed_origins = {
       "http://127.0.0.1:5173",
       "http://localhost:5173",
   }
   if websocket.headers.get("origin") not in allowed_origins:
       await websocket.close(code=1008)
       return
   await websocket.accept()
   ```