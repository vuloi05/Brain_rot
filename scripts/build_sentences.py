import collections
import json
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, 'data')

# 45 verified JLPT N5-N1 Sentence Forge & Dictation items extracted from de_thi/
SENTENCES = [
    # ==================== JLPT N5 (9 câu) ====================
    {
        "id": "s-n5-01",
        "level": 5,
        "source": "Đề JLPT N5 T12/2025 · 問題2 (10)",
        "prefix": "私は",
        "chunks": ["一週間に", "２回", "ギターの", "練習"],
        "starIdx": 2,
        "suffix": "をしています。",
        "fullJp": "私は一週間に２回ギターの練習をしています。",
        "kana": "わたしはいっしゅうかんににかいギターのれんしゅうをしています。",
        "vi": "Tôi tập đàn guitar 2 lần mỗi tuần.",
        "grammarNote": "Cụm tần suất: [Khoảng thời gian] + に + [Số lần] ([一週間に２回] = 2 lần trong 1 tuần), sau đó là danh từ bổ nghĩa [ギターの練習] làm tân ngữ cho をしています."
    },
    {
        "id": "s-n5-02",
        "level": 5,
        "source": "Đề JLPT N5 T12/2025 · 問題2 (11)",
        "prefix": "南中山駅と北中山駅",
        "chunks": ["と", "どちら", "が", "近い"],
        "starIdx": 1,
        "suffix": "ですか。",
        "fullJp": "南中山駅と北中山駅とどちらが近いですか。",
        "kana": "みなみなかやまえきときたなかやまえきとどちらがちかいですか。",
        "vi": "Giữa ga Minami-Nakayama và ga Kita-Nakayama, ga nào gần hơn?",
        "grammarNote": "Mẫu so sánh 2 đối tượng: [A と B と どちらが + Tính từ ですか] (giữa A và B cái nào ... hơn)."
    },
    {
        "id": "s-n5-03",
        "level": 5,
        "source": "Đề JLPT N5 T12/2025 · 問題2 (12)",
        "prefix": "今日の昼ご飯は",
        "chunks": ["ピザ", "が", "おいしい", "レストラン"],
        "starIdx": 2,
        "suffix": "で食べました。",
        "fullJp": "今日の昼ご飯はピザがおいしいレストランで食べました。",
        "kana": "きょうのひるごはんはピザがおいしいレストランでたべました。",
        "vi": "Bữa trưa hôm nay tôi đã ăn ở nhà hàng có món pizza ngon.",
        "grammarNote": "Mệnh đề định ngữ bổ nghĩa danh từ: [ピザがおいしい] (pizza ngon) đứng ngay trước danh từ [レストラン] (nhà hàng), rồi dùng trợ từ で chỉ địa điểm diễn ra hành động ăn."
    },
    {
        "id": "s-n5-04",
        "level": 5,
        "source": "Đề JLPT N5 T12/2025 · 問題2 (13)",
        "prefix": "私は毎朝八時に家",
        "chunks": ["を", "出て", "九時ごろ", "会社"],
        "starIdx": 1,
        "suffix": "に着きます。",
        "fullJp": "私は毎朝八時に家を出て九時ごろ会社に着きます。",
        "kana": "わたしはまいあさはちじにいえをでてくじごろかいしゃにつきます。",
        "vi": "Mỗi sáng tôi ra khỏi nhà lúc 8 giờ và đến công ty khoảng 9 giờ.",
        "grammarNote": "Chú ý cặp trợ từ động từ di chuyển: 出る đi với を (家を出る = rời khỏi nhà), còn 着く đi với に (会社に着く = đến công ty)."
    },
    {
        "id": "s-n5-05",
        "level": 5,
        "source": "Đề JLPT N5 T7/2025 · 問題2 (10)",
        "prefix": "祖父の家の庭",
        "chunks": ["に", "大きい", "桜の木", "が"],
        "starIdx": 2,
        "suffix": "あります。",
        "fullJp": "祖父の家の庭に大きい桜の木があります。",
        "kana": "そふのいえのにわにおおきいさくらのきがあります。",
        "vi": "Trong sân vườn nhà ông tôi có một cây hoa anh đào lớn.",
        "grammarNote": "Mẫu câu tồn tại: [Địa điểm に] + [Danh từ が] + あります。Tính từ い (大きい) bổ nghĩa trực tiếp cho danh từ 桜の木."
    },
    {
        "id": "s-n5-06",
        "level": 5,
        "source": "Đề JLPT N5 T7/2025 · 問題2 (11)",
        "prefix": "先週の土曜日、",
        "chunks": ["きのう", "の", "よる", "は"],
        "starIdx": 3,
        "suffix": "カレーを作りました。",
        "fullJp": "先週の土曜日、きのうのよるはカレーを作りました。",
        "kana": "せんしゅうのどようび、きのうのよるはカレーをつくりました。",
        "vi": "Tối hôm qua tôi đã nấu món cà ri.",
        "grammarNote": "Danh từ thời gian nối bằng の (きのうのよる = tối hôm qua), trợ từ は nhấn mạnh khung thời gian làm chủ đề câu."
    },
    {
        "id": "s-n5-07",
        "level": 5,
        "source": "Đề JLPT N5 T7/2025 · 問題2 (12)",
        "prefix": "弟は、",
        "chunks": ["私が", "あげた", "ぼうし", "を"],
        "starIdx": 2,
        "suffix": "いつもかぶっています。",
        "fullJp": "弟は、私があげたぼうしをいつもかぶっています。",
        "kana": "おとうとは、わたしがあげたぼうしをいつもかぶっています。",
        "vi": "Em trai tôi lúc nào cũng đội chiếc mũ mà tôi đã tặng.",
        "grammarNote": "Trong mệnh đề bổ nghĩa cho danh từ (ぼうし), chủ thể hành động dùng trợ từ が (私があげた = mà tôi đã tặng) thay cho は."
    },
    {
        "id": "s-n5-08",
        "level": 5,
        "source": "Đề JLPT N5 T7/2025 · 問題2 (13)",
        "prefix": "図書館に傘を忘れた",
        "chunks": ["から", "じゅぎょうの", "あとで", "とりに"],
        "starIdx": 1,
        "suffix": "行きます。",
        "fullJp": "図書館に傘を忘れたからじゅぎょうのあとでとりに行きます。",
        "kana": "としょかんにかさをわすれたからじゅぎょうのあとでとりにいきます。",
        "vi": "Vì tôi để quên ô ở thư viện nên sau giờ học tôi sẽ đi lấy.",
        "grammarNote": "Mệnh đề nguyên nhân kết thúc bằng から (vì đã quên ô), tiếp theo là thời điểm [じゅぎょうのあとで] và mục đích [とりに + 行きます] (đi để lấy)."
    },
    {
        "id": "s-n5-09",
        "level": 5,
        "source": "Đề JLPT N5 T12/2025 · 問題1 (8)",
        "prefix": "週末に",
        "chunks": ["友達の", "誕生日に", "あげる", "プレゼント"],
        "starIdx": 2,
        "suffix": "を買いました。",
        "fullJp": "週末に友達の誕生日にあげるプレゼントを買いました。",
        "kana": "しゅうまつにともだちのたんじょうびにあげるプレゼントをかいました。",
        "vi": "Cuối tuần tôi đã mua món quà để tặng vào sinh nhật của bạn.",
        "grammarNote": "Động từ thể từ điển [あげる] bổ nghĩa trực tiếp cho danh từ [プレゼント] (món quà sẽ tặng vào dịp sinh nhật bạn)."
    },

    # ==================== JLPT N4 (9 câu) ====================
    {
        "id": "s-n4-01",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題2 (14)",
        "prefix": "今日は、一年で",
        "chunks": ["夜", "が", "最も長い", "日"],
        "starIdx": 2,
        "suffix": "です。",
        "fullJp": "今日は、一年で夜が最も長い日です。",
        "kana": "きょうは、いちねんでよるがもっともながいひです。",
        "vi": "Hôm nay là ngày có đêm dài nhất trong năm.",
        "grammarNote": "Phạm vi so sánh nhất [一年で] + mệnh đề định ngữ [夜が最も長い] (đêm dài nhất) bổ nghĩa cho danh từ [日]."
    },
    {
        "id": "s-n4-02",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題2 (15)",
        "prefix": "私は、日本に",
        "chunks": ["いる", "間に", "いろいろな町へ", "行って"],
        "starIdx": 1,
        "suffix": "写真をたくさん撮りたいです。",
        "fullJp": "私は、日本にいる間にいろいろな町へ行って写真をたくさん撮りたいです。",
        "kana": "わたしは、にほんにいるあいだにいろいろなまちへいってしゃしんをたくさんとりたいです。",
        "vi": "Trong khoảng thời gian ở Nhật, tôi muốn đi đến nhiều thành phố khác nhau và chụp thật nhiều ảnh.",
        "grammarNote": "Cấu trúc [Vる + 間に] (trong khoảng thời gian đang ở Nhật) đứng trước chuỗi hành động nối bằng thể て (行って)."
    },
    {
        "id": "s-n4-03",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題2 (16)",
        "prefix": "",
        "chunks": ["母", "の", "話", "によると"],
        "starIdx": 2,
        "suffix": "、私は小さいとき、この絵本が大好きだったそうだ。",
        "fullJp": "母の話によると、私は小さいとき、この絵本が大好きだったそうだ。",
        "kana": "ははのはなしによると、わたしはちいさいとき、このえほんがだいすきだったそうだ。",
        "vi": "Theo lời kể của mẹ, hồi nhỏ tôi rất thích cuốn sách tranh này.",
        "grammarNote": "Cấu trúc truyền đạt nguồn tin: [Danh từ + によると ..., 〜そうだ] (Theo như ... thì nghe nói là ...)."
    },
    {
        "id": "s-n4-04",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題2 (17)",
        "prefix": "今日、木村さんは明るい青色のシャツを着て来た。",
        "chunks": ["私も", "木村さんが", "着ていた", "あんな色"],
        "starIdx": 2,
        "suffix": "のシャツがほしい。",
        "fullJp": "今日、木村さんは明るい青色のシャツを着て来た。私も木村さんが着ていたあんな色のシャツがほしい。",
        "kana": "きょう、きむらさんはあかるいあおいろのシャツをきてきた。わたしもきむらさんがきていたあんな色のシャツがほしい。",
        "vi": "Hôm nay Kimura mặc chiếc áo sơ mi xanh dương sáng. Tôi cũng muốn có một chiếc áo màu như thế mà Kimura đã mặc.",
        "grammarNote": "Mệnh đề [木村さんが着ていた] bổ nghĩa cho cụm [あんな色のシャツ] (chiếc áo màu như thế mà Kimura đang mặc)."
    },
    {
        "id": "s-n4-05",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題1 (9)",
        "prefix": "わたしは本当に虫が",
        "chunks": ["きらいで", "見る", "の", "も"],
        "starIdx": 2,
        "suffix": "いやです。",
        "fullJp": "わたしは本当に虫がきらいで見るのもいやです。",
        "kana": "わたしはほんとうにむしがきらいでみるのもいやです。",
        "vi": "Tôi thực sự rất ghét côn trùng, ngay cả việc nhìn thấy cũng thấy khó chịu.",
        "grammarNote": "Danh từ hóa động từ bằng の (見るの = việc nhìn) kết hợp với trợ từ も (ngay cả... cũng...)."
    },
    {
        "id": "s-n4-06",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題1 (11)",
        "prefix": "花が好きな祖母の",
        "chunks": ["へやには", "いつも", "いろいろな花が", "飾られて"],
        "starIdx": 3,
        "suffix": "います。",
        "fullJp": "花が好きな祖母のへやにはいつもいろいろな花が飾られています。",
        "kana": "はながすきなそぼのへやにはいつもいろいろなはながかざられています。",
        "vi": "Trong phòng của bà ngoại thích hoa, lúc nào cũng được trang trí đủ loại hoa.",
        "grammarNote": "Thể bị động tiếp diễn [〜が飾られています] diễn tả trạng thái kết quả (hoa được bày biện sẵn)."
    },
    {
        "id": "s-n4-07",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題1 (12)",
        "prefix": "今年は日本で",
        "chunks": ["アルバイト", "を", "するので", "帰らない"],
        "starIdx": 3,
        "suffix": "ことにしました。",
        "fullJp": "今年は日本でアルバイトをするので帰らないことにしました。",
        "kana": "ことしはにほんでアルバイトをするのでかえらないことにしました。",
        "vi": "Năm nay vì làm thêm ở Nhật nên tôi đã quyết định không về nước.",
        "grammarNote": "Mẫu quyết định cá nhân: [Vる / Vない + ことにする] (quyết định làm / không làm gì)."
    },
    {
        "id": "s-n4-08",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題1 (4)",
        "prefix": "１日に３回も",
        "chunks": ["食べる", "んですか。", "本当に", "大好き"],
        "starIdx": 1,
        "suffix": "なんですね。",
        "fullJp": "１日に３回も食べるんですか。本当に大好きなんですね。",
        "kana": "いちにちにさんかいもたべるんですか。ほんとうにだいすきなんですね。",
        "vi": "Một ngày ăn tận 3 lần cơ à? Đúng là thích lắm nhỉ.",
        "grammarNote": "Trợ từ も đi sau số lượng [３回も] nhấn mạnh mức độ nhiều ngoài dự kiến; đuôi んですか / なんですね dùng để xác nhận cảm xúc."
    },
    {
        "id": "s-n4-09",
        "level": 4,
        "source": "Đề JLPT N4 T7/2023 · 問題1 (10)",
        "prefix": "冷蔵庫から",
        "chunks": ["変な", "音が", "する。", "故障した"],
        "starIdx": 2,
        "suffix": "のかもしれない。",
        "fullJp": "冷蔵庫から変な音がする。故障したのかもしれない。",
        "kana": "れいぞうこからへんなおとがする。こしょうしたのかもしれない。",
        "vi": "Có tiếng động lạ phát ra từ tủ lạnh. Có lẽ nó bị hỏng rồi cũng nên.",
        "grammarNote": "Cấu trúc cảm nhận giác quan [音がする] (có tiếng...) + [〜のかもしれない] (có thể là...)."
    },

    # ==================== JLPT N3 (9 câu) ====================
    {
        "id": "s-n3-01",
        "level": 3,
        "source": "Đề JLPT N3 (Tổng hợp Điền sao #1)",
        "prefix": "コンサートは７時からですから、そんなに",
        "chunks": ["早く", "行っても", "まだ", "開いていない"],
        "starIdx": 2,
        "suffix": "と思いますよ。",
        "fullJp": "コンサートは７時からですから、そんなに早く行ってもまだ開いていないと思いますよ。",
        "kana": "コンサートはしちじからですから、そんなに早くいってもまだあいていないとおもいますよ。",
        "vi": "Buổi hòa nhạc từ 7 giờ mới bắt đầu nên dù có đi sớm như vậy thì tôi nghĩ vẫn chưa mở cửa đâu.",
        "grammarNote": "Thứ tự chuẩn (ADCB-C): Phó từ [そんなに早く] + [行っても] (dù có đi...) nối với [まだ開いていない] (vẫn chưa mở)."
    },
    {
        "id": "s-n3-02",
        "level": 3,
        "source": "Đề JLPT N3 (Tổng hợp Điền sao #2)",
        "prefix": "今、ほかの学生と話して",
        "chunks": ["いらっしゃいます", "から", "すこし", "待って"],
        "starIdx": 0,
        "suffix": "ください。",
        "fullJp": "今、ほかの学生と話していらっしゃいますからすこし待ってください。",
        "kana": "いま、ほかのがくせいとはなしていらっしゃいますからすこしまってください。",
        "vi": "Hiện tại thầy đang nói chuyện với sinh viên khác nên xin vui lòng đợi một chút.",
        "grammarNote": "Thứ tự chuẩn (DBAC-A): Kính ngữ đang diễn ra [〜ていらっしゃいます] + [から] (vì) → [すこし待ってください]."
    },
    {
        "id": "s-n3-03",
        "level": 3,
        "source": "Đề JLPT N3 (Tổng hợp Điền sao #3)",
        "prefix": "父も私も、今日はかさがなくても",
        "chunks": ["大丈夫", "だろう", "と思って", "出かけた"],
        "starIdx": 1,
        "suffix": "が、雨に降られてしまった。",
        "fullJp": "父も私も、今日はかさがなくても大丈夫だろうと思って出かけたが、雨に降られてしまった。",
        "kana": "ちちもわたしも、きょうはかさがなくてもだいじょうぶだろうとおもってでかけたが、あめにふられてしまった。",
        "vi": "Cả bố và tôi đều nghĩ hôm nay không mang ô chắc cũng ổn nên đi ra ngoài, ai ngờ bị dính mưa.",
        "grammarNote": "Thứ tự chuẩn (CABD-B): [大丈夫だろう] (chắc ổn thôi) + [と思って] (nghĩ vậy rồi) + [出かけたが] (ra ngoài nhưng...)."
    },
    {
        "id": "s-n3-04",
        "level": 3,
        "source": "Đề JLPT N3 (Tổng hợp Điền sao #4)",
        "prefix": "昨日動物園に行ったら、先月",
        "chunks": ["生まれた", "ばかりの", "ライオンの", "赤ちゃんを"],
        "starIdx": 1,
        "suffix": "見ることができました。",
        "fullJp": "昨日動物園に行ったら、先月生まれたばかりのライオンの赤ちゃんを見ることができました。",
        "kana": "きのうどうぶつえんにいったら、せんげつうまれたばかりのライオンのあかちゃんをみることができました。",
        "vi": "Hôm qua khi đi sở thú, tôi đã được nhìn thấy chú sư tử con vừa mới chào đời tháng trước.",
        "grammarNote": "Thứ tự chuẩn (ACBD-B): [Vた + ばかりの + N] (vừa mới... tháng trước) bổ nghĩa cho [ライオンの赤ちゃん]."
    },
    {
        "id": "s-n3-05",
        "level": 3,
        "source": "Đề JLPT N3 (Tổng hợp Điền sao #7)",
        "prefix": "あの美術館は曜日",
        "chunks": ["によって", "始まる時間", "が", "違うから"],
        "starIdx": 0,
        "suffix": "窓口で確認したほうがいいよ。",
        "fullJp": "あの美術館は曜日によって始まる時間が違うから窓口で確認したほうがいいよ。",
        "kana": "あのびじゅつかんはようびによってはじまるじかんがちがうからまどぐちでかくにんしたほうがいいよ。",
        "vi": "Bảo tàng mỹ thuật đó giờ mở cửa tùy thuộc vào từng ngày trong tuần sẽ khác nhau nên bạn kiểm tra ở quầy thì hơn.",
        "grammarNote": "Thứ tự chuẩn (CADB-D): [Danh từ + によって] (tùy theo...) + [始まる時間が違うから]."
    },
    {
        "id": "s-n3-06",
        "level": 3,
        "source": "Đề JLPT N3 (Tổng hợp Điền sao #13)",
        "prefix": "昨日のパーティーは、友だちと話していたら、ほとんど",
        "chunks": ["何も", "食べない", "うちに", "終わってしまった"],
        "starIdx": 0,
        "suffix": "、あとでおなかがすいてしまった。",
        "fullJp": "昨日のパーティーは、友だちと話していたら、ほとんど何も食べないうちに終わってしまった、あとでおなかがすいてしまった。",
        "kana": "きのうのパーティーは、ともだちとはなしていたら、ほとんどなにもたべないうちにおわってしまった、あとでおなかがすいてしまった。",
        "vi": "Bữa tiệc hôm qua cứ mải nói chuyện với bạn, thành ra còn chưa kịp ăn gì mấy thì đã kết thúc mất rồi, sau đó bị đói meo.",
        "grammarNote": "Thứ tự chuẩn (BDCA-C): [何も食べない + うちに] (trong lúc còn chưa kịp ăn gì thì...) diễn tả sự việc xảy ra trước khi hành động kia kịp diễn ra."
    },
    {
        "id": "s-n3-07",
        "level": 3,
        "source": "Đề JLPT N3 T12/2022 · 問題2 (15)",
        "prefix": "来週から１か月間、出張で東京に行く。東京には友達が",
        "chunks": ["いる", "ので", "東京にいる", "間に"],
        "starIdx": 2,
        "suffix": "一緒に食事でもしたいと思う。",
        "fullJp": "来週から１か月間、出張で東京に行く。東京には友達がいるので東京にいる間に一緒に食事でもしたいと思う。",
        "kana": "らいしゅうからいっかげつかん、しゅっちょうでとうきょうにいく。とうきょうにはともだちがいるのでとうきょうにいるあいだにいっしょにしょくじでもしたいとおもう。",
        "vi": "Từ tuần sau tôi đi công tác Tokyo 1 tháng. Vì có bạn ở Tokyo nên tôi định sẽ tranh thủ lúc ở Tokyo đi ăn bữa cơm cùng nhau.",
        "grammarNote": "Mệnh đề nguyên nhân [友達がいるので] nối với khoảng thời gian [東京にいる間に]."
    },
    {
        "id": "s-n3-08",
        "level": 3,
        "source": "Đề JLPT N3 T12/2022 · 問題2 (16)",
        "prefix": "バイオリンが弾ける",
        "chunks": ["ようになりたくて", "１年前に", "習い始めたのだが", "弾けば"],
        "starIdx": 2,
        "suffix": "弾くほどこんなに面白い楽器はないと感じる。",
        "fullJp": "バイオリンが弾けるようになりたくて１年前に習い始めたのだが弾けば弾くほどこんなに面白い楽器はないと感じる。",
        "kana": "バイオリンがひけるようになりたくていちねんまえにならいはじめたのだがひけばひくほどこんなにおもしろいがっきはないとかんじる。",
        "vi": "Vì muốn chơi được violin nên 1 năm trước tôi bắt đầu đi học, nhưng càng kéo đàn lại càng thấy chẳng có nhạc cụ nào thú vị đến thế.",
        "grammarNote": "Cấu trúc lặp động từ [Vば + Vほど] (càng ... càng ...) đặt cuối chuỗi sự việc."
    },
    {
        "id": "s-n3-09",
        "level": 3,
        "source": "Đề JLPT N3 T12/2022 · 問題2 (18)",
        "prefix": "都会と田舎には違うところも多いが、どちらも、人が働き、",
        "chunks": ["生活している", "という点で", "違いは", "ない"],
        "starIdx": 1,
        "suffix": "。",
        "fullJp": "都会と田舎には違うところも多いが、どちらも、人が働き、生活しているという点で違いはない。",
        "kana": "とかいといなかにはちがうところもおおいが、どちらも、ひとがはたらき、せいかつしているというてんでちがいはない。",
        "vi": "Thành thị và nông thôn có nhiều điểm khác nhau, nhưng ở khía cạnh con người làm việc và sinh sống thì cả hai không có gì khác biệt.",
        "grammarNote": "Mẫu chỉ phương diện đánh giá: [〜という点で] (ở điểm/khía cạnh là...)."
    },

    # ==================== JLPT N2 (9 câu) ====================
    {
        "id": "s-n2-01",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題8 (43)",
        "prefix": "もう酒は飲まないと",
        "chunks": ["決めた", "以上は", "どんなに", "勧誘されても"],
        "starIdx": 1,
        "suffix": "絶対に守りたい。",
        "fullJp": "もう酒は飲まないと決めた以上はどんなに勧誘されても絶対に守りたい。",
        "kana": "もうさけはのまないときめたいじょうはどんなにかんゆうされてもぜったいにまもりたい。",
        "vi": "Một khi đã quyết tâm không uống rượu nữa thì dù có bị rủ rê thế nào tôi cũng nhất định giữ lời.",
        "grammarNote": "Mẫu [Vた + 以上は] (một khi đã... thì đương nhiên phải...) kết hợp cặp [どんなに〜ても] (dù thế nào đi nữa cũng...)."
    },
    {
        "id": "s-n2-02",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題8 (44)",
        "prefix": "必要のない物でも、欲しくなると",
        "chunks": ["買わずには", "いられなく", "なって", "すぐ買って"],
        "starIdx": 2,
        "suffix": "しまう。",
        "fullJp": "必要のない物でも、欲しくなると買わずにはいられなくなってすぐ買ってしまう。",
        "kana": "ひつようのないものでも、ほしくなるとかわずにはいられなくなってすぐかってしまう。",
        "vi": "Dù là món đồ không cần thiết nhưng hễ thích lên là lại không nhịn được mà mua ngay lập tức.",
        "grammarNote": "Cấu trúc [Vない + ずにはいられない] (không thể kiềm chế nổi việc phải làm gì), chuyển tiếp sang trạng thái [〜なくなって]."
    },
    {
        "id": "s-n2-03",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題8 (45)",
        "prefix": "パソコンの電源を入れたのだが、画面に「お待ちください」という",
        "chunks": ["メッセージが出たまま", "何分", "待っても", "先に進まないので"],
        "starIdx": 2,
        "suffix": "電源を入れ直した。",
        "fullJp": "パソコンの電源を入れたのだが、画面に「お待ちください」というメッセージが出たまま何分待っても先に進まないので電源を入れ直した。",
        "kana": "パソコンのでんげんをいれたのだが、がめんに「おまちください」というメッセージがでたままなんぷんまってもさきにすすまないのででんげんをいれなおした。",
        "vi": "Tôi bật nguồn máy tính nhưng màn hình cứ giữ nguyên dòng chữ 'Vui lòng chờ', đợi bao nhiêu phút cũng không chạy tiếp nên tôi đã khởi động lại.",
        "grammarNote": "[Vた + まま] diễn tả trạng thái giữ nguyên không đổi (thông báo cứ hiện mãi như vậy)."
    },
    {
        "id": "s-n2-04",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題8 (46)",
        "prefix": "すみません、来週の２時からの会議ですが、もしそちらのご都合が",
        "chunks": ["よろしければ", "四時以降に", "変更していただけると", "ありがたいんですが"],
        "starIdx": 2,
        "suffix": "、いかがでしょうか。",
        "fullJp": "すみません、来週の２時からの会議ですが、もしそちらのご都合がよろしければ四時以降に変更していただけるとありがたいんですが、いかがでしょうか。",
        "kana": "すみません、らいしゅうのにじからのかいぎですが、もしそちらのごつごうがよろしければよじいこうにへんこうしていただけるとありがたいんですが、いかがでしょうか。",
        "vi": "Xin lỗi về cuộc họp lúc 2 giờ tuần tới, nếu bên anh/chị thuận tiện thì đổi sang sau 4 giờ giúp tôi được không ạ?",
        "grammarNote": "Kính ngữ thương mại kinh điển: [ご都合がよろしければ] + [〜ていただけるとありがたいんですが] (nếu được giúp đỡ thì tôi rất biết ơn)."
    },
    {
        "id": "s-n2-05",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題8 (47)",
        "prefix": "２０年前に初めてこの歌手の歌を聴いたとき、",
        "chunks": ["なんて美しい声なんだろう", "と思った", "のを", "よく覚えている"],
        "starIdx": 3,
        "suffix": "。",
        "fullJp": "２０年前に初めてこの歌手の歌を聴いたとき、なんて美しい声なんだろうと思ったのをよく覚えている。",
        "kana": "にじゅうねんまえにはじめてこのかしゅのうたをきいたとき、なんてうつくしいこえなんだろうとおもったのをよくおぼえている。",
        "vi": "Khi lần đầu nghe ca sĩ này hát cách đây 20 năm, tôi vẫn nhớ rất rõ cảm giác thốt lên 'giọng hát đẹp làm sao'.",
        "grammarNote": "Cụm cảm thán [なんて〜だろう] được trích dẫn bởi と, danh từ hóa bằng の để làm tân ngữ cho [よく覚えている]."
    },
    {
        "id": "s-n2-06",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題7 (35)",
        "prefix": "Ｘ社の健康食品はテレビ番組で",
        "chunks": ["紹介されて", "以来", "、ずっと", "とても売れている"],
        "starIdx": 1,
        "suffix": "。",
        "fullJp": "Ｘ社の健康食品はテレビ番組で紹介されて以来、ずっととても売れている。",
        "kana": "エックスしゃのけんこうしょくひんはテレビばんぐみでしょうかいされていらい、ずっととてもうれている。",
        "vi": "Thực phẩm chức năng của công ty X kể từ sau khi được giới thiệu trên truyền hình thì vẫn bán rất chạy.",
        "grammarNote": "Cấu trúc [Vて + 以来] (kể từ khi... đến nay trạng thái ấy vẫn tiếp tục kéo dài)."
    },
    {
        "id": "s-n2-07",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題7 (38)",
        "prefix": "友達はお茶でうがいをする",
        "chunks": ["ようにした", "ことで", "風邪を", "ひかなくなった"],
        "starIdx": 1,
        "suffix": "らしい。",
        "fullJp": "友達はお茶でうがいをするようにしたことで風邪をひかなくなったらしい。",
        "kana": "ともだちはおちゃでうがいをするようにしたことでかぜをひかなくなったらしい。",
        "vi": "Nghe nói nhờ tập thói quen súc miệng bằng trà mà bạn tôi đã không còn bị cảm cúm nữa.",
        "grammarNote": "[Vる + ようにする] (cố gắng tạo thói quen) + [〜ことで] (nhờ việc đó mà dẫn tới kết quả)."
    },
    {
        "id": "s-n2-08",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題7 (39)",
        "prefix": "彼女があのとき、何を考えていたのか",
        "chunks": ["知りたい", "けれど", "今はもう会うこともないので", "確かめよう"],
        "starIdx": 3,
        "suffix": "がない。",
        "fullJp": "彼女があのとき、何を考えていたのか知りたいけれど今はもう会うこともないので確かめようがない。",
        "kana": "かのじょがあのとき、なにをかんがえていたのかしりたいけれどいまはもうあうこともないのでたしかめようがない。",
        "vi": "Tôi muốn biết lúc đó cô ấy đã nghĩ gì, nhưng giờ không còn gặp nhau nữa nên chẳng có cách nào kiểm chứng được.",
        "grammarNote": "Mẫu N2 [Vます + ようがない] (không có cách nào để làm gì)."
    },
    {
        "id": "s-n2-09",
        "level": 2,
        "source": "Đề JLPT N2 T12/2021 · 問題7 (41)",
        "prefix": "カレーを大量に作りすぎて、",
        "chunks": ["一人では", "食べ切れ", "そうにない", "と思ったので"],
        "starIdx": 2,
        "suffix": "、友人を呼んで食べた。",
        "fullJp": "カレーを大量に作りすぎて、一人では食べ切れそうにないと思ったので、友人を呼んで食べた。",
        "kana": "カレーをたいりょうにつくりすぎて、ひとりではたべきれそうにないとおもったので、ゆうじんをよんでたべた。",
        "vi": "Vì nấu quá nhiều cà ri, thấy một mình chắc không ăn hết nổi nên tôi đã gọi bạn tới ăn cùng.",
        "grammarNote": "Động từ ghép [食べ切る] (ăn hết sạch) + thể phủ định phỏng đoán [〜そうにない] (có vẻ không thể)."
    },

    # ==================== JLPT N1 (9 câu) ====================
    {
        "id": "s-n1-01",
        "level": 1,
        "source": "Đề JLPT N1 T7/2023 · 問題6 (36)",
        "prefix": "スピーチやプレゼンテーションにおいて、ジェスチャーを使いながら話すのは",
        "chunks": ["効果的である反面", "あまりに", "大きすぎるジェスチャーは", "かえって"],
        "starIdx": 2,
        "suffix": "印象を悪くすることもあるので注意が必要だ。",
        "fullJp": "スピーチやプレゼンテーションにおいて、ジェスチャーを使いながら話すのは効果的である反面あまりに大きすぎるジェスチャーはかえって印象を悪くすることもあるので注意が必要だ。",
        "kana": "スピーチやプレゼンテーションにおいて、ジェスチャーをつかいながらはなすのはこうかてきであるはんめんあまりにおおきすぎるジェスチャーはかえっていんしょうをわるくすることもあるのでちゅういがひつようだ。",
        "vi": "Trong diễn thuyết hay thuyết trình, việc vừa dùng cử chỉ vừa nói tuy hiệu quả, nhưng mặt trái là những cử chỉ quá phô trương lại dễ gây ấn tượng xấu nên cần chú ý.",
        "grammarNote": "Cặp đối lập N1: [〜反面] (mặt trái lại) + [あまりに〜はかえって] (quá mức thì ngược lại lại...)."
    },
    {
        "id": "s-n1-02",
        "level": 1,
        "source": "Đề JLPT N1 T7/2023 · 問題6 (37)",
        "prefix": "今や書籍や衣料品だけでなく生鮮食品も、インターネットへの",
        "chunks": ["アクセスが可能な", "環境があれば", "自宅に居ながらにして", "手軽に購入できる"],
        "starIdx": 1,
        "suffix": "時代である。",
        "fullJp": "今や書籍や衣料品だけでなく生鮮食品も、インターネットへのアクセスが可能な環境があれば自宅に居ながらにして手軽に購入できる時代である。",
        "kana": "いまやしょせきやいりょうひんだけでなくせいせんしょくひんも、インターネットへのアクセスがかのうなかんきょうがあればじたくにいながらにしててがるにこうにゅうできるじだいである。",
        "vi": "Ngày nay không chỉ sách vở, quần áo mà cả thực phẩm tươi sống, chỉ cần có môi trường kết nối Internet là dù đang ở nhà vẫn mua được dễ dàng.",
        "grammarNote": "Ngữ pháp N1 [自宅に居ながらにして] (ngồi ngay tại nhà mà vẫn làm được việc ngoài kia)."
    },
    {
        "id": "s-n1-03",
        "level": 1,
        "source": "Đề JLPT N1 T7/2023 · 問題6 (38)",
        "prefix": "よく似た昆虫の判別は大変難しいという。中には、かなり",
        "chunks": ["経験を積んだ", "昆虫学者でさえも", "迷うほど", "判別が難しい"],
        "starIdx": 2,
        "suffix": "場合もあるそうだ。",
        "fullJp": "よく似た昆虫の判別は大変難しいという。中には、かなり経験を積んだ昆虫学者でさえも迷うほど判別が難しい場合もあるそうだ。",
        "kana": "よくにたこんちゅうのはんべつはたいへんむずかしいという。なかには、かなりけいけんをつんだこんちゅうがくしゃでさえもまようほどはんべつがむずかしいばあいもあるそうだ。",
        "vi": "Nghe nói việc phân biệt các loài côn trùng giống nhau rất khó. Thậm chí có trường hợp khó đến mức ngay cả nhà côn trùng học dày dạn kinh nghiệm cũng phải lúng túng.",
        "grammarNote": "[〜でさえも] (ngay cả đối tượng trình độ cao như... cũng) + [〜ほど] (đến mức độ mà...)."
    },
    {
        "id": "s-n1-04",
        "level": 1,
        "source": "Đề JLPT N1 T7/2023 · 問題6 (39)",
        "prefix": "今回の",
        "chunks": ["転職にあたり", "少しも不安がなかったと言えば", "うそになるが", "新たなことに挑戦できてうれしいという"],
        "starIdx": 2,
        "suffix": "気持ちのほうが大きかった。",
        "fullJp": "今回の転職にあたり少しも不安がなかったと言えばうそになるが新たなことに挑戦できてうれしいという気持ちのほうが大きかった。",
        "kana": "こんかいのてんしょくにあたりすこしもふあんがなかったといえばうそになるがあらたなことにちょうせんできてうれしいというきもちのほうがおおきかった。",
        "vi": "Khi chuyển việc lần này, nói hoàn toàn không có chút lo lắng nào thì là nói dối, nhưng cảm giác vui mừng vì được thử thách điều mới vẫn lớn hơn.",
        "grammarNote": "[N + にあたり] (nhân dịp/khi làm việc trọng đại) + lối nói giảm nhẹ [少しも〜なかったと言えばうそになるが] (nói không hề có chút... thì là dối lòng)."
    },
    {
        "id": "s-n1-05",
        "level": 1,
        "source": "Đề JLPT N1 T7/2023 · 問題6 (40)",
        "prefix": "北山市は",
        "chunks": ["今でこそ", "人口１０万人を超える都市となったが", "３０年前までは", "北山駅周辺以外にはほとんど何もない"],
        "starIdx": 2,
        "suffix": "長閑な所だった。",
        "fullJp": "北山市は今でこそ人口１０万人を超える都市となったが３０年前までは北山駅周辺以外にはほとんど何もない長閑な所だった。",
        "kana": "きたやましはいまでこそじんこうじゅうまんにんをこえるとしとなったがさんじゅうねんまえまではきたやまえきしゅうへんいがいにはほとんどなにもないのどかなところだった。",
        "vi": "Thành phố Kitayama tuy ngày nay đã trở thành đô thị hơn 10 vạn dân, nhưng cho tới 30 năm trước ngoài khu vực quanh ga thì hầu như chẳng có gì, là nơi thanh bình yên ả.",
        "grammarNote": "Mẫu tương phản quá khứ – hiện tại: [今でこそ〜が、以前は...] (chính lúc này mới được như vậy, chứ trước kia thì...)."
    },
    {
        "id": "s-n1-06",
        "level": 1,
        "source": "Đề JLPT N1 T12/2023 · 問題6 (36)",
        "prefix": "当社が先月発売したパソコンについて、印刷の設定ができないとの",
        "chunks": ["問い合わせが複数寄せられ", "調査したところ", "マニュアルに誤りがある", "ことが判明しました"],
        "starIdx": 0,
        "suffix": "。",
        "fullJp": "当社が先月発売したパソコンについて、印刷の設定ができないとの問い合わせが複数寄せられ調査したところマニュアルに誤りがあることが判明しました。",
        "kana": "とうしゃがせんげつはつばいしたパソコンについて、いんさつのせっていができないとのといあわせがふくすうよせられちょうさしたところマニュアルにあやまりがあることがはんめいしました。",
        "vi": "Về chiếc máy tính công ty phát hành tháng trước, sau khi nhận nhiều phản ánh không cài đặt được in ấn và tiến hành điều tra, chúng tôi phát hiện có lỗi sai trong sách hướng dẫn.",
        "grammarNote": "[との問い合わせ] (lời hỏi/phản ánh cho rằng...) + [Vた + ところ] (khi tiến hành điều tra thì phát hiện ra kết quả)."
    },
    {
        "id": "s-n1-07",
        "level": 1,
        "source": "Đề JLPT N1 T12/2023 · 問題6 (37)",
        "prefix": "このフライパンは",
        "chunks": ["さすが", "料理が上手な森さんが", "勧める", "だけあって"],
        "starIdx": 2,
        "suffix": "、とても使いやすい。",
        "fullJp": "このフライパンはさすが料理が上手な森さんが勧めるだけあって、とても使いやすい。",
        "kana": "このフライパンはさすがりょうりがじょうずなもりさんがすすめるだけあって、とてもつかいやすい。",
        "vi": "Chiếc chảo này quả không hổ danh là món đồ mà chị Mori nấu ăn giỏi giới thiệu, dùng rất thích.",
        "grammarNote": "Cặp hô ứng [さすが 〜 だけあって] (quả đúng như danh tiếng / xứng đáng với...)."
    },
    {
        "id": "s-n1-08",
        "level": 1,
        "source": "Đề JLPT N1 T12/2023 · 問題6 (38)",
        "prefix": "最後に見た映画が何だったのかも",
        "chunks": ["思い出せない", "ほど", "ひさしく", "映画を見ていない"],
        "starIdx": 2,
        "suffix": "。",
        "fullJp": "最後に見た映画が何だったのかも思い出せないほどひさしく映画を見ていない。",
        "kana": "さいごにみたえいががなんだったのかもおもいだせないほどひさしくえいがをみていない。",
        "vi": "Đã lâu lắm rồi tôi không xem phim, đến mức chẳng thể nhớ nổi bộ phim cuối cùng mình xem là phim gì nữa.",
        "grammarNote": "[Vない + ほど] nhấn mạnh mức độ (đến mức không nhớ nổi); phó từ văn viết [ひさしく] (đã lâu rồi)."
    },
    {
        "id": "s-n1-09",
        "level": 1,
        "source": "Đề JLPT N1 T12/2023 · 問題6 (40)",
        "prefix": "このレシピ本は",
        "chunks": ["普段料理をしない人でも", "レシピに沿って", "調理するだけで", "簡単に本格的な料理が作れると"],
        "starIdx": 2,
        "suffix": "若い人の間で評判になっているそうだ。",
        "fullJp": "このレシピ本は普段料理をしない人でもレシピに沿って調理するだけで簡単に本格的な料理が作れると若い人の間で評判になっているそうだ。",
        "kana": "このレシピほんはふだんりょうりをしないひとでもレシピにそってちょうりするだけでかんたんにほんかくてきなりょうりがつくれるとわかいひとのあいだでひょうばんになっているそうだ。",
        "vi": "Nghe nói cuốn sách công thức này đang được giới trẻ khen ngợi rằng ngay cả người bình thường không nấu ăn cũng chỉ cần làm theo là nấu được món chuẩn vị dễ dàng.",
        "grammarNote": "[N + に沿って] (tuân theo/bám sát theo...) + [Vる + だけで] (chỉ cần làm thế thôi là đủ)."
    }
]


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    for item in SENTENCES:
        joined = item['prefix'] + ''.join(item['chunks']) + item['suffix']
        assert joined == item['fullJp'], f"Mismatch in {item['id']}: {joined} != {item['fullJp']}"
        assert len(item['chunks']) == 4, f"Must have 4 chunks: {item['id']}"
        assert 0 <= item['starIdx'] <= 3, f"Invalid starIdx: {item['id']}"

    out_path = os.path.join(DATA_DIR, 'sentences.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(SENTENCES, f, ensure_ascii=False, indent=2)

    by_lvl = collections.Counter(x['level'] for x in SENTENCES)
    print(f'Wrote {out_path}: {len(SENTENCES)} sentences {dict(sorted(by_lvl.items()))} ({os.path.getsize(out_path)/1024:.1f} KB)')


if __name__ == '__main__':
    main()
