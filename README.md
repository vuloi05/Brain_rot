# BOKUSEKI (墨跡) — Xưởng Giải Phẫu & Luyện Tự Kanji N5–N1 Chống Thối Não

Ứng dụng web học tiếng Nhật cá nhân theo triết lý **Anti-Brain-Rot (Chống thối não)**: loại bỏ trắc nghiệm ăn liền A/B/C/D, tập trung vào **giải phẫu chiết tự Kanji**, **tập viết vector chuẩn nét**, **viết mù truy xuất chủ động** và **đo lường độ bền tập trung**.

## Tính năng cốt lõi

- **Trọn bộ 2.211 chữ Kanji JLPT N5–N1 (Offline 100%):**
  - `N5`: 79 chữ · `N4`: 166 chữ · `N3`: 367 chữ · `N2`: 367 chữ · `N1`: 1.232 chữ.
  - Hợp nhất dữ liệu âm **Hán-Việt & nghĩa tiếng Việt** (KanjiDictVN), **JLPT/On/Kun** (kanji-data) và **tọa độ vector nét viết + cây bộ phận** (KanjiVG).
- **4 Chế độ luyện tập trên bảng giấy Masume:**
  1. **Giải phẫu nét:** Hoạt ảnh bút thuận, tô màu phân tách từng bộ phận, soi nét tương ứng khi di chuột lên cây chiết tự và nhảy sang các chữ cùng chứa bộ phận đó.
  2. **Tập viết chuẩn:** Vẽ trực tiếp bằng chuột/bút/cảm ứng; kiểm tra vector từng nét (phát hiện ngược chiều nét và sai thứ tự nét), đóng dấu triện khi hoàn tất.
  3. **Viết mù (Blind Recall):** Ẩn hoàn toàn mặt chữ Kanji; áp dụng quy tắc trễ 3 giây trước khi mở khóa nút gợi ý nét.
  4. **Gõ truy xuất:** Tự gõ âm Hán-Việt và cách đọc On/Kun (tích hợp bộ chuyển đổi Romaji → Hiragana).
- **Đấu trường Ôn tập mù (SRS SM-2) & Đồng hồ Phiên Tập Trung:**
  - Nghi thức thở 4–4–4 hạ nhịp kích thích trước khi vào phiên tập trung (15/25/40 phút), phát hiện rời tab gây nhiễu.
- **Lưu trữ trực tiếp & Đồng bộ nhiều máy qua GitHub:**
  - Toàn bộ tiến độ học, lịch ôn SRS và sổ tay chiết tự cá nhân lưu thẳng vào `data/user-progress.json`.

## Cách chạy trên máy

Yêu cầu: **Node.js >= 18** (không cần cài đặt thêm thư viện ngoài).

- **Trên Windows:** Nhấp đúp file `start.bat` hoặc mở terminal chạy:
  ```bash
  npm start
  ```
- Truy cập trình duyệt tại: `http://localhost:3456`

## Đồng bộ sang máy tính khác

1. Khi kết thúc buổi học, vào tab **Não bộ & Git** trong ứng dụng và bấm **Commit & Push lên GitHub** (hoặc chạy `git add data/user-progress.json && git commit -m "update progress" && git push`).
2. Trên máy tính mới:
   ```bash
   git clone https://github.com/vuloi05/Brain_rot.git
   cd Brain_rot
   npm start
   ```
   Toàn bộ tiến độ và lịch ôn tập SRS trong `data/user-progress.json` sẽ tiếp tục ngay lập tức.
