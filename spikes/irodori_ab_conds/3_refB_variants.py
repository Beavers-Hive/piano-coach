P = lambda sd: [str(OUT / "parts" / f"refgen_s{sd}_{i}.wav") for i in range(3)]
CAP5 = "明るく優しい20代女性のピアノの先生。生徒に話しかけるように、自然な抑揚とテンポで、はきはきと話す。"
S = {}
S["refB_s8_d090"] = C(steps=8, seed=1234, ref=P(2024), dscale=0.9)
S["refB_s8_d080"] = C(steps=8, seed=1234, ref=P(2024), dscale=0.8)
S["refB_s8_cap5"] = C(steps=8, seed=1234, ref=P(2024), caption=CAP5)
S["refB_s8_cap5_d090"] = C(steps=8, seed=1234, ref=P(2024), caption=CAP5, dscale=0.9)
S["refB_s8_kana"] = C(steps=8, seed=1234, ref=P(2024), nums="kana")
S["refB_s8_noemoji"] = C(steps=8, seed=1234, ref=P(2024), emoji="none")
S["refB_s6"] = C(steps=6, seed=1234, ref=P(2024))
S["refB_s12"] = C(steps=12, seed=1234, ref=P(2024))
S["refB_s8_seed7"] = C(steps=8, seed=7, ref=P(2024))
S["refC_s8_d090"] = C(steps=8, seed=1234, ref=P(31337), dscale=0.9)
S["refC_s8_cap5_d090"] = C(steps=8, seed=1234, ref=P(31337), caption=CAP5, dscale=0.9)
S["refA_s8_d090"] = C(steps=8, seed=1234, ref=P(100), dscale=0.9)
STAGE = S
