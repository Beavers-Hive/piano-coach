# デモ用の楽譜

どれも Mutopia Project から 2026-10-15 にダウンロードしたもの。ライセンスはパブリックドメインで、「free to distribute, modify, and perform」と明記されている。

| ディレクトリ | 曲 | 内容 | 出典 |
|---|---|---|---|
| minuet-g/ | メヌエット ト長調 BWV Anh.114（ペツォールト作とされる） | 1 ページ、32 小節、3/4 拍子、2 段（右手・左手）。前半と後半にそれぞれ繰り返し記号があり、装飾音（トリル・モルデント）を含む | https://www.mutopiaproject.org/ftp/BachJS/BWVAnh114/anna-magdalena-04/ |
| fur-elise/ | エリーゼのために WoO 59（ベートーヴェン） | 3 ページ、2 段 | https://www.mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/ |

各ディレクトリには、次の 3 つのファイルがある。

- `*-a4.pdf`: 楽譜（取り込みのデモに使う）
- `*.mid`: MIDI（正解の音符データ。OMR の結果の検証にも使う）
- `*.ly`: LilyPond のソース（MusicXML に変換するときの元データ）

**第一候補は、メヌエットの 1〜8 小節。** 右手の旋律は 8 分音符が中心で、左手は全音符や 2 分音符が中心なので、初心者向けのデモに向いている。
