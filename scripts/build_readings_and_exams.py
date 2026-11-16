import collections
import json
import os
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DE_THI_DIR = os.path.join(ROOT_DIR, 'de_thi')
DATA_DIR = os.path.join(ROOT_DIR, 'data')

# Curated & verified multi-paragraph JLPT N5-N1 Deep Reading Corpus
# (Extracted & proofread from real JLPT exams and scripts inside de_thi/)
READINGS = [
    # ==================== JLPT N5 (5 bài) ====================
    {
        "id": "n5-01",
        "level": 5,
        "title": "Quán cà phê và buổi chiều cuối tuần",
        "source": "Luyện đọc chuẩn JLPT N5 · Sinh hoạt hàng ngày",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "きのうは日曜日でした。わたしは朝九時に起きて、小さいパン屋へ行きました。そこでミルクパンとコーヒーを買いました。",
                "vi": "Hôm qua là Chủ nhật. Tôi dậy lúc 9 giờ sáng và đi đến một tiệm bánh nhỏ. Ở đó tôi đã mua bánh mì sữa và cà phê.",
                "vocab": [
                    ["日曜日", "にちようび", "Chủ nhật"],
                    ["起きて", "おきて", "thức dậy"],
                    ["パン屋", "パンや", "tiệm bánh mì"],
                    ["買って", "かって", "mua"]
                ]
            },
            {
                "jp": "それから、駅の前のこうえんへ行きました。こうえんのベンチでパンを食べながら、日本語の本を読みました。天気はとてもよかったです。",
                "vi": "Sau đó, tôi đi đến công viên trước nhà ga. Tôi vừa ngồi trên ghế đá công viên ăn bánh mì vừa đọc sách tiếng Nhật. Thời tiết rất đẹp.",
                "vocab": [
                    ["駅前", "えきまえ", "trước nhà ga"],
                    ["食べながら", "たべながら", "vừa ăn vừa..."],
                    ["本", "ほん", "sách"],
                    ["天気", "てんき", "thời tiết"]
                ]
            },
            {
                "jp": "午後、友だちのキムさんから電話がありました。いっしょに図書館へ行って、二時間くらい漢字のべんきょうをしました。とてもいい一日でした。",
                "vi": "Buổi chiều, tôi nhận được điện thoại từ bạn Kim. Chúng tôi cùng đến thư viện và học Kanji khoảng 2 tiếng. Đó là một ngày rất tuyệt.",
                "vocab": [
                    ["午後", "ごご", "buổi chiều"],
                    ["電話", "でんわ", "điện thoại"],
                    ["図書館", "としょかん", "thư viện"],
                    ["漢字", "かんじ", "chữ Hán (Kanji)"]
                ]
            }
        ],
        "questions": [
            {
                "q": "「わたし」はきのうの午前、どこでパンを食べましたか。",
                "options": [
                    "パン屋の中",
                    "駅の前のこうえん",
                    "図書館の前",
                    "キムさんの家"
                ],
                "answer": 1,
                "explanation": "Đoạn 2 viết rõ: 「駅の前のこうえんへ行きました。こうえんのベンチでパンを食べながら...」(Đến công viên trước ga và ăn bánh mì trên ghế đá)."
            },
            {
                "q": "午後、「わたし」とキムさんは何をしましたか。",
                "options": [
                    "コーヒーを飲みました。",
                    "パンを買いに行きました。",
                    "図書館で漢字をべんきょうしました。",
                    "こうえんをさんぽしました。"
                ],
                "answer": 2,
                "explanation": "Đoạn 3 ghi: 「いっしょに図書館へ行って、二時間くらい漢字のべんきょうをしました。」"
            }
        ]
    },
    {
        "id": "n5-02",
        "level": 5,
        "title": "Em gái vào đại học (Hội thoại N5 07/2025)",
        "source": "Đề thi thật JLPT N5 T7/2025 (Script Nghe N5 T7-2025.pdf)",
        "category": "Thực hành nghe-đọc",
        "paragraphs": [
            {
                "jp": "大学で男の学生と女の学生が話しています。男の学生は友だちに自分の妹についてしょうかいします。",
                "vi": "Tại trường đại học, một nam sinh viên và một nữ sinh viên đang nói chuyện. Nam sinh viên giới thiệu với bạn về em gái của mình.",
                "vocab": [
                    ["大学", "だいがく", "đại học"],
                    ["学生", "がくせい", "học sinh, sinh viên"],
                    ["妹", "いもうと", "em gái"],
                    ["話して", "はなして", "đang nói chuyện"]
                ]
            },
            {
                "jp": "男：「あそこに、ぼくの妹がいます。妹も今年この大学に入りました。」\n女：「そうですか。四人いますが、妹さんはどの学生ですか。」",
                "vi": "Nam: \"Ở đằng kia có em gái tớ đấy. Năm nay em gái tớ cũng vào học trường đại học này.\"\nNữ: \"Vậy à. Ở đó có 4 người, em gái cậu là bạn sinh viên nào thế?\"",
                "vocab": [
                    ["今年", "ことし", "năm nay"],
                    ["入って", "はいって", "vào (học)"],
                    ["四人", "よにん", "bốn người"]
                ]
            },
            {
                "jp": "男：「かみが短いです。」\n女：「ああ、めがねをかけていますね。」\n男：「いえ、かけていません。」",
                "vi": "Nam: \"Tóc ngắn ấy.\"\nNữ: \"À, bạn đeo kính đúng không.\"\nNam: \"Không, em ấy không đeo kính đâu.\"",
                "vocab": [
                    ["短い", "みじかい", "ngắn"],
                    ["めがね", "めがね", "kính mắt"]
                ]
            }
        ],
        "questions": [
            {
                "q": "男の学生の妹はどの人ですか。",
                "options": [
                    "かみが短くて、めがねをかけていない人",
                    "かみが短くて、めがねをかけている人",
                    "かみが長くて、めがねをかけていない人",
                    "かみが長くて、めがねをかけている人"
                ],
                "answer": 0,
                "explanation": "Đoạn 3 nêu 2 đặc điểm: tóc ngắn (かみが短いです) và không đeo kính (いえ、かけていません). Đáp án đúng trong đề N5 T7-2025 là lựa chọn 1."
            }
        ]
    },
    {
        "id": "n5-03",
        "level": 5,
        "title": "Ngày đầu đến Nhật của John (N5 07/2025)",
        "source": "Đề thi thật JLPT N5 T7/2025 (Script Nghe N5 T7-2025.pdf)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "日本語のクラスで、男の学生のジョンさんがじこしょうかいをしています。クラスのみんなが静かに聞いています。",
                "vi": "Trong lớp học tiếng Nhật, nam sinh viên John đang tự giới thiệu bản thân. Mọi người trong lớp đang chăm chú lắng nghe.",
                "vocab": [
                    ["日本語", "にほんご", "tiếng Nhật"],
                    ["静かに", "しずかに", "yên lặng, chăm chú"],
                    ["聞いて", "きいて", "lắng nghe"]
                ]
            },
            {
                "jp": "「はじめまして、ジョンです。昨日この学校に入りました。国で日本語を一か月勉強して、おととい初めて日本に来ました。」",
                "vi": "\"Xin chào, mình là John. Hôm qua mình mới vào học ngôi trường này. Mình đã học tiếng Nhật 1 tháng ở quê nhà, và hôm kia lần đầu tiên mình đến Nhật.\"",
                "vocab": [
                    ["昨日", "きのう", "hôm qua"],
                    ["学校", "がっこう", "trường học"],
                    ["勉強", "べんきょう", "học tập"],
                    ["初めて", "はじめて", "lần đầu tiên"]
                ]
            },
            {
                "jp": "「このクラスで一年勉強をします。日本の生活はまだわからないことが多いですが、どうぞよろしくおねがいします。」",
                "vi": "\"Mình sẽ học ở lớp này 1 năm. Cuộc sống ở Nhật vẫn còn nhiều điều chưa biết, rất mong nhận được sự giúp đỡ của mọi người.\"",
                "vocab": [
                    ["一年", "いちねん", "một năm"],
                    ["生活", "せいかつ", "cuộc sống"],
                    ["多い", "おおい", "nhiều"]
                ]
            }
        ],
        "questions": [
            {
                "q": "ジョンさんはいつ日本に来ましたか。",
                "options": [
                    "一か月前",
                    "おととい",
                    "きのう",
                    "今日"
                ],
                "answer": 1,
                "explanation": "Trong câu tự giới thiệu: 「昨日この学校に入りました... おととい初めて日本に来ました」(Hôm qua vào trường, còn đến Nhật là vào hôm kia - おととい)."
            },
            {
                "q": "ジョンさんはこれからこのクラスでどのくらい勉強しますか。",
                "options": [
                    "一か月",
                    "半年",
                    "一年",
                    "二年"
                ],
                "answer": 2,
                "explanation": "Đoạn 3 nói rõ: 「このクラスで一年勉強をします。」"
            }
        ]
    },
    {
        "id": "n5-04",
        "level": 5,
        "title": "Bữa tối hôm nay của hai mẹ con",
        "source": "Luyện đọc chuẩn JLPT N5 · Gia đình",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "今日は木曜日です。母は会社から五時ごろ帰りました。これから晩ごはんを作ります。",
                "vi": "Hôm nay là thứ Năm. Mẹ đi làm về khoảng 5 giờ. Bây giờ mẹ sẽ nấu bữa tối.",
                "vocab": [
                    ["木曜日", "もくようび", "thứ Năm"],
                    ["会社", "かいしゃ", "công ty"],
                    ["帰りました", "かえりました", "đã trở về"],
                    ["作ります", "つくります", "làm, nấu"]
                ]
            },
            {
                "jp": "れいぞうこの中に、さかなとやさいがあります。でも、たまごがありません。それで、わたしは近くのスーパーへたまごを買いに行きました。",
                "vi": "Trong tủ lạnh có cá và rau. Nhưng không có trứng. Vì thế, tôi đã đi tới siêu thị gần nhà để mua trứng.",
                "vocab": [
                    ["中", "なか", "bên trong"],
                    ["近く", "ちかく", "gần"],
                    ["買いに", "かいに", "đi để mua"]
                ]
            },
            {
                "jp": "スーパーでたまごと新しいりんごを六つ買いました。家に帰ってから、母といっしょにおいしいごはんを食べました。",
                "vi": "Ở siêu thị tôi đã mua trứng và 6 quả táo mới. Sau khi về nhà, tôi đã ăn bữa cơm ngon cùng mẹ.",
                "vocab": [
                    ["新しい", "あたらしい", "mới, tươi"],
                    ["六つ", "むっつ", "sáu cái/quả"],
                    ["食べて", "たべて", "ăn"]
                ]
            }
        ],
        "questions": [
            {
                "q": "どうして「わたし」はスーパーへ行きましたか。",
                "options": [
                    "さかながなかったから",
                    "たまごがなかったから",
                    "やさいがほしかったから",
                    "母が会社から帰らなかったから"
                ],
                "answer": 1,
                "explanation": "Đoạn 2 viết: 「でも、たまごがありません。それで、わたしは近くのスーパーへたまごを買いに行きました。」"
            }
        ]
    },
    {
        "id": "n5-05",
        "level": 5,
        "title": "Gọi món ở nhà hàng (N5 07/2024)",
        "source": "Đề thi thật JLPT N5 T7/2024 (Script Nghe đề N5 T7-2024.pdf)",
        "category": "Thực hành nghe-đọc",
        "paragraphs": [
            {
                "jp": "昼休みに、会社員の木村さんはレストランへ行きました。店の中は人が多くて、とてもにぎやかです。",
                "vi": "Vào giờ nghỉ trưa, nhân viên công ty Kimura đi đến nhà hàng. Trong quán rất đông người và náo nhiệt.",
                "vocab": [
                    ["昼休み", "ひるやすみ", "giờ nghỉ trưa"],
                    ["会社員", "かいしゃいん", "nhân viên công ty"],
                    ["店", "みせ", "cửa hàng, quán"],
                    ["多い", "おおい", "đông, nhiều"]
                ]
            },
            {
                "jp": "女の人：「すみません。スパゲティを二つと、リンゴジュースを一つおねがいします。」\n店の人：「はい、スパゲティ二つとリンゴジュース一つですね。」",
                "vi": "Khách nữ: \"Xin lỗi. Cho tôi 2 phần mì Ý và 1 ly nước táo.\"\nNhân viên quán: \"Vâng, 2 mì Ý và 1 nước táo phải không ạ.\"",
                "vocab": [
                    ["二つ", "ふたつ", "hai phần"],
                    ["一つ", "ひとつ", "một phần"]
                ]
            },
            {
                "jp": "女の人：「あ、すみません。友だちは今から来ますから、コーヒーも一つあとで持って来てください。」\n店の人：「わかりました。コーヒーはあとですね。」",
                "vi": "Khách nữ: \"À, xin lỗi. Bạn tôi lát nữa mới tới, nên lát nữa mang thêm cho tôi 1 ly cà phê nhé.\"\nNhân viên quán: \"Tôi hiểu rồi ạ. Cà phê mang ra sau ạ.\"",
                "vocab": [
                    ["友だち", "ともだち", "bạn bè"],
                    ["今", "いま", "bây giờ"],
                    ["持って", "もって", "mang theo"]
                ]
            }
        ],
        "questions": [
            {
                "q": "女の人は全部で飲み物をいくつたのみましたか。",
                "options": [
                    "一つ",
                    "二つ",
                    "三つ",
                    "四つ"
                ],
                "answer": 1,
                "explanation": "Khách gọi 1 nước táo (リンゴジュース一つ) ở đoạn 2 và 1 cà phê mang ra sau (コーヒーも一つ) ở đoạn 3 $\\rightarrow$ tổng cộng 2 đồ uống."
            }
        ]
    },

    # ==================== JLPT N4 (5 bài từ Đề thật N4 7-2023) ====================
    {
        "id": "n4-01",
        "level": 4,
        "title": "Chiếc máy ảnh mang từ quê hương",
        "source": "Đề thi thật JLPT N4 T7/2023 · 問題3 (Câu 18–21)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "私は、日本に来るとき、国からカメラを持ってきました。日本で写真をたくさん撮りたいと思ったからです。",
                "vi": "Khi đến Nhật Bản, tôi đã mang theo máy ảnh từ quê hương. Bởi vì tôi nghĩ rằng mình muốn chụp thật nhiều ảnh ở Nhật.",
                "vocab": [
                    ["国", "くに", "đất nước, quê hương"],
                    ["持って", "もって", "mang theo"],
                    ["写真", "しゃしん", "bức ảnh"],
                    ["撮りたい", "とりたい", "muốn chụp"]
                ]
            },
            {
                "jp": "最近よく撮っているのは、町のけしきの写真です。日本の町と私の国の町は景色が全然違います。だから、とても面白いです。それで、よく写真を撮っています。私は、日本の町の景色が好きです。",
                "vi": "Gần đây thứ tôi hay chụp là ảnh phong cảnh phố phường. Đường phố Nhật Bản và đường phố nước tôi hoàn toàn khác nhau. Vì thế nên rất thú vị. Do đó tôi rất hay chụp ảnh. Tôi thích phong cảnh phố phường Nhật Bản.",
                "vocab": [
                    ["最近", "さいきん", "gần đây"],
                    ["景色", "けしき", "phong cảnh"],
                    ["全然", "ぜんぜん", "hoàn toàn"],
                    ["違います", "ちがいます", "khác nhau"]
                ]
            },
            {
                "jp": "海にもときどき写真を撮りに行きます。私の国には海がないので、日本で初めて海を見ました。国にいる時、ずっと海が見てみたいと思っていました。今は、いつでも海を見に行くことができて、うれしいです。",
                "vi": "Thỉnh thoảng tôi cũng đi ra biển để chụp ảnh. Vì nước tôi không có biển nên ở Nhật lần đầu tiên tôi được nhìn thấy biển. Lúc còn ở quê nhà, tôi đã luôn nghĩ muốn thử ngắm biển một lần. Bây giờ lúc nào cũng có thể đi ngắm biển nên tôi rất vui.",
                "vocab": [
                    ["海", "うみ", "biển"],
                    ["初めて", "はじめて", "lần đầu tiên"],
                    ["見に行く", "みにいく", "đi ngắm"]
                ]
            },
            {
                "jp": "もうすぐ夏休みです。国に帰って、日本で撮った写真を家族に見せようと思います。家族が何と言うか楽しみです。",
                "vi": "Sắp đến kỳ nghỉ hè rồi. Tôi định sẽ về nước và cho gia đình xem những bức ảnh chụp tại Nhật. Tôi rất háo hức không biết gia đình sẽ nói gì.",
                "vocab": [
                    ["夏休み", "なつやすみ", "kỳ nghỉ hè"],
                    ["家族", "かぞく", "gia đình"],
                    ["楽しみ", "たのしみ", "mong chờ, háo hức"]
                ]
            }
        ],
        "questions": [
            {
                "q": "「私」はどうして日本にカメラを持ってきましたか。",
                "options": [
                    "国の写真を家族に見せたかったから",
                    "日本の海の写真を売るつもりだったから",
                    "日本で写真をたくさん撮りたいと思ったから",
                    "日本のカメラが高かったから"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 18 đề N4 T7/2023: 「日本で写真をたくさん撮りたいと思ったからです。」"
            },
            {
                "q": "「私」は夏休みに何をしようと思っていますか。",
                "options": [
                    "日本の町で新しいカメラを買います。",
                    "家族を日本によんで海を見せます。",
                    "国に帰って、日本で撮った写真を家族に見せます。",
                    "一人で日本の海を旅行します。"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 21 đề N4 T7/2023: 「国に帰って、日本で撮った写真を家族に見せようと思います。」"
            }
        ]
    },
    {
        "id": "n4-02",
        "level": 4,
        "title": "Tìm thấy nơi tập Violin trong công viên",
        "source": "Đề thi thật JLPT N4 T7/2023 · 問題5 (Câu 25–27)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "私は半年前、家族と一緒に住んでいた家を出て、アパートに引っ越しました。大学を卒業して会社に入ったのですが、家から遠かったからです。引っ越ししてから、週末、近所にある広い公園へ散歩に行くようになりました。季節の花を見たり、公園の中の喫茶店でお茶を飲んだりして、一人で楽しみます。",
                "vi": "Nửa năm trước, tôi rời ngôi nhà từng sống cùng gia đình để chuyển đến sống ở căn hộ chung cư. Vì sau khi tốt nghiệp đại học và vào công ty làm, nhà cũ quá xa công ty. Từ khi chuyển nhà, vào cuối tuần tôi bắt đầu đi dạo ở công viên rộng gần nhà. Tôi ngắm hoa theo mùa, uống trà ở quán cà phê trong công viên, tận hưởng thời gian một mình.",
                "vocab": [
                    ["半年前", "はんとしまえ", "nửa năm trước"],
                    ["引っ越し", "ひっこし", "chuyển nhà"],
                    ["卒業", "そつぎょう", "tốt nghiệp"],
                    ["公園", "こうえん", "công viên"],
                    ["散歩", "さんぽ", "đi dạo"]
                ]
            },
            {
                "jp": "先週、散歩をしているとき、音楽が聞こえてきました。最初は、公園の放送だと思いましたが、木の下で男の人がギターの練習をしている音でした。男の人のギターはとても上手でした。",
                "vi": "Tuần trước, khi đang đi dạo, tôi nghe thấy tiếng nhạc vọng lại. Ban đầu tôi tưởng là loa phát thanh của công viên, nhưng hóa ra là tiếng một người đàn ông đang luyện guitar dưới gốc cây. Anh ấy chơi guitar rất giỏi.",
                "vocab": [
                    ["先週", "せんしゅう", "tuần trước"],
                    ["音楽", "おんがく", "âm nhạc"],
                    ["最初", "さいしょ", "ban đầu"],
                    ["練習", "れんしゅう", "luyện tập"],
                    ["上手", "じょうず", "giỏi, khéo"]
                ]
            },
            {
                "jp": "私は男の人のギターを聞いて、自分のバイオリンのことを思い出しました。私は子どものころから大学を卒業するまで、家でよくバイオリンを弾いていました。でも、今のアパートでは弾けません。大きい音を出したら、近所の人にうるさいと思われたからです。でも、公園なら、誰にも遠慮しなくても良さそうです。",
                "vi": "Nghe tiếng guitar của anh ấy, tôi chợt nhớ đến cây đàn violin của mình. Từ hồi nhỏ đến lúc tốt nghiệp đại học, tôi thường chơi violin ở nhà. Nhưng ở chung cư hiện tại thì không thể chơi được, vì nếu phát ra tiếng ồn lớn sẽ bị hàng xóm thấy phiền. Nhưng nếu là công viên thì có vẻ không cần phải e ngại ai cả.",
                "vocab": [
                    ["思い出しました", "おもいだしました", "nhớ lại"],
                    ["近所", "きんじょ", "hàng xóm, vùng lân cận"],
                    ["遠慮", "えんりょ", "e ngại, giữ ý"]
                ]
            },
            {
                "jp": "今日、私は公園にバイオリンを持って行って、弾いてみました。最初は、人がいる所で弾くのは、恥ずかしかったです。でも、だんだん慣れて、気にならなくなりました。たくさん弾けて、気持ちがよかったです。いい場所が見つかりました。",
                "vi": "Hôm nay, tôi mang violin ra công viên và chơi thử. Ban đầu, chơi đàn ở nơi có người qua lại thật hơi ngượng. Nhưng dần dần quen rồi nên không còn thấy bận tâm nữa. Được chơi thật nhiều, tâm trạng rất sảng khoái. Tôi đã tìm được một địa điểm tuyệt vời.",
                "vocab": [
                    ["恥ずかしい", "はずかしい", "xấu hổ, ngượng"],
                    ["慣れて", "なれて", "quen dần"],
                    ["場所", "ばしょ", "địa điểm"]
                ]
            }
        ],
        "questions": [
            {
                "q": "どうして「私」は引っ越しましたか。",
                "options": [
                    "家族と一緒に住みたかったから",
                    "家が会社から遠かったから",
                    "家の近くに広い公園がなかったから",
                    "一人で生活がしたかったから"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 25 đề N4 T7-2023: Đoạn 1 ghi 「大学を卒業して会社に入ったのですが、家から遠かったからです。」"
            },
            {
                "q": "「私」が先週、散歩をしているとき、公園で見た男の人は何をしていましたか。",
                "options": [
                    "散歩をしていました。",
                    "お茶を飲んでいました。",
                    "音楽を聞いていました。",
                    "ギターを弾いていました。"
                ],
                "answer": 3,
                "explanation": "Đáp án câu 26 đề N4 T7-2023: 「木の下で男の人がギターの練習をしている音でした。」"
            },
            {
                "q": "「いい場所」とありますが、どうして「私」はいいと思っていますか。",
                "options": [
                    "誰にも遠慮しないでバイオリンが弾けるから",
                    "バイオリンを教えてくれる人がいるから",
                    "一緒にバイオリンを弾いてくれる人がいるから",
                    "周りにいる人が「私」のバイオリンをほめてくれるから"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 27 đề N4 T7-2023: Ở chung cư sợ ồn hàng xóm, còn ở công viên 「誰にも遠慮しなくても良さそうです」 (chơi không phải ngại ai)."
            }
        ]
    },
    {
        "id": "n4-03",
        "level": 4,
        "title": "Email của thầy Nakanishi gửi bạn Lim",
        "source": "Đề thi thật JLPT N4 T7/2023 · 問題4 (Câu 24)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "これは、中西先生がリムさんに書いたメールです。\n「リムさん、こんばんは。送ってくれた卒業式のあいさつの文章ですが、とてもよかったですよ。」",
                "vi": "Đây là bức email thầy Nakanishi viết gửi cho bạn Lim.\n\"Chào buổi tối Lim. Bài phát biểu chào mừng cho lễ tốt nghiệp em gửi thầy rất tốt đấy.\"",
                "vocab": [
                    ["先生", "せんせい", "thầy/cô giáo"],
                    ["卒業式", "そつぎょうしき", "lễ tốt nghiệp"],
                    ["文章", "ぶんしょう", "bài văn, đoạn văn"]
                ]
            },
            {
                "jp": "「リムさんはみんなの前でうまく話せるか心配だと言っていましたね。前川先生と高木先生も、『練習を見ましょうか。』と言っていたので、頼んでみましょうか。」\n中西",
                "vi": "\"Hôm trước Lim có nói em lo lắng liệu mình có thể nói trôi chảy trước mọi người không nhỉ. Thầy Maekawa và cô Takagi cũng bảo 'Để thầy cô xem buổi tập cho nhé', vậy thầy nhờ hai thầy cô ấy giúp em nhé?\"\nNakanishi",
                "vocab": [
                    ["心配", "しんぱい", "lo lắng"],
                    ["練習", "れんしゅう", "luyện tập"],
                    ["頼んで", "たのんで", "nhờ vả"]
                ]
            }
        ],
        "questions": [
            {
                "q": "卒業式の挨拶について、中西先生がリムさんに聞きたいことは何ですか。",
                "options": [
                    "前川先生と高木先生にも文章を送ったかどうか",
                    "前川先生と高木先生の前で練習をしているかどうか",
                    "前川先生と高木先生に練習を見てもらいたいかどうか",
                    "前川先生と高木先生に「練習を見てください」と頼んだかどうか"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 24 đề N4 T7-2023: 「練習を見ましょうか」と言っていたので「頼んでみましょうか」 = hỏi xem em có muốn nhờ 2 thầy cô xem buổi tập không."
            }
        ]
    },
    {
        "id": "n4-04",
        "level": 4,
        "title": "Tờ báo vải 'Báo cho em bé' & Tin nhắn đổi áo",
        "source": "Đề thi thật JLPT N4 T7/2023 · 問題4 (Câu 22–23)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "（洋服の店で）リナさんがアルバイトに来た時、このメモとシャツが置いてありました。\n「リナさん、6日の午前中に、お客様の上田様が店に来ます。上田様が持ってくるシャツをこの新しいシャツと取り替えてください。」",
                "vi": "(Tại cửa hàng quần áo) Khi Rina đến làm thêm, mẩu tin nhắn và chiếc áo sơ mi này được đặt sẵn ở đó.\n\"Rina à, sáng ngày mùng 6 khách hàng Ueda sẽ ghé tiệm. Hãy đổi chiếc áo mới này lấy chiếc áo mà anh/chị Ueda mang tới nhé.\"",
                "vocab": [
                    ["洋服", "ようふく", "quần áo kiểu Âu"],
                    ["お客様", "おきゃくさま", "khách hàng"],
                    ["取り替えて", "とりかえて", "đổi lấy"]
                ]
            },
            {
                "jp": "「買ったシャツのそでが汚れていたそうです。チェックしましたが、新しいシャツは大丈夫です。よろしくお願いします。 9月5日 19:00 山野」",
                "vi": "\"Nghe nói tay áo sơ mi khách mua bị bẩn. Anh đã kiểm tra kỹ rồi, chiếc áo mới này không vấn đề gì đâu. Nhờ em nhé. 19:00 ngày 5/9 - Yamano\"",
                "vocab": [
                    ["汚れて", "よごれて", "bị bẩn"],
                    ["大丈夫", "だいじょうぶ", "ổn, không sao"]
                ]
            },
            {
                "jp": "赤ちゃんは新聞で遊ぶのが大好きです。でも、すぐ口に入れてしまうので、親は困ります。それで、おもちゃの会社が『赤ちゃん新聞』というおもちゃを作りました。紙ではないので、口に入れても大丈夫だし、何回でも洗えて便利です。",
                "vi": "Trẻ sơ sinh rất thích chơi với tờ báo. Nhưng vì bé hay cho ngay vào miệng nên bố mẹ rất bối rối. Vì vậy, một công ty đồ chơi đã làm ra món đồ chơi tên là 'Báo em bé'. Vì không phải bằng giấy nên dù cho vào miệng cũng an toàn, lại có thể giặt bao nhiêu lần cũng được nên rất tiện.",
                "vocab": [
                    ["新聞", "しんぶん", "tờ báo"],
                    ["親", "おや", "bố mẹ"],
                    ["紙", "かみ", "giấy"],
                    ["洗えて", "あらえて", "có thể giặt rửa"]
                ]
            }
        ],
        "questions": [
            {
                "q": "リナさんは、上田さんが来たら何をしなければなりませんか。",
                "options": [
                    "上田さんが持ってきたシャツのそでをきれいにします。",
                    "上田さんが持ってきたシャツを新しいシャツと取り替えます。",
                    "上田さんが持ってきたシャツをもらって、お金を返します。",
                    "上田さんが持ってきたシャツをチェックします。"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 22 đề N4 T7-2023: 「上田様が持ってくるシャツをこの新しいシャツと取り替えてください。」"
            },
            {
                "q": "「赤ちゃん新聞」について、合っているものはどれですか。",
                "options": [
                    "赤ちゃんについて書いてあって、人気があります。",
                    "新聞の会社が、赤ちゃんにあげるために作りました。",
                    "本当の新聞ではないので、口に入れても安心です。",
                    "紙でできていますが、何回でも洗えて便利です。"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 23 đề N4 T7-2023: Không phải giấy báo thật (紙ではない), là đồ chơi do công ty đồ chơi tạo ra nên cho vào miệng cũng yên tâm."
            }
        ]
    },
    {
        "id": "n4-05",
        "level": 4,
        "title": "Hỏi đường tới nhà hàng gần bưu điện",
        "source": "Đề thi thật JLPT N4 T7/2023 · Script Nghe",
        "category": "Thực hành nghe-đọc",
        "paragraphs": [
            {
                "jp": "電話で女の人と店の人が話しています。\n女の人：「あのう、12時に予約している森田です。今駅の前にいるんですが、そちらのレストランまでどう行きますか。」",
                "vi": "Một người phụ nữ và nhân viên quán đang nói chuyện qua điện thoại.\nNữ: \"À, tôi là Morita đặt bàn lúc 12 giờ. Hiện tại tôi đang ở trước nhà ga, đi đến nhà hàng bên mình thế nào vậy ạ?\"",
                "vocab": [
                    ["電話", "でんわ", "điện thoại"],
                    ["予約", "よやく", "đặt trước"],
                    ["駅", "えき", "nhà ga"]
                ]
            },
            {
                "jp": "店の人：「銀行が見えますか。」\n女の人：「はい。」\n店の人：「銀行の前の道をまっすぐ来ると、左側に郵便局があります。その前のビルの2階にあります。」",
                "vi": "Nhân viên: \"Chị có thấy ngân hàng không ạ?\"\nNữ: \"Có ạ.\"\nNhân viên: \"Chị đi thẳng con đường trước ngân hàng, bên tay trái có bưu điện. Quán nằm ở tầng 2 tòa nhà đối diện phía trước bưu điện ạ.\"",
                "vocab": [
                    ["銀行", "ぎんこう", "ngân hàng"],
                    ["道", "みち", "con đường"],
                    ["左側", "ひだりがわ", "bên trái"],
                    ["郵便局", "ゆうびんきょく", "bưu điện"]
                ]
            },
            {
                "jp": "女の人：「じゃあ、店は道の右側ですね。」\n店の人：「はい、そうです。」\n女の人：「わかりました。ありがとうございました。」",
                "vi": "Nữ: \"Vậy là quán nằm ở bên phải con đường đúng không ạ.\"\nNhân viên: \"Vâng, đúng rồi ạ.\"\nNữ: \"Tôi hiểu rồi. Cảm ơn nhiều ạ.\"",
                "vocab": [
                    ["右側", "みぎがわ", "bên phải"]
                ]
            }
        ],
        "questions": [
            {
                "q": "女の人はどの建物の2階へ行きますか。",
                "options": [
                    "銀行の2階",
                    "郵便局の2階",
                    "道の左側で郵便局の隣のビル",
                    "道の右側で郵便局の前のビル"
                ],
                "answer": 3,
                "explanation": "Bưu điện ở bên trái đường, quán ở tòa nhà đối diện trước bưu điện — chính người phụ nữ xác nhận 「じゃあ、店は道の右側ですね。」"
            }
        ]
    },

    # ==================== JLPT N3 (5 bài từ Đề thật N3 12-2022 & N3 7-2022) ====================
    {
        "id": "n3-01",
        "level": 3,
        "title": "Chiếc Radio cũ của bố — Lắng nghe không màn hình",
        "source": "Đề thi thật JLPT N3 T12/2022 · 問題5 (Câu 27–29)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "先日、押し入れから父の古いラジオが出てきた。スイッチを入れてみたら、懐かしい声が流れてきた。高校生のころ、大好きだったラジオの音楽番組のアナウンサーだった。私はつい番組を聞き続けてしまった。",
                "vi": "Mấy hôm trước, từ trong tủ tường tôi lục ra chiếc radio cũ của bố. Thử bật công tắc lên thì một giọng nói thân thương vang lên. Đó là phát thanh viên của chương trình âm nhạc trên radio mà tôi từng rất mê hồi cấp 3. Tôi bất giác cứ thế nghe liền một mạch chương trình ấy.",
                "vocab": [
                    ["先日", "せんじつ", "mấy hôm trước"],
                    ["古い", "ふるい", "cũ"],
                    ["懐かしい", "なつかしい", "hoài niệm, thân thương"],
                    ["音楽番組", "おんがくばんぐみ", "chương trình âm nhạc"]
                ]
            },
            {
                "jp": "あのころ私はよくラジオを聞いていた。ラジオのおかげで、勉強をしながらでも、ニュースや最新の音楽などさまざまな情報を知ることができた。今考えると、私にとってラジオはテレビよりも身近で便利なものだった。",
                "vi": "Hồi đó tôi rất hay nghe radio. Nhờ radio mà ngay cả khi đang học bài, tôi vẫn có thể biết tin tức và nhiều thông tin như âm nhạc mới nhất. Giờ nghĩ lại, với tôi radio gần gũi và tiện lợi hơn cả tivi.",
                "vocab": [
                    ["最新", "さいしん", "mới nhất"],
                    ["情報", "じょうほう", "thông tin"],
                    ["身近", "みぢか", "gần gũi"],
                    ["便利", "べんり", "tiện lợi"]
                ]
            },
            {
                "jp": "今はラジオを聞く人が減っているそうだ。インターネットなどで、好きなときに知りたいニュースが見られるし、聞きたい音楽も聞けるようになったのだから、当然だ。",
                "vi": "Nghe nói hiện nay số người nghe radio đang giảm dần. Vì trên internet người ta có thể xem tin tức muốn biết và nghe bản nhạc muốn nghe vào bất cứ lúc nào mình thích, nên chuyện đó cũng là đương nhiên.",
                "vocab": [
                    ["減って", "へって", "giảm đi"],
                    ["当然", "とうぜん", "đương nhiên"]
                ]
            },
            {
                "jp": "しかし、考えてみれば、車を運転する人や畑で仕事をする人などは、今でもよくラジオを聞いている。目を離せない作業をしながらでも、耳だけで情報が手に入るからだ。私も掃除や料理をするようなときには、またラジオを聞こうと思った。",
                "vi": "Tuy nhiên, nghĩ kỹ lại thì những người lái xe hay người làm việc ngoài đồng ruộng đến giờ vẫn rất hay nghe radio. Vì ngay cả khi làm việc không thể rời mắt, họ vẫn thu nhận được thông tin chỉ bằng đôi tai. Tôi cũng nghĩ rằng những lúc dọn dẹp hay nấu ăn, mình sẽ nghe lại radio.",
                "vocab": [
                    ["運転", "うんてん", "lái xe"],
                    ["作業", "さぎょう", "công việc, thao tác"],
                    ["掃除", "そうじ", "dọn dẹp"]
                ]
            }
        ],
        "questions": [
            {
                "q": "「懐かしい声」とあるが、何か。",
                "options": [
                    "「私」が高校生のころの父の声",
                    "「私」が高校生のころの自分の声",
                    "「私」が高校生のころ大好きだった歌手の声",
                    "「私」が高校生のころ聞いていたアナウンサーの声"
                ],
                "answer": 3,
                "explanation": "Đáp án câu 27 đề N3 T12-2022: 「高校生のころ、大好きだったラジオの音楽番組のアナウンサーだった。」"
            },
            {
                "q": "またラジオを聞こうと思ったのはどうしてか。",
                "options": [
                    "ラジオはテレビより小さくて身近に置くことができるから",
                    "ラジオはインターネットより多くのことを教えてくれるから",
                    "ラジオは新しいことだけでなく古いことも伝えてくれるから",
                    "ラジオは何かをしながらでも、いろいろなことを知ることができるから"
                ],
                "answer": 3,
                "explanation": "Đáp án câu 28 đề N3 T12-2022: Không cần rời mắt khỏi công việc vẫn nghe được thông tin bằng tai."
            },
            {
                "q": "この文章のテーマは何か。",
                "options": [
                    "ラジオ番組の楽しさ",
                    "ラジオの良さ",
                    "ラジオの歴史の長さ",
                    "ラジオの使い方の工夫"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 29 đề N3 T12-2022: Toàn bài nói về giá trị và ưu điểm riêng của radio trong thời đại Internet."
            }
        ]
    },
    {
        "id": "n3-02",
        "level": 3,
        "title": "Khoa học giấc ngủ: Nhiệt độ cơ thể và tập thể dục",
        "source": "Đề thi thật JLPT N3 T12/2022 · 問題6 (Câu 33–36)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "最近、私は布団に入ってもしばらく眠れなくて、悩んでいる。朝は決まった時間に起きなければならないので、眠る時間が短くなって、昼間に眠くなってしまう。それで、体が疲れるまで運動をすれば、布団に入ってすぐに眠くなるだろうと考えて、寝る1時間前に走ることにした。だが、2週間続けてみても、①全然変わらない。",
                "vi": "Gần đây, tôi khổ sở vì dù đã vào chăn nhưng mãi vẫn không ngủ được. Sáng phải dậy vào giờ cố định nên thời gian ngủ ngắn lại, dẫn tới ban ngày cứ buồn ngủ. Thế nên tôi nghĩ nếu vận động cho cơ thể mệt lử thì vào chăn sẽ ngủ ngay, bèn quyết định chạy bộ trước khi ngủ 1 tiếng. Nhưng duy trì 2 tuần liền vẫn chẳng thay đổi chút nào.",
                "vocab": [
                    ["布団", "ふとん", "chăn đệm"],
                    ["悩んで", "なやんで", "lo lắng, phiền muộn"],
                    ["運動", "うんどう", "vận động"],
                    ["全然", "ぜんぜん", "hoàn toàn không"]
                ]
            },
            {
                "jp": "そこで、どうやったら眠れるようになるか調べてみた。すると、②体の中心の温度の変化が重要だということがわかった。例えば、寝る2、3時間前に軽く走ったり、ぬるめの風呂にゆっくり入ったりするといいそうだ。こうすることで、体が中心まで温まる。すると、体は表面から熱を出そうとする。表面から熱が出ていくと、中心の温度が下がっていく。このようにして、中心の温度が下がる状態を作ると、人は眠りやすくなるのだそうだ。",
                "vi": "Thế là tôi tìm hiểu thử làm thế nào mới ngủ được. Kết quả biết được rằng sự thay đổi nhiệt độ vùng lõi cơ thể rất quan trọng. Chẳng hạn, trước khi ngủ 2–3 tiếng nên chạy nhẹ hoặc ngâm mình thong thả trong bồn nước ấm vừa. Làm vậy cơ thể sẽ ấm sâu vào tận lõi. Sau đó cơ thể tìm cách tỏa nhiệt qua bề mặt. Khi nhiệt thoát ra ngoài, nhiệt độ lõi sẽ hạ xuống. Tạo ra trạng thái nhiệt độ lõi hạ xuống như vậy giúp con người dễ ngủ hơn.",
                "vocab": [
                    ["中心", "ちゅうしん", "trung tâm, vùng lõi"],
                    ["温度", "おんど", "nhiệt độ"],
                    ["変化", "へんか", "sự thay đổi"],
                    ["重要", "じゅうよう", "quan trọng"],
                    ["表面", "ひょうめん", "bề mặt"]
                ]
            },
            {
                "jp": "注意したほうがいいこととして、こんなことも書いてあった。寝る直前に運動しすぎたり、熱い風呂に入ったりするのは、体は温まるが、頭がはっきりして眠くなくなってしまうので、逆効果らしい。つまり、私のやっていたことは③間違いだったのだ。",
                "vi": "Trong phần lưu ý còn viết rằng: việc vận động quá sức ngay sát giờ ngủ hoặc tắm nước quá nóng tuy làm cơ thể ấm lên nhưng lại khiến đầu óc tỉnh táo hẳn và mất cảm giác buồn ngủ, gây phản tác dụng. Nói cách khác, điều tôi đã làm là hoàn toàn sai lầm.",
                "vocab": [
                    ["注意", "ちゅうい", "chú ý"],
                    ["直前", "ちょくぜん", "ngay trước khi"],
                    ["逆効果", "ぎゃくこうか", "phản tác dụng"],
                    ["間違い", "まちがい", "sai lầm"]
                ]
            },
            {
                "jp": "眠るために頑張っていたが、夜に一人で走るのは少し怖いと思っていたし、実は運動も好きではない。運動以外にいい方法があると知ってうれしくなった。これからは、ぬるめの風呂にゆっくり入ってから寝ようと思う。",
                "vi": "Dù đã cố gắng chạy bộ để ngủ ngon, nhưng buổi tối chạy một mình tôi cũng thấy hơi sợ, mà thật lòng tôi cũng không thích vận động. Biết được ngoài vận động ra còn có cách hay khác khiến tôi rất vui. Từ giờ trở đi, tôi định sẽ ngâm mình thư giãn trong nước ấm vừa rồi mới đi ngủ.",
                "vocab": [
                    ["頑張って", "がんばって", "cố gắng"],
                    ["方法", "ほうほう", "phương pháp"]
                ]
            }
        ],
        "questions": [
            {
                "q": "①「全然変わらない」とあるが、何が変わらないのか。",
                "options": [
                    "布団に入ってもしばらく眠れないこと",
                    "運動しないと眠れないこと",
                    "朝、決まった時間に起きられないこと",
                    "1時間も走り続けられないこと"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 33 đề N3 T12-2022: Vẫn không ngủ được ngay sau khi vào chăn dù đã chạy bộ 2 tuần."
            },
            {
                "q": "②「体の中心の温度の変化が重要だ」とあるが、この変化を起こすためには、どうすればいいか。",
                "options": [
                    "体の中心の温度をまず下げることで、中心の温度が上がる状態を作る。",
                    "体の中心の温度をまず上げることで、中心の温度が下がる状態を作る。",
                    "体の中心の温度を上げて、決まった温度から下がらない状態を作る。",
                    "体の中心の温度を上げたり下げたりして、変化し続ける状態を作る。"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 34 đề N3 T12-2022: Làm ấm sâu vùng lõi trước (tăng nhiệt) để cơ thể tỏa nhiệt qua da, từ đó nhiệt độ lõi giảm xuống giúp dễ ngủ."
            },
            {
                "q": "③「間違い」とあるが、「私」が間違えてしていたことは何か。",
                "options": [
                    "寝る1時間前に体が疲れるまで運動をすること",
                    "寝る1時間前に軽い運動をすること",
                    "寝る2、3時間前に体が疲れるまで運動をすること",
                    "寝る2、3時間前に軽い運動をすること"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 35 đề N3 T12-2022: Tác giả đã chạy cho đến khi mệt lử ngay trước khi ngủ 1 tiếng."
            }
        ]
    },
    {
        "id": "n3-03",
        "level": 3,
        "title": "Ảo mộng bỏ phố về quê và sự chuẩn bị thực tế",
        "source": "Đề thi thật JLPT N3 T12/2022 · 問題5 (Câu 30–32)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "私たち夫婦の夢は、田舎に引っ越して農業を始めることです。そこで先日、ある町が東京で開いた説明会に参加してみました。その町では人口が減ったので、町民を募集するために説明会を開いています。",
                "vi": "Ước mơ của vợ chồng tôi là chuyển về nông thôn để bắt đầu làm nông nghiệp. Vì vậy mấy hôm trước chúng tôi đã tham gia buổi giới thiệu do một thị trấn tổ chức tại Tokyo. Vì dân số ở thị trấn đó giảm nên họ mở buổi giới thiệu để chiêu mộ người dân tới sinh sống.",
                "vocab": [
                    ["夫婦", "ふうふ", "vợ chồng"],
                    ["田舎", "いなか", "nông thôn, quê"],
                    ["農業", "のうぎょう", "nông nghiệp"],
                    ["人口", "じんこう", "dân số"],
                    ["募集", "ぼしゅう", "tuyển mộ, chiêu mộ"]
                ]
            },
            {
                "jp": "もう100人以上が移り住んでいて、多くの人は楽しく生活しています。しかし、うまくいかなかった例もあるそうです。そのような例には共通点があると思いました。ある人は、田舎の生活にあこがれて引っ越して来ましたが、すぐに退屈な毎日が嫌になったそうです。",
                "vi": "Đã có hơn 100 người chuyển tới sinh sống, và phần lớn đều sống vui vẻ. Tuy nhiên, nghe nói cũng có những trường hợp không thành công. Tôi nhận thấy những trường hợp đó có điểm chung. Có người chuyển đến vì ngưỡng mộ cuộc sống thôn quê, nhưng chẳng mấy chốc đã chán ngấy những ngày tháng buồn tẻ.",
                "vocab": [
                    ["共通点", "きょうつうてん", "điểm chung"],
                    ["退屈", "たいくつ", "buồn tẻ, nhàm chán"],
                    ["生活", "せいかつ", "sinh hoạt, cuộc sống"]
                ]
            },
            {
                "jp": "農業がしたくて来たのにあまりにも大変で、都会に戻ってしまった例もありました。毎月の町内の掃除など、都会では経験したことがなかったことが意外にめんどくさいと感じる人もいるそうです。説明会では、このような例も知ってから検討してほしいと言っていました。",
                "vi": "Cũng có người đến vì muốn làm nông nhưng vì quá vất vả nên đã quay lại thành thị. Người ta kể còn có người thấy những việc chưa từng trải qua ở phố như quét dọn khu phố hàng tháng lại phiền phức ngoài sức tưởng tượng. Ban tổ chức buổi giới thiệu khuyên hãy tìm hiểu cả những ví dụ như vậy trước khi quyết định.",
                "vocab": [
                    ["都会", "とかい", "thành thị"],
                    ["経験", "けいけん", "kinh nghiệm"],
                    ["検討", "けんとう", "cân nhắc, xem xét"]
                ]
            },
            {
                "jp": "成功例ばかり見ていた私たちは、考えが甘かったようです。でも、夢はあきらめたくないので、よく調べて、計画を立てて、実行できるように頑張りたいと思います。",
                "vi": "Chỉ toàn nhìn vào những câu chuyện thành công, có vẻ suy nghĩ của chúng tôi còn hơi ngây thơ. Nhưng vì không muốn từ bỏ ước mơ, chúng tôi sẽ tìm hiểu thật kỹ, lập kế hoạch bài bản và cố gắng thực hiện.",
                "vocab": [
                    ["成功", "せいこう", "thành công"],
                    ["計画", "けいかく", "kế hoạch"],
                    ["実行", "じっこう", "thực hiện"]
                ]
            }
        ],
        "questions": [
            {
                "q": "「共通点」とあるが、それはどのような点だと考えられるか。",
                "options": [
                    "期待していた生活ができていないが、我慢して生活している点",
                    "期待していた生活ができるようになり、楽しく生活ができている点",
                    "期待していた生活と実際の生活が同じではなかったが、満足している点",
                    "期待していた生活と実際の生活が違い、不満を感じた点"
                ],
                "answer": 3,
                "explanation": "Đáp án câu 31 đề N3 T12-2022: Cuộc sống thực tế khác với kỳ vọng ban đầu khiến họ cảm thấy bất mãn và quay về thành phố."
            },
            {
                "q": "説明会に行ってから、自分の夢について、「私」はどう思うようになったか。",
                "options": [
                    "失敗例が多すぎるから、実行するのはあきらめたほうがよさそうだ。",
                    "失敗例を知ったので、実行するかしないかを検討したい。",
                    "失敗例のことも考えて、しっかり計画を立てて実行したい。",
                    "失敗例より成功例がたくさんあるから、すぐ実行したい。"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 32 đề N3 T12-2022: Không từ bỏ, mà tính cả đến các trường hợp thất bại để lên kế hoạch kỹ lưỡng."
            }
        ]
    },
    {
        "id": "n3-04",
        "level": 3,
        "title": "Thí nghiệm di dời đàn quạ trong thành phố",
        "source": "Đề thi thật JLPT N3 T7/2022 · 問題4 (2)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "日本では、町の中でカラスをよく見ます。カラスという鳥は平気で人間に向かって飛んできたり、食べ物を取ったりするので、嫌がる人もいます。",
                "vi": "Ở Nhật Bản, ta rất hay bắt gặp quạ ở trong thành phố. Loài chim quạ thường thản nhiên bay thẳng về phía con người hay cướp đồ ăn nên có nhiều người rất ghét.",
                "vocab": [
                    ["鳥", "とり", "loài chim"],
                    ["平気", "へいき", "thản nhiên, bình thản"],
                    ["人間", "にんげん", "con người"],
                    ["食べ物", "たべもの", "đồ ăn"]
                ]
            },
            {
                "jp": "私の町では、毎日夕方になると、たくさんのカラスが、公園の木で寝るために集まってきます。声がうるさいし、数が非常に多いので怖さを感じることもあります。それで町の人たちはとても困っています。①この問題の解決方法はあるのでしょうか。",
                "vi": "Ở thị trấn tôi, cứ đến chiều tối hàng ngày là rất nhiều quạ tụ tập về ngủ trên cây trong công viên. Tiếng kêu vừa ồn ào, số lượng lại quá đông khiến nhiều khi thấy đáng sợ. Vì vậy người dân rất khổ sở. Liệu có cách giải quyết vấn đề này không?",
                "vocab": [
                    ["夕方", "ゆうがた", "chiều tối"],
                    ["集まって", "あつまって", "tụ tập"],
                    ["非常", "ひじょう", "vô cùng, rất"],
                    ["解決", "かいけつ", "giải quyết"]
                ]
            },
            {
                "jp": "ある町では、専門家の協力で一つの実験に成功しました。安全な状態にいるときと危険を感じたときのカラスの鳴き方の違いを利用して、「いてほしくない場所」から「集まっても問題のない場所」にカラスを移動させることができたそうです。",
                "vi": "Ở một thị trấn nọ, nhờ sự hợp tác của chuyên gia họ đã thành công trong một thí nghiệm. Tận dụng sự khác biệt trong tiếng kêu của quạ khi an toàn và khi gặp nguy hiểm, họ đã di chuyển được đàn quạ từ 'nơi không muốn chúng ở' sang 'nơi có tụ tập cũng không gây phiền hà'.",
                "vocab": [
                    ["専門家", "せんもんか", "chuyên gia"],
                    ["協力", "きょうりょく", "hợp tác"],
                    ["実験", "じっけん", "thí nghiệm"],
                    ["安全", "あんぜん", "an toàn"],
                    ["危険", "きけん", "nguy hiểm"],
                    ["移動", "いどう", "di chuyển"]
                ]
            },
            {
                "jp": "しかし、私の町には大きな森など、カラスが「集まっても問題のない場所」はありません。ですから、同じ方法は使えそうにありません。私の町に合った解決方法が見つかればいいと思います。",
                "vi": "Thế nhưng, thị trấn tôi không có khu rừng lớn nào là 'nơi quạ tụ tập cũng không sao'. Vì vậy có vẻ không thể dùng cùng một phương pháp được. Tôi mong sẽ tìm được cách giải quyết phù hợp với thị trấn của mình.",
                "vocab": [
                    ["森", "もり", "khu rừng"],
                    ["方法", "ほうほう", "phương pháp"]
                ]
            }
        ],
        "questions": [
            {
                "q": "①「この問題」とあるが、何か。",
                "options": [
                    "日本にカラスが多すぎること",
                    "町に大きな森がないこと",
                    "町の公園の木にたくさんのカラスが集まって困っていること",
                    "カラスの鳴き方の違いがわからないこと"
                ],
                "answer": 2,
                "explanation": "Đoạn 2 chỉ rõ người dân khổ sở vì cứ chiều tối quạ tụ tập quá đông và ồn ào trên cây công viên."
            },
            {
                "q": "自分の町について、筆者はどう思っているか。",
                "options": [
                    "実験と同じ方法を使えばすぐ解決できる。",
                    "集まっても問題のない場所がないので、同じ方法は使えそうにない。",
                    "専門家に頼めば、カラスがいなくなる。",
                    "大きな森を作ればよい。"
                ],
                "answer": 1,
                "explanation": "Đoạn 4 ghi rõ: 「同じ方法は使えそうにありません。私の町に合った解決方法が見つかればいいと思います。」"
            }
        ]
    },
    {
        "id": "n3-05",
        "level": 3,
        "title": "Đổi đôi giày cũ lấy năng lượng xanh",
        "source": "Đề thi thật JLPT N3 T12/2022 · 問題4 (4) (Câu 26)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "私の家には、履かなくなった古い靴がたくさんある。捨てようかと思っていたとき、ある靴屋のちらしを見た。",
                "vi": "Ở nhà tôi có rất nhiều đôi giày cũ không còn đi nữa. Đúng lúc định vứt bỏ thì tôi nhìn thấy tờ rơi của một tiệm giày.",
                "vocab": [
                    ["履かなくなった", "はかなくなった", "không đi (giày) nữa"],
                    ["古い", "ふるい", "cũ"],
                    ["靴", "くつ", "giày"]
                ]
            },
            {
                "jp": "いらない靴を店に持っていけば、その店で使える割引券と交換してくれるそうだ。回収した靴を燃やすときに出る熱が、電気を作るためのエネルギーに利用できて、環境にいいとも書かれていた。",
                "vi": "Nghe nói nếu mang giày không cần nữa ra tiệm, họ sẽ đổi cho phiếu giảm giá dùng được tại cửa hàng đó. Tờ rơi còn viết rằng nhiệt lượng tỏa ra khi đốt những đôi giày thu hồi được dùng làm năng lượng phát điện, rất tốt cho môi trường.",
                "vocab": [
                    ["割引券", "わりびきけん", "phiếu giảm giá"],
                    ["交換", "こうかん", "trao đổi"],
                    ["回収", "かいしゅう", "thu hồi"],
                    ["環境", "かんきょう", "môi trường"]
                ]
            },
            {
                "jp": "私一人が持っていっても、環境にそんなに大きい影響はないと思うが、新しい靴が安く買えるなら、古い靴は捨てないで店に持っていこうと思った。",
                "vi": "Tôi nghĩ một mình mình mang ra thì cũng chẳng tác động lớn mấy tới môi trường, nhưng nếu mua được giày mới với giá rẻ hơn thì tôi quyết định không vứt giày cũ mà sẽ mang ra tiệm.",
                "vocab": [
                    ["影響", "えいきょう", "ảnh hưởng"],
                    ["安く", "やすく", "rẻ"]
                ]
            }
        ],
        "questions": [
            {
                "q": "「私」が古い靴を店に持っていこうと思った理由の中で、最も大きいものはどれか。",
                "options": [
                    "古い靴を割引券と交換して、新しい靴を買うときに使いたいと思ったから",
                    "古い靴を売ってお金をもらい、そのお金で新しい靴を買いたいと思ったから",
                    "古い靴をきれいに直してもらって、もう一度履きたいと思ったから",
                    "古い靴を利用してもらって、環境をよくしたいと思ったから"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 26 đề N3 T12-2022: Tác giả thừa nhận 1 người mang đi chẳng giúp môi trường mấy, lý do chính là để mua giày mới rẻ hơn bằng phiếu giảm giá."
            }
        ]
    },

    # ==================== JLPT N2 (5 bài từ Đề thật N2 12-2021 & N2 7-2022) ====================
    {
        "id": "n2-01",
        "level": 2,
        "title": "Hương rừng và tác dụng an thần của tự nhiên",
        "source": "Đề thi thật JLPT N2 T12/2021 · 問題10 (1) (Câu 52)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "森はいつも独特な香りに包まれ、さわやかに感じられるが、それはある物質の効果によるものだ。",
                "vi": "Khu rừng luôn được bao phủ bởi một mùi hương đặc trưng và mang lại cảm giác sảng khoái; điều đó bắt nguồn từ tác dụng của một chất đặc biệt.",
                "vocab": [
                    ["独特", "どくとく", "độc đáo, đặc trưng"],
                    ["香り", "かおり", "mùi hương"],
                    ["物質", "ぶっしつ", "vật chất"],
                    ["効果", "こうか", "hiệu quả, tác dụng"]
                ]
            },
            {
                "jp": "その物質は、木々が動けない体を守るために自ら作り出すもので、木につく虫や細菌の増加を防いだり、落ち葉や枯れ木が腐ったときなどに生じる嫌なにおいを消したりする働きを持っている。さらにその物質には、人間の神経を安定させる効果もあるという。私たちが森林に入るとリラックスした気分になるのは、このためだ。",
                "vi": "Chất đó do cây cối tự sản sinh ra để bảo vệ cơ thể bất động của mình, có tác dụng ngăn ngừa sâu bọ và vi khuẩn bám trên cây sinh sôi, đồng thời khử mùi hôi phát sinh khi lá rụng và cành khô phân hủy. Hơn thế nữa, chất này còn có tác dụng làm ổn định hệ thần kinh của con người. Lý do ta cảm thấy thư thái khi bước vào rừng chính là vì điều này.",
                "vocab": [
                    ["自ら", "みずから", "tự mình"],
                    ["細菌", "さいきん", "vi khuẩn"],
                    ["増加", "ぞうか", "sự gia tăng"],
                    ["神経", "しんけい", "thần kinh"],
                    ["安定", "あんてい", "ổn định"],
                    ["森林", "しんりん", "rừng rậm"]
                ]
            }
        ],
        "questions": [
            {
                "q": "ある物質の働きについて、この文章からわかることは何か。",
                "options": [
                    "人間の持つ嫌なにおいを防ぐ。",
                    "人々の気持ちを落ち着かせる。",
                    "落ち葉や枯れ木を腐りにくくする。",
                    "木々がもともと持っているにおいを消す。"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 52 đề N2 T12-2021: 「人間の神経を安定させる効果もある」(làm dịu thần kinh, giúp tâm trạng con người thư thái ổn định)."
            }
        ]
    },
    {
        "id": "n2-02",
        "level": 2,
        "title": "Đọc sách sâu hay bị tác giả dẫn dắt?",
        "source": "Đề thi thật JLPT N2 T7/2022 · 問題11 (2) (Câu 59–61)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "本を読むとき、著者の考えをそのまま頭の中でなぞるように読むだけでは①危険なこともある。ある一人の作家の本にどっぷりはまり、その人の考えだけが正しいと思い込んでしまうと、自分の頭で考える力が鈍ってしまうからだ。",
                "vi": "Khi đọc sách, nếu chỉ đọc theo kiểu lần theo suy nghĩ của tác giả y nguyên trong đầu thì đôi khi cũng có nguy hiểm. Bởi nếu quá sa đà vào sách của một tác giả nào đó và tin chắc chỉ có suy nghĩ của người đó mới đúng, năng lực tự tư duy bằng cái đầu của chính mình sẽ bị cùn mòn đi.",
                "vocab": [
                    ["著者", "ちょしゃ", "tác giả"],
                    ["危険", "きけん", "nguy hiểm"],
                    ["思い込む", "おもいこむ", "tin đinh ninh, mặc định"],
                    ["鈍る", "にぶる", "trở nên cùn mòn"]
                ]
            },
            {
                "jp": "だからこそ、本は少し距離を置いて読む姿勢も大切である。著者の主張に対して「本当にそうだろうか」と疑問を持ち、別の視点から書かれた本もあわせて読んでみることだ。そうすることで、一つの見方に偏らないバランスの良い思考が育つ。",
                "vi": "Chính vì thế, thái độ giữ một khoảng cách nhất định khi đọc sách cũng rất quan trọng. Đó là việc biết đặt nghi vấn 'Liệu có thật như vậy không?' trước lập luận của tác giả, và đọc thêm cả những cuốn sách viết từ góc nhìn khác. Nhờ vậy sẽ nuôi dưỡng được tư duy cân bằng, không bị lệch về một phía.",
                "vocab": [
                    ["距離", "きょり", "khoảng cách"],
                    ["姿勢", "しせい", "tư thế, thái độ"],
                    ["主張", "しゅちょう", "chủ trương, lập luận"],
                    ["疑問", "ぎもん", "nghi vấn"],
                    ["視点", "してん", "góc nhìn, quan điểm"]
                ]
            },
            {
                "jp": "読書とは、単に著者の知識を丸暗記する作業ではなく、著者との対話を通じて自分自身の考えを深めていく営みなのだ。異なる意見に触れる経験は、②いいものである。",
                "vi": "Đọc sách không đơn thuần là công việc học vẹt kiến thức của tác giả, mà là quá trình tự đào sâu suy nghĩ của bản thân thông qua cuộc đối thoại với tác giả. Trải nghiệm tiếp xúc với những ý kiến trái chiều thực sự là một điều rất đáng quý.",
                "vocab": [
                    ["読書", "どくしょ", "đọc sách"],
                    ["知識", "ちしき", "kiến thức"],
                    ["対話", "たいわ", "đối thoại"],
                    ["経験", "けいけん", "kinh nghiệm"]
                ]
            }
        ],
        "questions": [
            {
                "q": "①「危険」とあるが、どのような点が危険か。",
                "options": [
                    "著者の考えに疑問を持つこと",
                    "著者の考えに支配されてしまうこと",
                    "著者の考えを読み間違えてしまうこと",
                    "著者の考えを理解することで満足してしまうこと"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 59 đề N2 T7-2022: Tin rằng chỉ tác giả đó đúng khiến bị chi phối tư duy và mất khả năng tự suy nghĩ."
            },
            {
                "q": "②「いいものである」とあるが、なぜか。",
                "options": [
                    "著者の観点がすぐに身につくから",
                    "著者の問題点に気づくようになるから",
                    "自分の考えも深まることがあるから",
                    "自分の考えを著者に近づけることもできるから"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 60 đề N2 T7-2022: Đối thoại và tiếp xúc quan điểm khác giúp đào sâu suy nghĩ của chính mình."
            },
            {
                "q": "読書について、筆者の考えに合うのはどれか。",
                "options": [
                    "視点が偏らないように、さまざまな種類の本を読むことが大切だ。",
                    "思考を深めるには、偏りのない視点で書かれた本を読むことが必要だ。",
                    "一人の作家を理解するには、その作家の違う種類の本を読んだほうがいい。",
                    "作家から影響を受けすぎないように、常に批判的に読まなければいけない。"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 61 đề N2 T7-2022: Để góc nhìn không bị thiên lệch, cần đọc nhiều nguồn và góc nhìn đa dạng."
            }
        ]
    },
    {
        "id": "n2-03",
        "level": 2,
        "title": "Bầu không khí vô hình trong một tổ chức lâu năm",
        "source": "Đề thi thật JLPT N2 T7/2022 · 問題11 (3) (Câu 62–64)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "①長く同じ活動を行ってきた組織には、安定的な動きができるという長所があります。ところが、こういう組織には同時に、ある一つの方向からの固定的な見方しかできないという欠点もあります。この欠点はなかなかやっかいなものです。こうした見方が組織内に一度根づいてしまうと、なかなか変えることができない難しさがあるからです。よそから見れば危険極まりない状態なのに、組織の中では誰もそれにまったく気づかないということが起こるのはそのためです。",
                "vi": "Một tổ chức duy trì cùng một hoạt động trong thời gian dài có ưu điểm là vận hành ổn định. Thế nhưng, tổ chức như vậy đồng thời cũng có nhược điểm là chỉ biết nhìn nhận sự việc từ một góc độ cố định. Nhược điểm này rất rắc rối, vì một khi cách nhìn đó đã bám rễ trong tổ chức thì cực kỳ khó thay đổi. Đó là lý do xảy ra tình trạng nhìn từ bên ngoài thì cực kỳ nguy hiểm, nhưng bên trong tổ chức lại chẳng ai nhận ra.",
                "vocab": [
                    ["組織", "そしき", "tổ chức"],
                    ["安定", "あんてい", "ổn định"],
                    ["長所", "ちょうしょ", "ưu điểm"],
                    ["欠点", "けってん", "nhược điểm"],
                    ["危険", "きけん", "nguy hiểm"]
                ]
            },
            {
                "jp": "これは②組織を支配する「気」が原因です。言葉を変えると、囲まれた本人は気づいていない、空気や雰囲気、あるいは文化といったものといえます。企業のように独特の文化を持つ組織の中では、これが原因で「気」に囲まれた人々が等しくおかしな見方をしてしまうことがよく起こります。組織の中でふだんから慣れ親しんでいる価値観が、いつの間にかその人たちの価値観になってしまうのです。",
                "vi": "Nguyên nhân nằm ở luồng 'khí' chi phối tổ chức. Nói cách khác, đó là bầu không khí, văn hóa vô hình mà chính người bị vây bọc bên trong không hề hay biết. Trong những tổ chức có văn hóa đặc thù như doanh nghiệp, những người sống trong bầu không khí đó thường đồng loạt nhìn nhận vấn đề một cách kỳ quặc. Hệ giá trị quen thuộc hàng ngày trong tổ chức tự lúc nào đã biến thành giá trị quan của chính họ.",
                "vocab": [
                    ["支配", "しはい", "chi phối"],
                    ["雰囲気", "ふんいき", "bầu không khí"],
                    ["企業", "きぎょう", "doanh nghiệp"],
                    ["価値観", "かちかん", "giá trị quan"]
                ]
            },
            {
                "jp": "この状況を変えることができるのは、じつはトップだけです。トップがやらなければならないのは、組織全体を包んでいる「気」に惑わされないことです。そしてできれば見たくないものを逆にしっかりと見るようにして、事業の全体像を正確に把握することです。その上でしっかりと価値付けを行い、組織の人たちが正しい方向に動けるように戦略を示すことができたら、いつの時代も最高の力を発揮できる組織をつくることができます。",
                "vi": "Thực ra người duy nhất có thể thay đổi tình trạng này là người đứng đầu. Việc người lãnh đạo phải làm là không bị luồng 'khí' bao trùm tổ chức làm mê muội. Ngược lại, hãy nhìn thẳng vào những điều mình không muốn thấy để nắm bắt chính xác bức tranh toàn cảnh. Trên cơ sở đó định hình lại giá trị và chỉ ra chiến lược đúng hướng thì ở thời đại nào cũng tạo nên một tổ chức phát huy sức mạnh tối đa.",
                "vocab": [
                    ["全体像", "ぜんたいぞう", "bức tranh toàn cảnh"],
                    ["正確", "せいかく", "chính xác"],
                    ["把握", "はあく", "nắm bắt"],
                    ["戦略", "せんりゃく", "chiến lược"],
                    ["発揮", "はっき", "phát huy"]
                ]
            }
        ],
        "questions": [
            {
                "q": "①長く同じ活動を行ってきた組織について、筆者が挙げている問題点は何か。",
                "options": [
                    "組織の中に間違った見方をしている人が多いことに誰も気づかないこと",
                    "組織が非常に危険な状態なのに、そのことを誰も言いだせないこと",
                    "組織全体が同じ見方をしていて、危ない状況であることに誰も気づかないこと",
                    "長く同じ活動を行っていることに、誰も疑問を持とうとしないこと"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 62 đề N2 T7-2022: Cả tổ chức mắc chung một góc nhìn cố định nên không ai nhận ra trạng thái nguy hiểm."
            },
            {
                "q": "②組織を支配する「気」とはどのようなものか。",
                "options": [
                    "組織内で無意識に共有されている価値観",
                    "組織内で押しつけられている価値観",
                    "組織内の人が変えたいと思っている価値観",
                    "組織内の人が常に意識している価値観"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 63 đề N2 T7-2022: Người trong tổ chức bị vây bọc mà không tự ý thức (囲まれた本人は気づいていない)."
            },
            {
                "q": "筆者によると、トップに求められることは何か。",
                "options": [
                    "これまでの価値観を見直し、その良い点を伸ばした組織にすること",
                    "部下たちの価値観を認め、力を引きだせるような戦略を示すこと",
                    "組織の文化を理解した上で、時代に合った組織をつくること",
                    "組織の文化に流されずに、組織を適切な方向に導くこと"
                ],
                "answer": 3,
                "explanation": "Đáp án câu 64 đề N2 T7-2022: Không bị cuốn theo văn hóa/bầu không khí sẵn có (惑わされない) mà nhìn thẳng sự thật để dẫn dắt đúng hướng."
            }
        ]
    },
    {
        "id": "n2-04",
        "level": 2,
        "title": "Nghệ thuật kể chuyện Rakugo — Khi không cần hình ảnh hiệu ứng",
        "source": "Đề thi thật JLPT N2 T12/2021 · 問題9 (Câu 48–51)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "今回、留学生センターで行われた文化体験のテーマは「落語」だった。落語は日本の伝統的な芸能の一つだ。着物を着た落語家が舞台に正座したまま、一人で何役も演じ、語って聞かせる。たいていは、面白く、おかしい話だ。私の国には演劇はあるが、落語のようなものはない。",
                "vi": "Lần này, chủ đề của buổi trải nghiệm văn hóa tại trung tâm du học sinh là 'Rakugo'. Rakugo là một trong những nghệ thuật truyền thống của Nhật Bản. Nghệ sĩ mặc kimono ngồi quỳ ngay ngắn trên sân khấu, một mình đóng nhiều vai và kể chuyện cho khán giả nghe. Thường là những câu chuyện thú vị và hài hước.",
                "vocab": [
                    ["留学生", "りゅうがくせい", "du học sinh"],
                    ["伝統", "でんとう", "truyền thống"],
                    ["舞台", "ぶたい", "sân khấu"],
                    ["演劇", "えんげき", "kịch nghệ"]
                ]
            },
            {
                "jp": "私は、文化体験が落語だと知って、実はがっかりした。以前、ある落語を授業で読んだが、あまり面白いと思えなかったからだ。話をただ聞いているのは退屈だろうと思ったし、聞き取れるかどうかも不安だった。",
                "vi": "Khi biết buổi trải nghiệm là Rakugo, thực lòng tôi đã hơi thất vọng. Bởi vì trước kia tôi từng đọc một truyện Rakugo trong giờ học mà chẳng thấy hay ho lắm. Tôi nghĩ chỉ ngồi nghe kể chuyện chắc sẽ chán ngắt, lại còn lo không biết mình có nghe hiểu nổi không.",
                "vocab": [
                    ["退屈", "たいくつ", "buồn chán"],
                    ["不安", "ふあん", "bất an, lo lắng"]
                ]
            },
            {
                "jp": "ところが、落語を聞いている間、私はよく笑った。落語家の動作や声の出し方は本当に面白くて、場面の様子もよくわかった。しぐさや話し方を変えて、親と子供など二人以上を一人で演じ、会話を進める。座ったまま体を揺らして歩いている様子を見せ、家から店に移動したことを表す。食事の動作は、本当に何かを食べているようだった。",
                "vi": "Thế nhưng, suốt buổi nghe Rakugo, tôi đã cười rất nhiều. Cử chỉ và cách phát âm của nghệ sĩ thực sự sinh động, khiến tôi hình dung rất rõ khung cảnh. Chỉ bằng cách đổi điệu bộ và giọng nói, một mình nghệ sĩ đóng cùng lúc cha và con. Vẫn ngồi nguyên một chỗ mà khẽ lắc người thể hiện đang đi bộ từ nhà ra tiệm. Động tác ăn uống giống hệt như đang ăn thật.",
                "vocab": [
                    ["動作", "どうさ", "động tác"],
                    ["場面", "ばめん", "khung cảnh"],
                    ["会話", "かいわ", "hội thoại"],
                    ["移動", "いどう", "di chuyển"]
                ]
            },
            {
                "jp": "文化体験が終わったとき、落語の印象がすっかり変わっていた。落語とは、落語家の動作と語りを同時に楽しむものなのだ。私は、話の細部は理解できていなかったかもしれない。しかし、落語家の動作と語りを通して、登場人物の性格や暮らしが感じられた。それに、映像や音楽や踊りがなくても、生き生きと話を伝え、人を笑わせられる落語家の表現力にも感動した。",
                "vi": "Khi buổi trải nghiệm kết thúc, ấn tượng của tôi về Rakugo đã thay đổi hoàn toàn. Rakugo là thứ để thưởng thức đồng thời cả động tác lẫn lời kể của nghệ sĩ. Có thể tôi chưa hiểu hết từng chi tiết nhỏ của câu chuyện, nhưng qua động tác và giọng kể, tôi cảm nhận được tính cách và đời sống của nhân vật. Và dù chẳng có video, âm nhạc hay vũ đạo, năng lực biểu đạt sống động đến mức làm người xem bật cười của nghệ sĩ thật khiến tôi xúc động.",
                "vocab": [
                    ["印象", "いんしょう", "ấn tượng"],
                    ["性格", "せいかく", "tính cách"],
                    ["映像", "えいぞう", "hình ảnh video"],
                    ["表現力", "ひょうげんりょく", "năng lực biểu đạt"]
                ]
            }
        ],
        "questions": [
            {
                "q": "筆者は体験の前、どうして落語にがっかりしたのか。",
                "options": [
                    "授業で読んだときあまり面白いと思えず、退屈だろうと思ったから",
                    "着物を着て正座しなければならないと思ったから",
                    "自分の国にも同じような演劇があって見慣れていたから",
                    "映像や音楽が派手すぎて疲れると思ったから"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 48 đề N2 T12-2021: 「以前、ある落語を授業で読んだが、あまり面白いと思えなかったからだ。」"
            },
            {
                "q": "落語を体験した後、筆者が最も感動したことは何か。",
                "options": [
                    "話の細部まで日本語で完全に聞き取れたこと",
                    "映像や音楽がなくても、動作と語りだけで生き生きと伝えられる表現力",
                    "落語家が舞台の上を自由に歩き回って演じたこと",
                    "観客全員で一緒に会話に参加できたこと"
                ],
                "answer": 1,
                "explanation": "Đoạn 4 viết rõ: không cần video/âm nhạc/vũ đạo vẫn truyền tải sống động qua biểu đạt và động tác."
            }
        ]
    },
    {
        "id": "n2-05",
        "level": 2,
        "title": "Đánh giá công bằng và sinh khí của tổ chức",
        "source": "Đề thi thật JLPT N2 T12/2021 · 問題10 (5) (Câu 56)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "人材の評価や選抜の方式は、社会の根本的な活力を規定する最も重要なファクター（要素）である。しかもその人材の育成には時間がかかる。",
                "vi": "Phương thức đánh giá và tuyển chọn nhân tài là nhân tố quan trọng nhất quyết định sức sống căn bản của xã hội. Hơn nữa việc đào tạo nhân tài lại đòi hỏi nhiều thời gian.",
                "vocab": [
                    ["人材", "じんざい", "nhân tài"],
                    ["評価", "ひょうか", "đánh giá"],
                    ["根本", "こんぽん", "căn bản"],
                    ["活力", "かつりょく", "sức sống, sinh khí"],
                    ["育成", "いくせい", "đào tạo, nuôi dưỡng"]
                ]
            },
            {
                "jp": "競争のない社会、公正な評価が通らない組織は、長い目で見れば必ず衰退する。だからこそ、いつの時代でも、どの組織でも、優秀な人材の獲得に躍起になり、人材の育成に多大の努力を注ぐとともに、いかに公正な評価のシステムを組み込むのかという点に強い関心を払ってきたのである。",
                "vi": "Một xã hội thiếu cạnh tranh, một tổ chức không thực thi được sự đánh giá công bằng thì xét về lâu dài chắc chắn sẽ suy tàn. Chính vì vậy, ở bất cứ thời đại nào, tổ chức nào cũng đều ráo riết tìm kiếm nhân tài xuất sắc, dồn nhiều tâm sức đào tạo và đặc biệt quan tâm tới việc làm sao xây dựng được một hệ thống đánh giá công bằng.",
                "vocab": [
                    ["競争", "きょうそう", "cạnh tranh"],
                    ["公正", "こうせい", "công bằng"],
                    ["衰退", "すいたい", "suy tàn"],
                    ["優秀", "ゆうしゅう", "ưu tú, xuất sắc"],
                    ["努力", "どりょく", "nỗ lực"]
                ]
            }
        ],
        "questions": [
            {
                "q": "筆者は、人材が公正に評価されないと組織はどうなると述べているか。",
                "options": [
                    "短期間で人材を育てられなくなる。",
                    "優秀な人材を獲得できなくなる。",
                    "組織の活力を維持できなくなる。",
                    "組織への関心が薄くなる。"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 56 đề N2 T12-2021: Đánh giá nhân tài quyết định sức sống (活力), thiếu đánh giá công bằng thì về dài hạn tổ chức tất yếu suy yếu (衰退する)."
            }
        ]
    },

    # ==================== JLPT N1 (5 bài từ Đề thật N1 7-2023 & N1 7-2019) ====================
    {
        "id": "n1-01",
        "level": 1,
        "title": "FOMO và nỗi bất an trong xã hội quá tải thông tin",
        "source": "Đề thi thật JLPT N1 T7/2023 · 問題8 (1) (Câu 45)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "情報社会、あるいは情報化社会と言ってもいいですが、そこで懸命に生きていこうとすると、まず出てくる悲鳴があります。つまり、あまりにも多くの情報があって、その中のどれが本当なのか、何を選んだらいいかわからない。",
                "vi": "Trong xã hội thông tin — hay có thể gọi là xã hội tin học hóa — khi con người cố gắng sống hết mình ở đó, tiếng kêu than đầu tiên vang lên là: có quá nhiều thông tin tràn ngập đến mức không biết đâu là sự thật, và nên chọn thứ gì.",
                "vocab": [
                    ["情報社会", "じょうほうしゃかい", "xã hội thông tin"],
                    ["懸命", "けんめい", "hết sức, miệt mài"],
                    ["悲鳴", "ひめい", "tiếng kêu than"]
                ]
            },
            {
                "jp": "今、流行っているものの情報に熱心であればあるほど、世間で流行っていることを知らないと自分が遅れるんじゃないか、という焦りみたいなものが人間を突き動かすのが情報化社会の特徴です。",
                "vi": "Đặc trưng của xã hội tin học hóa là: người ta càng say mê săn đón thông tin về những thứ đang thịnh hành, thì càng bị thôi thúc bởi một nỗi sốt ruột mơ hồ rằng nếu không biết điều thiên hạ đang bàn tán thì bản thân mình sẽ bị tụt hậu mất.",
                "vocab": [
                    ["流行", "りゅうこう", "thịnh hành, xu hướng"],
                    ["熱心", "ねっしん", "nhiệt tâm, say sưa"],
                    ["世間", "せけん", "thiên hạ, xã hội"],
                    ["焦り", "あせり", "sự sốt ruột, nôn nóng"],
                    ["特徴", "とくちょう", "đặc trưng"]
                ]
            }
        ],
        "questions": [
            {
                "q": "筆者の考えに合うのはどれか。",
                "options": [
                    "情報を求める人ほど、知らない情報があることに不安を感じる。",
                    "情報を得ることに熱心な人は、世間で流行っていることしか知らない。",
                    "多くの情報から必要なものが選べなければ、世間から遅れてしまう。",
                    "流行っているものの情報に熱心なだけでは、情報化社会で生きられない。"
                ],
                "answer": 0,
                "explanation": "Đáp án câu 45 đề N1 T7-2023: Càng chạy theo thông tin (熱心であればあるほど) càng nảy sinh nỗi lo tụt hậu nếu bỏ lỡ xu hướng."
            }
        ]
    },
    {
        "id": "n1-02",
        "level": 1,
        "title": "'Viết ra' là cách quan sát và phản biện chính mình",
        "source": "Đề thi thật JLPT N1 T7/2023 · 問題8 (2) (Câu 46)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "「思ったこと」や「考えたこと」という抽象的な存在が文字という具体的な存在に変化した瞬間、その筆者は自分自身の「思ったこと」や「考えたこと」を、直接、自分の目で「見た」ことになる。つまり、客観的に「観察」することになるわけだ。",
                "vi": "Khoảnh khắc những thứ trừu tượng như 'điều mình cảm nhận' hay 'điều mình suy nghĩ' biến thành thực thể cụ thể là con chữ, người viết đã dùng chính đôi mắt của mình để trực tiếp 'nhìn thấy' suy nghĩ của bản thân. Tức là chuyển sang trạng thái 'quan sát' một cách khách quan.",
                "vocab": [
                    ["抽象的", "ちゅうしょうてき", "trừu tượng"],
                    ["具体的", "ぐたいてき", "cụ thể"],
                    ["客観的", "きゃっかんてき", "khách quan"],
                    ["観察", "かんさつ", "quan sát"]
                ]
            },
            {
                "jp": "「書くこと」は「読むこと」。自分の文章を読みながら書き進めるのが、「書く」という作業なのである。観察はほとんど必然的に「批判」のこころを呼び起こす。「思ったこと」や「考えたこと」の浅さや甘さを、書いた瞬間に思い知らされるのである。",
                "vi": "'Viết' chính là 'đọc'. Quá trình vừa viết tiếp vừa đọc lại câu văn của mình chính là thao tác viết. Và sự quan sát gần như tất yếu sẽ đánh thức tinh thần 'phê phán'. Chính vào khoảnh khắc viết ra, ta mới thấm thía hết sự nông cạn và ngây ngô trong những điều mình từng nghĩ.",
                "vocab": [
                    ["作業", "さぎょう", "thao tác"],
                    ["必然的", "ひつぜんてき", "tất yếu"],
                    ["批判", "ひはん", "phê phán, phản biện"],
                    ["瞬間", "しゅんかん", "khoảnh khắc"]
                ]
            }
        ],
        "questions": [
            {
                "q": "筆者によると、「書くこと」によってどうなるか。",
                "options": [
                    "自身の新しい考え方に気づく。",
                    "自身の意見を具体的に伝えられる。",
                    "自身の意見を批判的に見ることができる。",
                    "自身のこころの変化を観察することができる。"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 46 đề N1 T7-2023: Viết ra giúp quan sát khách quan suy nghĩ của mình và tất yếu khơi dậy cái nhìn phản biện (批判のこころ)."
            }
        ]
    },
    {
        "id": "n1-03",
        "level": 1,
        "title": "Học vấn thực sự bắt đầu từ việc 'dám nghi ngờ điều hiển nhiên'",
        "source": "Đề thi thật JLPT N1 T7/2023 · 問題9 (1) (Câu 49–50)",
        "category": "Trường văn",
        "paragraphs": [
            {
                "jp": "「常識を疑ってみる」ということ、実はそれが学問の始まりでもあります。勉強が「強いて勉める」という受動的な側面を持つものであるならば、学問は「問うて学ぶ」ことであり、極めて能動的な行為です。",
                "vi": "'Thử nghi ngờ những điều được coi là thường thức' — thực ra đó chính là khởi điểm của học vấn. Nếu việc học tập ('benkyou' - cưỡng ép nỗ lực) mang khía cạnh thụ động, thì học vấn ('gakumon' - hỏi để học) lại là một hành vi cực kỳ chủ động.",
                "vocab": [
                    ["常識", "じょうしき", "thường thức, lẽ thường"],
                    ["学問", "がくもん", "học vấn"],
                    ["受動的", "じゅどうてき", "thụ động"],
                    ["能動的", "のうどうてき", "chủ động"]
                ]
            },
            {
                "jp": "自ら主体的な行為として問うことを通して、常識とされてきたものの見方を疑い、それを少しずらすなどして、別の見方を見出そうとしていきます。学問の「正解」はひとつとは限りません。学ぶこととは、単純に知識を増やすということではなく、ましてやテストで覚えたことを吐き出すことでもなく、それを自分のものとして再編成していくことであり、さらに言えば自分の物差しが変わり、自分自身が変わっていくことなのです。",
                "vi": "Thông qua hành động tự mình chủ động đặt câu hỏi, ta nghi ngờ cách nhìn vốn được mặc định là lẽ thường, khẽ dịch chuyển góc nhìn để tìm ra một lối nhìn khác. 'Đáp án đúng' trong học vấn không nhất thiết chỉ có một. Học không đơn thuần là nhồi nhét thêm kiến thức, lại càng không phải là nôn ra những gì học vẹt khi đi thi, mà là tái cấu trúc nó thành của riêng mình — nói sâu hơn, là để thước đo của bản thân thay đổi, và chính con người mình biến chuyển theo.",
                "vocab": [
                    ["主体的", "しゅたいてき", "chủ thể, tự chủ"],
                    ["正解", "せいかい", "đáp án đúng"],
                    ["再編成", "さいへんせい", "tái tổ chức, sắp xếp lại"],
                    ["独創的", "どくそうてき", "độc đáo, sáng tạo"]
                ]
            },
            {
                "jp": "「疑う」という言葉は、通常は否定的な意味で使われます。「人を疑う」と言えば、普通はその人を信用しないというのと同義なわけです。私も、人を疑って生きるよりも、できるだけ人を信じて生きていたいと思っています。しかし、世の中で当たり前とされている事柄を「疑う」ことが必要な時もあります。「常識だから」という一言で目を閉ざし、それに安易に取り込まれてしまうことなく、そこを少しずらしたところに面白いことを見出していくために。それは、何事も信用しないというような厭世的な生き方に繋がるのではなく、むしろ創造的で豊かな世界を紡ぎだしていくための、積極的な営みなのです。",
                "vi": "Từ 'nghi ngờ' thường được dùng theo nghĩa tiêu cực. Nói 'nghi ngờ ai đó' đồng nghĩa với không tin tưởng họ. Bản thân tôi cũng muốn sống tin người hơn là sống nghi kỵ. Thế nhưng, cũng có lúc cần thiết phải 'nghi ngờ' những điều được xem là đương nhiên trong xã hội. Để không nhắm mắt buông xuôi trước một câu 'vì đó là lẽ thường' rồi bị cuốn theo dễ dãi, mà biết dịch góc nhìn đi một chút để khám phá điều thú vị. Điều đó không dẫn tới lối sống yếm thế chẳng tin thứ gì, mà trái lại, là một hoạt động tích cực để dệt nên thế giới sáng tạo và phong phú.",
                "vocab": [
                    ["信用", "しんよう", "tin tưởng"],
                    ["安易", "あんい", "dễ dãi, hời hợt"],
                    ["創造的", "そうぞうてき", "có tính sáng tạo"],
                    ["積極的", "せっきょくてき", "tích cực"]
                ]
            }
        ],
        "questions": [
            {
                "q": "筆者によると、学問とはどのような行為か。",
                "options": [
                    "「正解」を求めて、自ら主体的に問い続けていく行為である。",
                    "独創的なアイデアを生み出すために、自らのものの見方を変える行為だ。",
                    "自ら問いながら、ものの見方を模索し自分自身が変わっていく行為だ。",
                    "新しい知識を積極的に取り入れることで、自分自身を変えていく行為だ。"
                ],
                "answer": 2,
                "explanation": "Đáp án câu 49 đề N1 T7-2023: Không chỉ tìm một đáp án, mà tự đặt câu hỏi, tìm tòi góc nhìn mới và làm thay đổi chính bản thân mình."
            },
            {
                "q": "学問で「疑う」ことについて、筆者の考えに合うのはどれか。",
                "options": [
                    "何を信じればいいのかを理解するのに欠かせない行為だ。",
                    "豊かに生きるために、新しい常識を作りだす積極的な行為だ。",
                    "常識に安易に取り込まれないために必要だが、否定的な行為だ。",
                    "常識に縛られずに、これまでと異なる考え方を生み出す行為だ。"
                ],
                "answer": 3,
                "explanation": "Đáp án câu 50 đề N1 T7-2023: Không bị trói buộc bởi lẽ thường để mở ra cách nghĩ khác biệt sáng tạo."
            }
        ]
    },
    {
        "id": "n1-04",
        "level": 1,
        "title": "Đối thoại thực sự — Bắt đầu từ nỗi bối rối 'không hiểu nhau'",
        "source": "Đề thi thật JLPT N1 T7/2023 · 問題8 (4) (Câu 48)",
        "category": "Đoản văn",
        "paragraphs": [
            {
                "jp": "語り合えば語り合うほど他人と自分との違いがより繊細にわかるようになること。それが対話だ。「わかりあえない」「伝わらない」という戸惑いや痛みから出発すること。それは、不可欠なものに心を開くことである。",
                "vi": "Càng trò chuyện sâu với nhau lại càng nhận ra một cách tinh tế sự khác biệt giữa người khác và bản thân mình — đó chính là đối thoại. Khởi đầu từ sự lúng túng và nỗi đau 'không thể hiểu nhau', 'không truyền đạt tới nhau' chính là mở lòng ra đón nhận điều thiết yếu.",
                "vocab": [
                    ["繊細", "せんさい", "tinh tế, nhạy bén"],
                    ["対話", "たいわ", "đối thoại"],
                    ["戸惑い", "とまどい", "sự lúng túng, bỡ ngỡ"],
                    ["不可欠", "ふかけつ", "không thể thiếu"]
                ]
            },
            {
                "jp": "そのことで、ひとはより熱い対話をすることができるようになる。対話のなかでみずからの思考をも鍛えていく。よくよく考えたうえで口にされる他人の異なる思いや考えに、これまたよく耳を澄ますことで、じぶんの考えを再点検しはじめるからだ。",
                "vi": "Nhờ vậy, con người mới có thể bước vào những cuộc đối thoại nồng nhiệt hơn, và rèn giũa cả tư duy của chính mình ngay trong đối thoại. Bởi khi lắng tai nghe thật kỹ những suy nghĩ khác biệt mà người kia đã cân nhắc kỹ lưỡng mới nói ra, ta bắt đầu tự kiểm định lại tư duy của chính mình.",
                "vocab": [
                    ["思考", "しこう", "tư duy, suy nghĩ"],
                    ["鍛えて", "きたえて", "rèn giũa, tôi luyện"],
                    ["点検", "てんけん", "kiểm định, rà soát lại"]
                ]
            }
        ],
        "questions": [
            {
                "q": "対話について、筆者はどのように述べているか。",
                "options": [
                    "他人とじぶんの違いが大きいほど、熱い対話ができる。",
                    "他人との思考の違いを把握することで、自身の思考が深められる。",
                    "わかりあえないという戸惑いや痛みが克服でき、他人と共感できる。",
                    "思いや考えを表現する能力が鍛えられ、他人に理解してもらいやすくなる。"
                ],
                "answer": 1,
                "explanation": "Đáp án câu 48 đề N1 T7-2023: Lắng nghe sự khác biệt trong tư duy người khác khiến mình tự kiểm tra lại và rèn sâu tư duy bản thân."
            }
        ]
    },
    {
        "id": "n1-05",
        "level": 1,
        "title": "Nghịch lý của tự do: Khi mọi lựa chọn đều mở nhưng không biết mình muốn gì",
        "source": "Đề thi thật JLPT N1 T7/2019 · 問題8 (3) (Câu 56–57)",
        "category": "Trung văn",
        "paragraphs": [
            {
                "jp": "近代的な社会革命は、ひとがたまたまどのような社会の場所に生まれ落ちたかという偶然によってそのひとの人生のほとんどが決まってしまうような生き方というものを否定し、家柄とか階層とか性とか民族とかの出自によって差別されない社会を構築することをめざしてきた。言ってみれば、出自をめぐる偶然的条件を度外視して、みなが社会の同じスタートラインにつく、そして学校という場所で、生きるのに最低限必要な基礎的な知識と技能とを学ぶ、そのうえで、その後この社会において個人として何をなしとげるかでそのひとの価値と人生のかたちが決まってくるという、そういう社会をめざした。",
                "vi": "Các cuộc cách mạng xã hội hiện đại đã phủ nhận lối sống mà gần như cả cuộc đời một con người bị an bài bởi sự ngẫu nhiên sinh ra ở tầng lớp nào, để hướng tới xây dựng một xã hội không phân biệt đối xử theo gia thế, giai tầng, giới tính hay dân tộc. Nói cách khác, đó là một xã hội gạt bỏ điều kiện xuất thân ngẫu nhiên để mọi người cùng đứng ở chung vạch xuất phát, học những kiến thức kỹ năng tối thiểu ở trường học, rồi giá trị và hình hài cuộc đời mỗi người được quyết định bởi những gì họ tự làm nên với tư cách cá nhân.",
                "vocab": [
                    ["近代的", "きんだいてき", "hiện đại"],
                    ["革命", "かくめい", "cách mạng"],
                    ["偶然", "ぐうぜん", "ngẫu nhiên"],
                    ["差別", "さべつ", "phân biệt đối xử"],
                    ["技能", "ぎのう", "kỹ năng"]
                ]
            },
            {
                "jp": "理念として言えば、出自の偶然な条件に左右されることなく、ひとは何にでもなれる、そういう自由な世界をめざしたのである。そういうなかで、子どもの愛護、婦人の政治参加、もろもろの差別の撤廃などの政策に取り組んできた。",
                "vi": "Xét về lý tưởng, người ta hướng tới một thế giới tự do nơi con người không bị điều kiện xuất thân ngẫu nhiên chi phối và có thể trở thành bất cứ ai. Trong dòng chảy đó, nhân loại đã thúc đẩy bảo vệ trẻ em, quyền tham gia chính trị của phụ nữ, và xóa bỏ đủ loại phân biệt đối xử.",
                "vocab": [
                    ["理念", "りねん", "lý niệm, lý tưởng"],
                    ["自由", "じゆう", "tự do"],
                    ["撤廃", "てっぱい", "bãi bỏ, xóa bỏ"],
                    ["政策", "せいさく", "chính sách"]
                ]
            },
            {
                "jp": "けれども、何にでもなれるということは、あらかじめ何も決まっていないということ、決定的なものはないということである。裏を返して言えば、何にでもなれるというのは、自分がしたいことが見えないかぎり、何にもなれないということでもある。そのような意味で、自分がここにいることに理由が必要になった時代、自分が存在することの意味を自分で見いださなければならない時代にわたしたちは生きている。ひとびとが自分が「やりたい」ことをみずからに問わざるをえないのも、そうした時代のなかにあるからである。",
                "vi": "Thế nhưng, việc 'có thể trở thành bất cứ thứ gì' cũng có nghĩa là chẳng có gì được định sẵn từ trước, chẳng có điều gì mang tính quyết định. Nói ngược lại, 'có thể trở thành mọi thứ' đồng nghĩa với việc nếu không nhìn ra điều mình thực sự muốn làm, bạn sẽ chẳng trở thành cái gì cả. Theo nghĩa đó, chúng ta đang sống trong một thời đại mà việc mình hiện diện ở đây đòi hỏi một lý do, thời đại phải tự mình tìm ra ý nghĩa cho sự tồn tại của chính mình. Việc người ta buộc phải tự chất vấn xem mình thực sự 'muốn làm' điều gì cũng là vì ta đang sống giữa thời đại ấy.",
                "vocab": [
                    ["決定的", "けっていてき", "mang tính quyết định"],
                    ["存在", "そんざい", "sự tồn tại"],
                    ["意味", "いみ", "ý nghĩa"]
                ]
            }
        ],
        "questions": [
            {
                "q": "近代的な社会革命はどのような社会をめざしたか。",
                "options": [
                    "個人の出自の違いが存在しない社会",
                    "受けた教育によって人生が決まる社会",
                    "誰でも平等な生活が送れる社会",
                    "誰にでも可能性が平等に与えられる社会"
                ],
                "answer": 3,
                "explanation": "Đoạn 1–2 nhấn mạnh mọi người cùng đứng ở vạch xuất phát bình đẳng (同じスタートライン) và không bị xuất thân giới hạn khả năng phát triển."
            },
            {
                "q": "自分が「やりたい」ことをみずからに問わざるをえないのは、なぜか。",
                "options": [
                    "ひとに決められたことの中には自分の「やりたい」ことがないから",
                    "自分が「やりたい」ことでなければ、実現しても意味がないから",
                    "自分の存在価値は自分で探さなければ見つけられないから",
                    "生まれながらに決まっている道がないからこそ、自分で目標を定める必要があるから"
                ],
                "answer": 3,
                "explanation": "Đoạn 3: Khi không còn con đường an bài sẵn (あらかじめ何も決まっていない), nếu không tự tìm ra điều mình muốn thì không thể trở thành gì cả."
            }
        ]
    }
]


def detect_level(folder_path, filename):
    """Detect JLPT level 1..5 from filename first, then folder path."""
    target = filename + ' ' + folder_path
    # Check filename explicitly first (important inside de_thi_N4_N5 where N4 & N5 share parent folders)
    fn_upper = filename.upper()
    for lvl in (5, 4, 3, 2, 1):
        if re.search(rf'(?:^|[^0-9A-Z])N{lvl}(?:[^0-9]|$)', fn_upper):
            return lvl
    path_upper = folder_path.upper()
    for lvl in (5, 4, 3, 2, 1):
        if re.search(rf'(?:^|[^0-9A-Z])N{lvl}(?:[^0-9]|$)', path_upper):
            return lvl
    return None


def detect_period(folder_path, filename):
    """Extract (year, month, label) from folder or file name for chronological sorting."""
    text = filename + ' ' + folder_path
    # Match patterns like "7-2024", "12-2021", "07.2025", "12.2025", "2012年12月", "2023年7月"
    m = re.search(r'(\d{1,2})\s*[-./]\s*(20\d{2}|19\d{2})', text)
    if m:
        mo, yr = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            return yr, mo, f'T{mo}/{yr}'
    m2 = re.search(r'(20\d{2}|19\d{2})\s*[年\-./]\s*(\d{1,2})', text)
    if m2:
        yr, mo = int(m2.group(1)), int(m2.group(2))
        if 1 <= mo <= 12:
            return yr, mo, f'T{mo}/{yr}'
    # Year range or single year like "2010-2011" or "2018" or "1995~2009"
    m_range = re.search(r'(20\d{2}|19\d{2})\s*[-~～]\s*(20\d{2})', text)
    if m_range:
        yr = int(m_range.group(2))
        return yr, 0, f'{m_range.group(1)}–{m_range.group(2)}'
    m_yr = re.search(r'(20\d{2}|19\d{2})', text)
    if m_yr:
        yr = int(m_yr.group(1))
        return yr, 0, f'Năm {yr}'
    return 0, 0, 'Tổng hợp'


def classify_file(filename):
    lower = filename.lower()
    ext = os.path.splitext(lower)[1]
    if ext in ('.mp3', '.m4a', '.wav', '.ogg'):
        return 'audio'
    if ext == '.txt':
        return 'note'
    if 'script' in lower or 'scrip' in lower or '原文' in filename:
        return 'script'
    if 'đáp án' in lower or 'dap an' in lower or 'đáp án' in lower or '答案' in filename:
        return 'answer'
    if ext in ('.pdf', '.jpg', '.jpeg', '.jpge', '.png'):
        return 'exam'
    return 'other'


def build_exam_catalog():
    buckets = {}

    for dp, _, filenames in os.walk(DE_THI_DIR):
        if not filenames:
            continue
        rel_dir = os.path.relpath(dp, DE_THI_DIR)
        for fname in sorted(filenames):
            ftype = classify_file(fname)
            if ftype == 'other':
                continue
            lvl = detect_level(rel_dir, fname)
            if lvl is None:
                continue
            yr, mo, period_label = detect_period(rel_dir, fname)
            is_collection = (mo == 0 and ('tổng hợp' in fname.lower() or 'sưu tầm' in fname.lower() or 'bản nhẹ' in fname.lower() or '~' in fname))

            # Separate collection PDFs cleanly vs per-session folders
            key = (lvl, yr, mo, 'collection' if is_collection else period_label)
            if key not in buckets:
                buckets[key] = {
                    'id': f'n{lvl}-{yr}-{mo:02d}' + ('-col' if is_collection else ''),
                    'level': lvl,
                    'year': yr,
                    'month': mo,
                    'title': f'JLPT N{lvl} · {fname.rsplit(".", 1)[0]}' if is_collection else f'JLPT N{lvl} · {period_label}',
                    'period': period_label,
                    'examPdfs': [],
                    'scriptPdfs': [],
                    'answerFiles': [],
                    'audioFiles': [],
                }

            rel_url = 'de_thi/' + os.path.relpath(os.path.join(dp, fname), DE_THI_DIR).replace('\\', '/')
            size_mb = round(os.path.getsize(os.path.join(dp, fname)) / (1024 * 1024), 1)
            item = {'name': fname, 'url': rel_url, 'sizeMb': size_mb}

            if ftype == 'exam':
                buckets[key]['examPdfs'].append(item)
            elif ftype == 'script':
                buckets[key]['scriptPdfs'].append(item)
                # Combined answer + script files should also be noted in answerFiles if marked
                if 'đáp án' in fname.lower() or 'dap an' in fname.lower():
                    buckets[key]['answerFiles'].append(item)
            elif ftype == 'answer':
                buckets[key]['answerFiles'].append(item)
            elif ftype == 'audio':
                buckets[key]['audioFiles'].append(item)

    catalog = list(buckets.values())
    # Sort newest year/month first within each level, then level N5 -> N1
    catalog.sort(key=lambda x: (-x['level'], -x['year'], -x['month'], x['title']))
    return catalog


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    readings_path = os.path.join(DATA_DIR, 'readings.json')
    with open(readings_path, 'w', encoding='utf-8') as f:
        json.dump(READINGS, f, ensure_ascii=False, indent=2)
    by_lvl = collections.Counter(r['level'] for r in READINGS)
    print(f'Wrote {readings_path}: {len(READINGS)} readings {dict(sorted(by_lvl.items()))} ({os.path.getsize(readings_path)/1024:.1f} KB)')

    if os.path.isdir(DE_THI_DIR):
        catalog = build_exam_catalog()
    else:
        catalog = []

    catalog_path = os.path.join(DATA_DIR, 'exam-catalog.json')
    with open(catalog_path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(',', ':'))
    cat_lvl = collections.Counter(c['level'] for c in catalog)
    print(f'Wrote {catalog_path}: {len(catalog)} exam sessions {dict(sorted(cat_lvl.items()))} ({os.path.getsize(catalog_path)/1024:.1f} KB)')


if __name__ == '__main__':
    main()
