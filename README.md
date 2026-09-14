# EzSubtitle

Extension Manifest V3 cho Chrome và Microsoft Edge: lấy toàn bộ phụ đề có timestamp từ video YouTube và chuẩn bị một bản nháp tóm tắt trên ChatGPT. EzSubtitle không dùng OpenAI API, không có API key, không tự gửi tin nhắn, và không gửi transcript ra ngoài trừ khi người dùng bấm **Tóm tắt bằng ChatGPT**.

## Chức năng

- Đọc caption track từ player response của YouTube, gồm phụ đề tải lên và phụ đề tự động.
- Chọn ngôn ngữ; mặc định ưu tiên English thủ công, rồi English tự động, rồi track đầu tiên.
- Parse JSON3, `srv3`, và XML classic; giữ thứ tự và timestamp bắt đầu của từng caption.
- Sao chép hoặc tải `.txt` với định dạng duy nhất `[HH:MM:SS] Nội dung`.
- Mở ChatGPT với toàn bộ transcript kèm prompt tóm tắt tiếng Việt. Extension chỉ điền composer theo best-effort, tuyệt đối không tìm hoặc bấm Send.
- Nếu giao diện ChatGPT thay đổi làm autofill thất bại, một panel nhỏ cho phép sao chép nguyên draft để người dùng tự dán.

## Phát triển

Yêu cầu Node.js 22+ và npm.

```powershell
npm install
npm run dev
```

WXT sẽ in ra thư mục extension đang chạy. Sau khi mở hoặc đổi video trong YouTube SPA, popup tự làm mới context để không giữ transcript của video cũ.

## Kiểm tra và build

```powershell
npm run compile
npm run lint
npm test
npm run build
npm run zip
```

Build production có thể load unpacked ở `.output/chrome-mv3`. Trong Chrome/Edge, mở trang Extensions, bật Developer mode, chọn **Load unpacked**, sau đó chọn thư mục này. File release zip tạo sẵn nằm ở `artifacts/ezsubtitle-0.1.0-chrome.zip` (WXT cũng tạo bản gốc trong `.output`).

## Permissions

- `activeTab`: xác định tab đang mở từ popup.
- `tabs`: đọc URL của tab hiện tại và mở đúng tab ChatGPT cho draft.
- `storage`: cache transcript theo video/track và lưu draft tạm trong `storage.session`.
- `clipboardWrite`: copy subtitle hoặc draft fallback theo hành động của người dùng.
- Host chỉ giới hạn ở YouTube (`youtube.com`, `youtu.be`, `youtube-nocookie.com`) và `chatgpt.com`; không dùng `<all_urls>`.

## Kiến trúc

- `entrypoints/content.ts`: content script YouTube, bridge với main world và xử lý YouTube SPA navigation.
- `entrypoints/youtube-main-world.content.ts`: đọc player response trong main world, chỉ trả về video details và caption tracks cần thiết.
- `entrypoints/background.ts`: validate URL timedtext, fetch/parse/caching transcript, và quản lý draft theo `tabId`.
- `entrypoints/chatgpt.content.ts`: tìm composer theo nhiều selector, thử chèn rồi xác minh; fallback panel khi không thể.
- `src/lib`: parser, formatter, selection, prompt builder, cache, và typed message model.
- `tests`: fixture JSON3/srv3/XML, unit tests và mock integration tests.

## Bảo mật và giới hạn

Caption URL phải là HTTPS `youtube.com/api/timedtext` hoặc `youtube-nocookie.com/api/timedtext` trước khi service worker được phép fetch. Transcript được xem là dữ liệu không đáng tin cậy: nội dung hiển thị qua text/textarea và prompt yêu cầu ChatGPT không làm theo mệnh lệnh bên trong transcript.

Autofill ChatGPT là best-effort vì DOM của ChatGPT có thể thay đổi. Khi selector hoặc editor không tương thích, EzSubtitle giữ draft trong `storage.session`, không xóa nó, và cung cấp nút sao chép trong panel. Người dùng luôn là người kiểm tra và bấm gửi.

Không bao gồm speech-to-text, download audio/video, dịch subtitle, SRT/VTT, Firefox hoặc gửi nhiều message cho transcript dài trong phiên bản này.

This template should help get you started developing with React in WXT.
