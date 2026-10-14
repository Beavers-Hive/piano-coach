P = lambda sd: [str(OUT / "parts" / f"refgen_s{sd}_{i}.wav") for i in range(3)]
CAP5 = "明るく優しい20代女性のピアノの先生。生徒に話しかけるように、自然な抑揚とテンポで、はきはきと話す。"
CAP6 = "自然な話し言葉で、感情豊かに、親しみやすく話す20代の女性。ふつうの会話のテンポ。"
CAPR = "落ち着いた、近い距離感の女性話者"
S = {}
# 1) 評価文での seed 比較（no_ref, 8 steps）。pitch の安定度を見る
for sd in (1, 7, 42, 100, 2024, 31337):
    S[f"seed{sd}_s8"] = C(steps=8, seed=sd)
# 2) seed100 + steps8 を土台に、キャプション・絵文字・速度
S["s100_s4"] = C(seed=100)
S["s100_cap1"] = C(steps=8, seed=100, caption=CAP1)
S["s100_cap2"] = C(steps=8, seed=100, caption=CAP2)
S["s100_cap5"] = C(steps=8, seed=100, caption=CAP5)
S["s100_cap6"] = C(steps=8, seed=100, caption=CAP6)
S["s100_capR"] = C(steps=8, seed=100, caption=CAPR)
S["s100_dscale090"] = C(steps=8, seed=100, dscale=0.9)
S["s100_dscale085"] = C(steps=8, seed=100, dscale=0.85)
S["s100_emoji_gentle"] = C(steps=8, seed=100, emoji="🫶")
# 3) 参照音声（自分の出力）固定
for r, sd in (("A", 100), ("B", 2024), ("C", 31337)):
    S[f"ref{r}_s4"] = C(seed=1234, ref=P(sd))
    S[f"ref{r}_s8"] = C(steps=8, seed=1234, ref=P(sd))
S["refA_s8_cap5"] = C(steps=8, seed=1234, ref=P(100), caption=CAP5)
S["refA_s8_nocap"] = C(steps=8, seed=1234, ref=P(100), caption=None)
S["refA_s8_d090"] = C(steps=8, seed=1234, ref=P(100), dscale=0.9)
S["refB_s8_d090"] = C(steps=8, seed=1234, ref=P(2024), dscale=0.9)
S["refA_s8_kana"] = C(steps=8, seed=1234, ref=P(100), nums="kana")
STAGE = S
