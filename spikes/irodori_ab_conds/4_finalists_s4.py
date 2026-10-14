P = lambda sd: [str(OUT / "parts" / f"refgen_s{sd}_{i}.wav") for i in range(3)]
CAP5 = "明るく優しい20代女性のピアノの先生。生徒に話しかけるように、自然な抑揚とテンポで、はきはきと話す。"
S = {}
for rep in ("", "_rep"):
    S[f"fin_refB_d090{rep}"] = C(seed=1234, ref=P(2024), dscale=0.9)
    S[f"fin_refB_d085{rep}"] = C(seed=1234, ref=P(2024), dscale=0.85)
    S[f"fin_refC_cap5_d090{rep}"] = C(seed=1234, ref=P(31337), caption=CAP5, dscale=0.9)
    S[f"fin_refA_d090{rep}"] = C(seed=1234, ref=P(100), dscale=0.9)
    S[f"fin_s100_cap5_d090{rep}"] = C(seed=100, caption=CAP5, dscale=0.9)
    S[f"fin_base{rep}"] = C()
STAGE = S
