# BOKUSEKI (墨跡) & LEXICON (語) — Studio Học Sâu Tiếng Nhật & Tiếng Anh Chống Thối Não

Nền tảng học ngôn ngữ cá nhân chạy **100% cục bộ** (`Node.js` thuần, không framework, không bước build), thiết kế theo triết lý **Anti-Brain-Rot (Chống thối não)**: loại bỏ cơ chế lướt feed và trắc nghiệm đoán mò, thay bằng **giải phẫu cấu tạo từ/chữ**, **viết tay & gõ truy xuất chủ động (Active Recall)**, **đọc sâu mở khóa từng đoạn (Anti-Skimming)** và **giãn cách lặp lại SM-2**.

Toàn bộ dữ liệu từ điển cốt lõi chạy offline, tiến độ học được lưu thẳng vào [`data/user-progress.json`](data/user-progress.json) và đồng bộ giữa nhiều máy chỉ bằng một nút bấm qua GitHub.

---

## Mục lục

1. [Triết lý thiết kế & Cổng Sanctuary Hub](#1-triết-lý-thiết-kế--cổng-sanctuary-hub)
2. [Không gian Tiếng Nhật — BOKUSEKI (墨跡)](#2-không-gian-tiếng-nhật--bokuseki-墨跡)
3. [Không gian Tiếng Anh — LEXICON (語)](#3-không-gian-tiếng-anh--lexicon-語)
4. [Công cụ dùng chung, Hồ sơ Não bộ & Phím tắt](#4-công-cụ-dùng-chung-hồ-sơ-não-bộ--phím-tắt)
5. [Kiến trúc thư mục & Kho dữ liệu](#5-kiến-trúc-thư-mục--kho-dữ-liệu)
6. [Backend Local API & Tăng cường Bảo mật (`server.js`)](#6-backend-local-api--tăng-cường-bảo-mật-serverjs)
7. [Cài đặt, Chạy ứng dụng & Bố trí tài liệu cục bộ](#7-cài-đặt-chạy-ứng-dụng--bố-trí-tài-liệu-cục-bộ)
8. [Kiểm thử tự động cô lập (Playwright E2E)](#8-kiểm-thử-tự-động-cô-lập-playwright-e2e)
9. [Đồng bộ tiến độ đa thiết bị qua GitHub](#9-đồng-bộ-tiến-độ-đa-thiết-bị-qua-github)

---

## 1. Triết lý thiết kế & Cổng Sanctuary Hub

### Sanctuary Hub (`#viewHome`)
Khi mở ứng dụng tại `http://localhost:3456`, **Sanctuary Hub** đóng vai trò cổng vào tĩnh tâm cho cả hai ngôn ngữ:
- Thống kê hợp nhất theo ngày: **phút tập trung hôm nay**, **tổng mục đã học (Kanji + Từ vựng Anh + Bài đọc sâu)** và **tổng thẻ SRS đến hạn ôn**.
- Hai thẻ không gian riêng biệt (**🇯🇵 Nhật — BOKUSEKI** và **🇬🇧 Anh — LEXICON**) kèm lối tắt nhảy thẳng vào đúng module cần học.

### Bố cục 2-Zone chống nhiễu (`.two-zone-workspace`)
- **Thanh Topbar một dòng gọn gàng**: chứa bộ chuyển không gian (`🏠 Home`, `🇯🇵 Nhật`, `🇬🇧 Anh`), thanh tab chế độ theo ngữ cảnh, đồng hồ tập trung, trạng thái lưu đĩa, âm gõ mộc và nút đổi giao diện.
- **Danh sách trái thu gọn được (`◀ Danh sách` / `▶ Danh sách`)** và **ngăn lọc nâng cao ẩn/hiện (`⚙️ Lọc`)**: thu hẹp diện tích xao nhãng khi đang viết tay hoặc đọc sâu.
- **Thanh cấp độ 5 cột** (`N5–N1` cho Nhật, `A1–C1` cho Anh) tự động gắn theo từng view đang mở.
- **Footer chấm điểm SM-2 dính đáy** (`#jpStickySrsFooter`, `#enStickySrsFooter`) giúp đánh giá nhanh bằng phím `1 · 2 · 3 · 4` và chuyển mục trước/sau bằng `[` / `]`.
- **2 giao diện dịu mắt**: **Giấy Hanshi** (`hanshi`, mặc định ban ngày) và **Mực Đêm Yoru** (`yoru`, nền tối).

---

## 2. Không gian Tiếng Nhật — BOKUSEKI (墨跡)

Thanh điều hướng Tiếng Nhật (`#jpViewTabs`) gồm 6 khu vực:

### 2.1. Xưởng chữ Kanji (`Xưởng chữ` — `#viewAtelier`)
- **Kho dữ liệu**: **2.230 chữ Kanji JLPT N5–N1** (`N5: 80 · N4: 168 · N3: 371 · N2: 367 · N1: 1.244`) hợp nhất với **905 thành phần/bộ thủ** (`data/components-index.json`) và từ điển **1.114 từ vựng** (`data/vocab-dict.json`).
- **4 chế độ rèn luyện trên giấy Masume**:
  1. **Giải phẫu nét**: mô phỏng bút thuận, tô màu phân tách từng bộ phận Kanji, di chuột lên cây chiết tự để soi nét tương ứng và nhảy ngang sang các chữ cùng bộ thủ.
  2. **Tập viết chuẩn**: viết bằng chuột/bút/cảm ứng; kiểm tra vector từng nét (phát hiện sai thứ tự và ngược chiều nét), đóng dấu triện khi hoàn thành.
  3. **Viết mù (Blind Recall)**: ẩn mặt chữ Kanji, áp dụng độ trễ chống ỷ lại trước khi cho phép mở gợi ý nét.
  4. **Gõ truy xuất**: gõ âm **Hán–Việt** và cách đọc **On/Kun** (hỗ trợ chuyển đổi Romaji → Hiragana).
- Tích hợp **hàng đợi mục tiêu ngày**, **ghi chú chiết tự cá nhân**, phát âm + YouGlish/Mic Coach và lịch ôn SM-2.

### 2.2. Đọc sâu chống đọc lướt (`Đọc sâu` — `#viewReader`)
- **35 bài đọc** trải đều 5 cấp độ (`N5: 5 · N4: 7 · N3: 13 · N2: 5 · N1: 5`), trong đó có **10 bài đọc chuẩn + Audio CD** tích hợp từ giáo trình *Chukyu e Ikou 2nd Ed (中級へ行こう)*.
- **Cơ chế Anti-Skimming**: khóa các đoạn phía sau, chỉ mở khóa tuần tự từng đoạn sau khi đọc và giải mã xong đoạn hiện tại.
- Bật/tắt **Furigana**, bấm trực tiếp vào từ/Kanji trong bài để tra cứu nội tuyến (ưu tiên từ điển local trước, fallback qua `/api/lookup` kết hợp Mazii/Jisho & pykakasi), lưu tóm tắt sau khi đọc xong.

### 2.3. Xưởng câu & Nghe chép tĩnh (`Xưởng câu` — `#viewForge`)
- **45 bộ bài tập câu** (`9 bài / cấp độ` từ N5 đến N1) trích từ ngữ cảnh thực tế.
- Luyện **ghép trật tự khối câu JLPT** (bài dấu sao `★`) kèm giải thích ngữ pháp, song song với chế độ **Nghe chép tĩnh (Blind Dictation)** tốc độ chậm/chuẩn.

### 2.4. Kho Đề thi JLPT & Thư viện Đa Giáo trình (`Đề & Sách` — `#viewExams`)
Chế độ **`1. Đề thi JLPT`**:
- Quản lý danh mục **125 mục đề thi JLPT** (`N5: 12 · N4: 16 · N3: 32 · N2: 32 · N1: 33`).
- Trình xem PDF & ảnh đáp án trực tiếp trong ứng dụng, trình phát Audio MP3 hỗ trợ tua `−5s` / `+5s`, chọn tốc độ `0.85x · 1.0x · 1.15x` (nhờ HTTP Range `206`), lá chắn cảnh báo khi mở Script nghe/Đáp án, tra cứu nhanh từng chữ Kanji ngay bên cạnh đề thi và lưu phiếu ghi chú/trạng thái hoàn thành.

Chế độ **`2. Sách giáo trình`** (Thư viện Đa Giáo trình):
- **📘 中級へ行こう (`Chukyu e Ikou 2nd Ed`)**:
  - Số hóa mục lục **10 bài học**, **55 mẫu câu ngữ pháp** và **169 Kanji** liên thông trực tiếp với **Xưởng chữ Kanji N5–N1**.
  - Gắn sẵn PDF giáo trình, PDF hướng dẫn giáo viên (`教師用ガイド`), Audio **CD Chậm** và **CD Tự nhiên** cho từng bài.
- **🎧 耳から N3 (`Mimi Kara Oboeru N3 Goi` — 耳から覚える 日本語能力試験 語彙トレーニング N3)**:
  - Bản đồ trang PDF chuẩn xác cho toàn bộ sách **236 trang** (`pageOffset = 1`, công thức `pdfPage = bookPage + 1`).
  - Bao phủ trọn vẹn **12 Unit** với **880 từ vựng cốt lõi** (chia **Step 1 · Step 2 · Step 3**), **25 mục Column / まとめ** (~520 từ mở rộng), **18 bài `練習問題 I`**, **9 đề `練習問題 II` (180 câu chuẩn JLPT)**, bảng tra âm 50 chữ cái (`語彙索引`) và khu vực đáp án (`解答`).
  - Hỗ trợ lọc theo **Step 1 / 2 / 3**, thanh nút nhảy nhanh tới từng phần/Column của Unit, ô nhập nhảy thẳng tới **số trang in trong sách (`Tr.sách:`)**, lá chắn chống xem trộm (`#examGuardBanner`) khi mở trang đáp án `解答`, và lưu ghi chú + đánh dấu hoàn thành từng Unit (đồng bộ sang tab `Não bộ & Git`).

### 2.5. Đấu trường Ôn mù Dojo (`Ôn mù` — `#viewDojo`)
- Tập hợp toàn bộ Kanji đến hạn ôn SM-2 (`#dueCountBadge`), buộc truy xuất mù không gợi ý để đánh giá chính xác mức độ nhớ.

---

## 3. Không gian Tiếng Anh — LEXICON (語)

Thanh điều hướng Tiếng Anh (`#enViewTabs`) gồm 5 tab:

### 3.1. Xưởng Gốc Từ (`1. Xưởng Gốc Từ` — `#viewEnAtelier`)
- **Kho hình thái học & từ vựng**:
  - **36 gốc từ Latin/Hy Lạp**, **35 tiền tố**, **28 hậu tố** (`data/en-roots.json`).
  - **253 từ cốt lõi CEFR A1–C1** (`A1: 36 · A2: 48 · B1: 61 · B2: 58 · C1: 50` trong `data/en-vocab.json`) kèm IPA, nghĩa tiếng Việt, ghi chú nguồn gốc (etymology), collocations, câu ví dụ song ngữ và họ từ.
  - Kho tần suất **9.967 từ Google Top 10k** (`data/en-freq-top10k.json`) tự động phân tách cấu trúc Tiền tố – Gốc – Hậu tố.
- **4 tab thực hành chuyên sâu**:
  1. `1. Giải phẫu & Ví dụ`: phương trình cấu tạo từ (`prefix + root + suffix`), collocations, ví dụ, phát âm **US / UK** (`1.0x` / `0.75x`), mở YouGlish & Mic Coach.
  2. `2. Điền khuyết`: bài tập Cloze điền từ đúng theo ngữ cảnh.
  3. `3. Chính tả mù`: nghe/đọc nghĩa và tự gõ lại nguyên từ, hiển thị so sánh từng ký tự sai/đúng (character diff).
  4. `4. Họ từ & Ghi chú`: mạng lưới các từ cùng gốc, danh sách từ gần âm dễ nhầm chính tả và sổ tay gốc từ cá nhân tự lưu vào `data/user-progress.json`.
- Hỗ trợ lọc theo cấp độ, gốc từ, hàng đợi mục tiêu hôm nay (`🔥 Hôm nay`) và tab **`Ôn tập`** (`#enDueCountBadge`).

### 3.2. Đội Hình Bắn Từ (`2. 🎯 Đội Hình Bắn Từ` — Falling Squadron Option A)
Được thiết kế lại hoàn toàn theo chuẩn **Active Recall ("Nạp nguyên từ & Khai hỏa")**, loại bỏ việc "nhìn chữ trên màn hình rồi gõ lại":
- **Ẩn hoàn toàn chữ cái Latin đáp án & mã gốc `[rootId]` trên phi cơ**: trên màn hình chiến đấu chỉ hiện **nghĩa tiếng Việt**, **từ loại**, **nghĩa gốc tiếng Việt** và độ dài từ dạng dấu chấm (`••••`).
- **Nạp nguyên từ & Khai hỏa (`Enter`)**: người chơi tự nhớ ra từ tiếng Anh, gõ vào ô `#sqTypeInput` (cho phép `Backspace` sửa trước khi bắn) rồi nhấn `Enter` (hoặc nút `🚀 Bắn [Enter]`). Bắn gần đúng sẽ có cảnh báo *typo near-miss* (tính bằng khoảng cách chỉnh sửa) mà không làm lộ đáp án; hạ gục mục tiêu sẽ hiện banner củng cố (`từ + IPA + hình thái`) kèm phát âm.
- **4 chế độ truy xuất**:
  1. `🧠 Truy xuất theo Nghĩa & Gốc` *(mặc định)*.
  2. `🧬 Ghép Nghĩa Hình Thái`.
  3. `🔊 Phản Xạ Nghe Thật`: ẩn nghĩa tiếng Việt, đọc phát âm thực tế (bao gồm cả cụm collocation/câu hoàn chỉnh).
  4. `⚡ Luyện Gõ (Hiện chữ · Không SRS)`: tách riêng cho mục đích khởi động ngón tay và chủ động tắt đồng bộ SRS.
- **Radar 2 tầng (`Tab`)**:
  - **Tầng 1**: phát âm mục tiêu + gợi ý IPA và phân tách hình thái tiếng Việt *(chưa lộ mặt chữ)*.
  - **Tầng 2**: mới mở đáp án và ghi nhận từ vào danh sách `missedWords` cần ôn lại.
- **Kỹ năng & Đợt tấn công (Waves 1–5)**:
  - **❄️ Đẩy Lùi & Đóng Băng (`Alt+Space`)**: đẩy lùi và làm chậm toàn bộ đội hình nhưng **không tự giết phi cơ**, đảm bảo người học vẫn phải tự nhớ và gõ đáp án.
  - **Cộng hưởng Gốc từ**: hạ đúng một mục tiêu giúp đẩy lùi/làm chậm các từ cùng họ gốc trên màn hình.
  - **Wave 3 (Elite Collocation Cloze)** & **Wave 5 (Boss 3 lớp giáp Full-Sentence Cloze)**: hiển thị trọn vẹn cụm từ hoặc câu ngữ cảnh khuyết chỗ (không cắt ngắn), đòi hỏi truy xuất chính xác từ còn thiếu để phá từng lớp giáp.
- **Đồng bộ SRS sạch (`syncSquadronToSrs`)**: chỉ nâng lịch/đánh dấu ôn lại đối với các từ người học đã học trong `prog.enVocab` (không tự sinh thẻ rác từ kho 10k), và bấm vào chip từ ở màn hình tổng kết sẽ mở thẳng từ đó trong `1. Xưởng Gốc Từ`.

### 3.3. Đọc sâu Tiếng Anh (`3. Đọc sâu` — `#viewEnReader`)
- **15 bài đọc chọn lọc CEFR A1–C1** (`3 bài / cấp độ`) trong [`data/en-readings.json`](data/en-readings.json) xoay quanh các chủ đề khoa học não bộ, chống phân tâm, tâm lý học và ngôn ngữ học; mỗi bài kèm danh sách `keyWords` và **câu hỏi đọc hiểu cuối bài** (`promptEn`, `promptVi`, `sampleAnswer`).
- **2 chế độ đọc & hỗ trợ âm thanh**: mở khóa từng đoạn chống đọc lướt hoặc xem toàn bài, bật/tắt dịch tiếng Việt từng đoạn/toàn bài, nghe đọc toàn bài giọng **US `1.0x` / `0.75x`**.
- **Inline Word Anatomy Inspector (`#enInlineInspector`)**:
  - Bấm vào bất kỳ từ tiếng Anh nào trong bài đọc (`.en-word-token`) để mở bảng giải phẫu trực tiếp ngay dưới đoạn văn: IPA, nghĩa tiếng Việt, phân tách `Prefix + Root + Suffix`, tự động quy gốc từ chia động từ/số nhiều (lemmatization).
  - Nếu từ nằm ngoài kho local, hệ thống tự động gọi `/api/en-lookup` để lấy phiên âm & nghĩa (không lưu cache lỗi khi mất mạng).
  - Nút **`+ Đưa vào SRS Hôm nay`** hỗ trợ cả **253 từ cốt lõi** lẫn **từ Top 10k / từ hiếm ngoài 253** (lưu thẳng vào `Ôn tập`), kèm nút **`Mở trong Xưởng Gốc Từ →`**.
- **Dán bài đọc tự chọn (`#enCustomReadingForm`)** (đã làm sạch chống XSS) + **Ghi chú tóm tắt 1 câu chủ động** (`enReadingsDone`, `enReadingNotes`) đồng bộ về Sanctuary Hub và Hồ sơ Não bộ.

---

## 4. Công cụ dùng chung, Hồ sơ Não bộ & Phím tắt

### 4.1. Nghe ngữ cảnh YouGlish & Web Speech Mic Coach (`MediaCoach`)
- Dùng chung cho cả Tiếng Nhật và Tiếng Anh qua [`window.MediaCoach`](en-app.js):
  - **YouGlish Drawer (`#youglishDrawer`)**: nhúng video thực tế phát âm từ/câu đang học theo giọng Nhật, Anh-Mỹ hoặc Anh-Anh.
  - **Mic Coach Drawer (`#micCoachDrawer`)**: sử dụng Web Speech API để nhận diện giọng nói trực tiếp từ micro và đối chiếu từng từ với câu/từ mẫu.

### 4.2. Hồ sơ Não bộ & Đồng bộ Git (`Não bộ & Git` — `#viewNeuro`)
- Tổng hợp thời gian tập trung sâu (Monk Mode với **nghi thức thở 4–4–4** và cảnh báo rời tab), chuỗi ngày học, biểu đồ tiến độ Kanji N5–N1, tiến độ Từ vựng & Đọc sâu Tiếng Anh, tiến độ Đọc sâu / Xưởng câu / Đề thi JLPT, tiến độ giáo trình **Chukyu e Ikou** & **Unit 耳から N3**, kho ghi chú cá nhân và nút **Commit & Push lên GitHub**.

### 4.3. Bảng phím tắt nhanh

| Ngữ cảnh | Phím tắt | Chức năng |
| :--- | :---: | :--- |
| Xưởng chữ (JP) / Xưởng Gốc Từ (EN) | `1` `2` `3` `4` | Chấm điểm SRS SM-2 (`Quên` / `Khó` / `Nhớ tốt` / `Khắc cốt`) |
| Xưởng chữ (JP) / Xưởng Gốc Từ (EN) | `[` / `]` | Chuyển nhanh về mục trước / mục kế tiếp |
| Đội Hình Bắn Từ (EN) | `Enter` | Khai hỏa từ đang nhập trong nòng pháo |
| Đội Hình Bắn Từ (EN) | `Tab` | Radar 2 tầng (Lần 1: nghe + IPA/hình thái · Lần 2: hé lộ đáp án) |
| Đội Hình Bắn Từ (EN) | `Alt + Space` | Kích hoạt kỹ năng **❄️ Đẩy Lùi & Đóng Băng** đội hình |
| Đội Hình Bắn Từ (EN) | `Alt + R` | Nghe lại phát âm của mục tiêu đang khóa / thấp nhất |
| Đội Hình Bắn Từ (EN) | `Esc` | Xóa ô nhập và bỏ chọn mục tiêu |

---

## 5. Kiến trúc thư mục & Kho dữ liệu

```text
Brain_rot/
├── index.html                  # Giao diện hợp nhất Sanctuary Hub + BOKUSEKI (JP) + LEXICON (EN)
├── styles.css                  # Hệ thống thiết kế Giấy Hanshi / Mực Đêm Yoru & bố cục 2-Zone
├── app.js                      # Logic Tiếng Nhật (Kanji Atelier, Deep Reader, Sentence Forge, Exams/Textbooks, Dojo, Focus, Git Sync)
├── en-app.js                   # Logic Tiếng Anh (Root Atelier, Squadron Option A, EN Deep Reader, Inline Anatomy, MediaCoach)
├── server.js                   # HTTP server thuần Node.js, local lookup APIs, Range PDF/Audio streaming, Git CLI sync & bảo mật
├── start.bat                   # Script khởi động nhanh trên Windows
├── package.json                # Cấu hình dự án (Node >= 18)
├── data/
│   ├── kanji-n5.json           # 80 Kanji N5 (vector KanjiVG + Hán Việt + On/Kun + từ ghép)
│   ├── kanji-n4.json           # 168 Kanji N4
│   ├── kanji-n3.json           # 371 Kanji N3
│   ├── kanji-n2.json           # 367 Kanji N2
│   ├── kanji-n1.json           # 1.244 Kanji N1
│   ├── kanji-lookup.json       # Chỉ mục tra cứu nhanh toàn bộ 2.230 Kanji
│   ├── components-index.json   # 905 thành phần/bộ thủ và liên kết chéo Kanji
│   ├── vocab-dict.json         # 1.114 mục từ vựng tiếng Nhật tra cứu offline
│   ├── readings.json           # 35 bài đọc sâu tiếng Nhật (N5–N1, gồm 10 bài Chukyu e Ikou có Audio)
│   ├── sentences.json          # 45 bài tập ghép câu & nghe chép tĩnh (N5–N1)
│   ├── exam-catalog.json       # Danh mục 125 đề thi JLPT N5–N1
│   ├── textbooks.json          # Giáo trình 中級へ行こう (10 bài, 55 ngữ pháp, 169 Kanji)
│   ├── mimi-n3-book.json       # Bản đồ số hóa sách 耳から覚える N3 (12 Unit, 880 từ, Column, Luyện tập, Đáp án)
│   ├── en-roots.json           # 36 gốc từ Latin/Hy Lạp, 35 tiền tố, 28 hậu tố
│   ├── en-vocab.json           # 253 từ cốt lõi CEFR A1–C1 kèm giải phẫu & collocation
│   ├── en-freq-top10k.json     # 9.967 từ tần suất Google Top 10k kèm phân tách hình thái
│   ├── en-readings.json        # 15 bài đọc sâu Tiếng Anh A1–C1 kèm câu hỏi đọc hiểu
│   └── user-progress.json      # Toàn bộ tiến độ học, lịch SRS, ghi chú & thời gian tập trung
├── scripts/                    # Script Python tái tạo/cập nhật dữ liệu (offline build helpers)
│   ├── build_dataset.py
│   ├── build_chukyu.py
│   ├── build_readings_and_exams.py
│   ├── build_sentences.py
│   ├── build_vocab_dict.py
│   └── build_english_dataset.py
└── tests/                      # Bộ kiểm thử Playwright E2E & bảo mật cô lập hoàn toàn
    ├── harness.py
    ├── run_e2e.py
    ├── test_harness_isolation.py
    ├── test_tier1_dataset.py
    ├── test_tier1_features.py
    ├── test_tier2_boundaries.py
    ├── test_tier3_cross_feature.py
    ├── test_tier4_scenarios.py
    ├── test_security_r3.py
    ├── test_squadron_option_a.py
    └── test_mimi_stage0_1.py
```

---

## 6. Backend Local API & Tăng cường Bảo mật (`server.js`)

### Các endpoint trên `http://localhost:3456`
- `GET /api/progress` · `POST /api/progress`: đọc/ghi [`data/user-progress.json`](data/user-progress.json) theo cơ chế ghi nguyên tử (atomic write), kiểm tra schema nghiêm ngặt (`validateProgressPayload`).
- `GET /api/lookup?text=...` · `POST /api/lookup`: tra cứu từ/Kanji tiếng Nhật từ kho local kết hợp fallback Mazii/Jisho & `pykakasi` (tách Furigana cho đoạn văn tùy chỉnh).
- `GET /api/en-lookup?word=...`: tra cứu từ tiếng Anh ưu tiên `en-vocab.json` & `en-freq-top10k.json`, hỗ trợ lemmatization và fallback DictionaryAPI / Google Translate / MyMemory (lọc sạch thẻ HTML trước khi trả về client).
- `GET /api/git-status` · `POST /api/git-save`: kiểm tra thay đổi tiến độ và thực hiện `git add data/user-progress.json` + commit tóm tắt chi tiết (`JP: ... | EN: ... | EN-Read: ...`) + `git push`.

### Biện pháp bảo mật & truyền tải
- **Chặn rò rỉ nội bộ**: từ chối toàn bộ truy cập path traversal (`..`) và thư mục `.git/`.
- **Header an toàn**: gắn `X-Content-Type-Options: nosniff` cho phản hồi tĩnh và API.
- **Chống payload quá khổ / sai định dạng**: giới hạn kích thước body **5 MB** (vượt quá trả HTTP `413` và xả luồng an toàn), JSON không hợp lệ hoặc sai kiểu trả HTTP `400`.
- **Truyền phát media mượt mà**: hỗ trợ `Accept-Ranges` và HTTP `206 Partial Content` cho file PDF giáo trình và Audio MP3 đề thi/CD.

### Biến môi trường tùy chọn
| Biến môi trường | Mặc định | Công dụng |
| :--- | :--- | :--- |
| `PORT` | `3456` | Đổi cổng chạy HTTP server |
| `BOKUSEKI_PROGRESS_FILE` | `data/user-progress.json` | Trỏ sang file tiến độ khác (dùng để chạy test cô lập hoặc tách profile) |
| `BOKUSEKI_EN_DICT_BASE` | `https://api.dictionaryapi.dev/api/v2/entries/en` | Override endpoint từ điển Anh–Anh (hữu ích khi test offline/mock) |
| `BOKUSEKI_EN_GT_BASE` | `https://translate.googleapis.com/translate_a/single` | Override endpoint dịch Anh–Việt |
| `BOKUSEKI_EN_MM_BASE` | `https://api.mymemory.translated.net/get` | Override endpoint fallback MyMemory |

---

## 7. Cài đặt, Chạy ứng dụng & Bố trí tài liệu cục bộ

### Chạy ứng dụng
- **Yêu cầu tối thiểu**: **Node.js >= 18.0.0** (ứng dụng web không cần cài đặt thêm `node_modules`).
- **Trên Windows**: nhấp đúp [`start.bat`](start.bat) hoặc mở terminal trong thư mục gốc và chạy:
  ```bash
  npm start
  ```
- Mở trình duyệt tại: `http://localhost:3456`

### Bố trí tài liệu PDF & Audio nặng (Không commit lên GitHub)
Các thư mục media bản quyền nặng đã được đưa vào [`.gitignore`](.gitignore) để giữ repository nhẹ và sạch. Để dùng đầy đủ trình đọc đề thi và giáo trình trong tab **`Đề & Sách`**, hãy đặt các tệp cục bộ đúng cấu trúc sau:
```text
Brain_rot/
├── de_thi/                                      # Các thư mục PDF đề thi & MP3 nghe JLPT theo exam-catalog.json
└── tai_lieu_tieng_nhat/
    ├── Chukyu_e_ikou/
    │   ├── （第二版）中級へ行こう.pdf            # PDF sách 中級へ行こう 2nd Ed
    │   └── audio/                               # Audio CD chậm/tự nhiên & 教師用ガイド.pdf
    └── Mimi_Kara_Oboeru/
        └── Mimi_Kara_Oboeru_N3-Goi.pdf          # PDF sách 耳から覚える N3 語彙トレーニング (236 trang)
```

*(Tùy chọn dành cho nhà phát triển muốn tái tạo dữ liệu từ nguồn thô)*: cần Python 3 cùng các thư viện tương ứng trong `scripts/`, ví dụ chạy `npm run build:data`.

---

## 8. Kiểm thử tự động cô lập (Playwright E2E)

Toàn bộ suite test trong [`tests/`](tests) tự động sao chép [`data/user-progress.json`](data/user-progress.json) sang file tạm thời qua `BOKUSEKI_PROGRESS_FILE` trên cổng ephemeral riêng, và **kiểm tra SHA-256 trước–sau để cam kết không làm biến đổi dữ liệu học thật của bạn**.

Yêu cầu môi trường test: Python 3 + `playwright` (`pip install playwright && playwright install chromium`).

```bash
# Chạy toàn bộ các tầng kiểm thử (Dataset, Tính năng, Biên, Liên thông, Kịch bản thực tế & Bảo mật)
python tests/run_e2e.py --tier all

# Hoặc chạy nhanh từng tầng / từng cụm chức năng riêng lẻ:
python tests/run_e2e.py --tier security
python tests/test_squadron_option_a.py     # Kiểm thử Đội Hình Bắn Từ Option A & đồng bộ SRS
python tests/test_mimi_stage0_1.py         # Kiểm thử thư viện đa giáo trình Chukyu + Mimi Kara N3
python tests/test_security_r3.py           # Kiểm thử XSS, Path Traversal, giới hạn 5MB & API validation
```

---

## 9. Đồng bộ tiến độ đa thiết bị qua GitHub

1. **Trước khi bắt đầu học trên máy khác**: kéo bản tiến độ mới nhất về máy:
   ```bash
   git pull --rebase
   ```
2. **Sau khi kết thúc buổi học**: vào tab **`Não bộ & Git`** trong ứng dụng và bấm **Commit & Push lên GitHub** (hoặc dùng API `/api/git-save`). Server sẽ tự động commit [`data/user-progress.json`](data/user-progress.json) với tóm tắt số lượng Kanji, từ vựng Anh và bài đọc đã học rồi đẩy thẳng lên nhánh hiện tại trên GitHub.
3. **Trên máy tính mới hoàn toàn**:
   ```bash
   git clone https://github.com/vuloi05/Brain_rot.git
   cd Brain_rot
   npm start
   ```
   Toàn bộ lịch ôn SRS, ghi chú Kanji, ghi chú gốc từ Anh, Unit sách giáo trình và phút tập trung sâu sẽ tiếp tục ngay lập tức.
