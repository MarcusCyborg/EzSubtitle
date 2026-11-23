# EzSubtitle: kế hoạch cải thiện transcript và xuất dữ liệu cho AI

Ngày lập: 23/11/2026. Repo hiện tại: `F:\EzSubtitle`.

Tài liệu bàn giao cho agent triển khai trong chat mới, gồm Codex hoặc Gemini. Đây là kế hoạch, không phải báo cáo đã sửa xong. Đọc lại code và trạng thái Git khi bắt đầu; không giả định workspace vẫn giống ngày lập tài liệu.

## 1. Mục tiêu và phạm vi

Người dùng cần copy toàn bộ transcript của một video để:

- Tạo mục lục/chapter có timestamp YouTube.
- Hỏi AI về kiến thức, lời khuyên, ví dụ và bài tập giáo viên thực sự đã dạy.
- Tra ngược câu trả lời về video, đặc biệt với lớp tiếng Việt có xen tiếng Nhật.

Thứ tự ưu tiên: đúng video/ngôn ngữ/nguồn, giữ đủ nội dung nguồn cung cấp, giữ thời gian, rồi mới tăng độ dễ đọc. Văn bản trôi chảy không chứng minh chính xác; nhiều chữ hơn không chứng minh đầy đủ hơn. Không dùng Glasp hay bảng transcript YouTube làm đáp án chuẩn tuyệt đối.

Phạm vi bản cải thiện đầu tiên: chẩn đoán nguồn, retrieval, provenance/cache, parser, xuất transcript và prompt. Tận dụng UI hiện có; không redesign toàn extension. Không thêm dịch vụ AI, API key, tải audio/video hoặc OCR vào đợt đầu.

## 2. Bằng chứng đã có và điều chưa biết

Video mẫu là một buổi học tiếng Nhật giảng bằng tiếng Việt. Link và tên video nằm trong tài liệu bàn giao cục bộ, không nằm trong repo public. Video không công khai; dùng trong kiểm thử cục bộ, không đưa toàn bài vào fixture công khai.

Quan sát đã có từ phiên điều tra trước:

- Khoảng 1:31-1:34, CC trên video có `Em có nghe rõ ạ`; bản Glasp được cung cấp cũng có câu này.
- Bảng native `Hiện bản chép lời` có `Không có nghe rõ. Ờ, ok.`; bản EzSubtitle cũng có câu này.
- Đã quan sát bảng native khi EzSubtitle bị tắt trên Chrome. Không tiếp tục tranh luận rằng người dùng nhầm panel extension với bảng native.
- Người dùng nghe và xác nhận CC phù hợp hơn ở câu này. Agent chưa nghe đối chiếu toàn bộ video.
- So sánh DOM trước đây ghi nhận 1.318 segment native khớp Ez sau chuẩn hóa khoảng trắng. Đây là số segment của lần kiểm tra đó, không phải số đoạn trong file export.
- Hai file được cung cấp có 296 đoạn timestamp Glasp và 823 đoạn timestamp Ez. Chúng được nhóm khác nhau; không so sánh theo cùng chỉ số dòng.
- Glasp dễ đọc hơn và có dấu đổi lượt `>>`; Ez có nhiều biến thể thuật ngữ và mảnh chữ khó hiểu. Tuy nhiên Glasp có chỗ bỏ mất cách đọc tiếng Nhật; Ez có chỗ giữ thêm tên/phiên âm. Cả hai đều có khuyết điểm.

Các đầu mối chưa phải kết luận nguyên nhân:

- Watch HTML tải bằng HTTP có track `a.vi`, `kind=asr`, URL chứa `variant=gemini`. Chưa chứng minh tham số này gây khác biệt. Tên tham số cũng không phải bằng chứng về chất lượng hay năng lực của model Gemini dùng để lập trình.
- Đọc code Glasp cài sẵn cho thấy một nhánh lấy `pot` từ request timedtext của player rồi dùng với `c=WEB`; có cả endpoint, XML và cache fallback. Chưa xác định nhánh nào đã tạo bản Glasp người dùng cung cấp.
- Direct HTTP timedtext thử ở ngoài browser trả HTTP 200 nhưng body rỗng. Thiếu token/context là giả thuyết, chưa được chứng minh.
- Direct POST get_transcript với context tối giản trả 400 `Precondition check failed`; không suy ra endpoint không dùng được trong phiên browser thật.
- Phiên kiểm tra DevTools trước bị công cụ computer-use buộc dừng vì không xác minh được URL được phép truy cập. Không có request/response player thành công để làm bằng chứng sửa lỗi tại thời điểm lập kế hoạch.

Tài liệu đầu vào cục bộ, chỉ đọc:

- Bản Glasp, bản Ez, ảnh chụp và link video được liệt kê trong `F:\EzSubtitle-evaluation\PRIVATE_CONTEXT.md`, nằm ngoài các worktree và không được commit/upload.
- File chẩn đoán tạm có thể chứa URL có chữ ký đã hết hạn; không dùng làm cấu hình hay commit chúng.
- Nếu chuyển sang máy khác, tài liệu cục bộ có thể không tồn tại. Tái hiện bằng video được phép truy cập; ghi rõ thiếu bằng chứng nếu không thể, không tự tạo kết quả kiểm thử.

## 3. Bản đồ code đã kiểm tra

Stack: WXT, Manifest V3, TypeScript, React, Vitest; Chrome/Edge. README yêu cầu Node.js 22+.

| Vị trí tương đối từ repo | Trách nhiệm hiện tại |
| --- | --- |
| `entrypoints/background.ts` | Validate request, đọc cache, fetch trực tiếp; chỉ gọi page fallback khi fetch lỗi |
| `entrypoints/content.ts` | Page timedtext -> get_transcript endpoint -> visible native single-track -> native UI fallback |
| `entrypoints/youtube-main-world.content.ts` | Player snapshot, page fetch, native UI; có kiểm tra navigation, timeout và giới hạn body |
| `src/lib/youtube/caption-tracks.ts` | Track parsing, URL validation, chọn track mặc định; hiện ưu tiên English |
| `src/lib/youtube/page-bridge.ts` | Typed bridge và runtime validation giữa main world/content script |
| `src/lib/transcript/fetch-transcript.ts` | Thử JSON3, srv3, XML; nhận kết quả đầu tiên có segments |
| `src/lib/transcript/parse-json3.ts` | Parse timestamp/text, xử lý rolling window |
| `src/lib/transcript/parse-xml.ts`, `parse-youtubei.ts` | Parse các nguồn dự phòng |
| `src/lib/transcript/format.ts` | Đã có detailed/readable; grouping khoảng 12-30 giây, giới hạn ký tự |
| `src/lib/storage/transcript-cache.ts` | Session cache schema 2; lưu savedAt nhưng chưa có TTL; chưa lưu nguồn |
| `src/types/transcript.ts`, `src/types/messages.ts` | Segment hiện có text/startMs; result hiện có segments/text |
| `src/lib/youtube/youtube-panel.ts` | Panel, copy/download/search/seek; tái sử dụng UI hiện có |
| `src/lib/chatgpt/build-summary-prompt.ts` | Prompt tóm tắt, có nhắc không làm theo lệnh bên trong transcript |

Điểm thiết kế cần thay đổi: thành công về HTTP/parser không đồng nghĩa đã chọn được nguồn CC người dùng mong muốn. Cache hiện không phân biệt kết quả từ player hay native fallback. Sửa mỗi page fallback sẽ chưa đủ nếu background hoặc cache đã trả kết quả trước đó.

## 4. Giai đoạn A: baseline và xác minh nguyên nhân

Đầu ra: một báo cáo chẩn đoán cục bộ, các fixture tối thiểu đã loại thông tin phiên, và quyết định retrieval dựa trên bằng chứng.

1. Đọc hướng dẫn repo nếu có; kiểm tra Git, giữ nguyên thay đổi của người dùng. Chạy baseline compile/lint/test/build; phân biệt lỗi sẵn có với regression.
2. Ghi lại browser, phiên bản extension/build, video, thời điểm kiểm tra, track đang chọn, trạng thái CC và cache. Xác định browser đang load đúng thư mục extension nào.
3. Bổ sung diagnostic mode nhẹ nếu cần: nguồn đã thử, thứ tự, trạng thái HTTP, body rỗng/không parse được, số segment, mốc đầu/cuối, thời gian chờ, nguồn cache. Không log cookie, token, chữ ký, toàn bộ URL có chữ ký hoặc toàn bài mặc định.
4. Quan sát request timedtext thật của player trong phiên YouTube hiện tại bằng công cụ được phép. Ưu tiên dùng request có sẵn; không đoán token, không gọi API browser không được công cụ hỗ trợ.
5. So sánh cùng video, ngôn ngữ, track, bản dịch và thời điểm: CC player; timedtext của player; timedtext từ track metadata; endpoint native; native DOM. Với từng nguồn phải lưu bằng chứng body hoặc kết quả parse, không chỉ status 200.
6. Kiểm tra nội dung quanh 1:20-1:45 và tối thiểu 5 cửa sổ khác ở đầu/giữa/cuối. Có thể dùng các vùng đã xem: 6:00, 27:00, 40:00, 1:05:00, 1:30:00, 2:00:00, 2:36:00. Không ép câu ở đúng một millisecond vì nguồn chia segment khác nhau.
7. Chỉ thử thay đổi `variant` hoặc token/context khi có request thành công làm đối chứng. Mỗi thử nghiệm thay một yếu tố, dùng context còn hiệu lực. Không sửa query được ký bừa bãi hoặc mặc định bỏ `variant=gemini` trong production.
8. Ghi nhận việc response là toàn bài hay chỉ một phần/continuation. Không coi đoạn cuối gần cuối video hoặc nhiều segment là bằng chứng đủ toàn bộ lời nói.

Điều kiện chuyển sang sửa retrieval: có ít nhất một đường lấy thành công nguồn mong muốn và biết nó khác đường cũ ở đâu, hoặc xác định rõ giới hạn và chỉ triển khai phần cải thiện độc lập đã được chứng minh. Nếu không truy cập browser được, tiếp tục phần provenance/export/test nhưng đánh dấu retrieval/live verification còn mở; không gọi đó là đã sửa nguyên nhân.

## 5. Giai đoạn B: chọn nguồn và lấy phụ đề đáng tin cậy

Chính sách dự kiến, cần điều chỉnh theo kết quả A:

- Tôn trọng track/ngôn ngữ người dùng chọn. Khi chưa chọn, ưu tiên track đang dùng trên player nếu xác định được và tương thích; tránh tự ưu tiên English khi người dùng đang xem CC tiếng Việt. Không tự đổi lựa chọn đã lưu của người dùng.
- Với chế độ bám CC, ưu tiên nguồn player đã quan sát và xác thực đúng identity. Nếu không lấy được, thử track timedtext và các fallback hiện có; lưu rõ nguồn cuối cùng và lý do fallback.
- Không coi bản dịch tự động là track gốc; không lấy token/URL từ video hoặc ngôn ngữ khác. Nếu người dùng chọn track khác track đang phát, không gắn dữ liệu player hiện tại vào track đó.
- Không âm thầm ghép câu từ nhiều nguồn thành một bản mới. Nếu phát hiện khác biệt và giữ nhiều bản, thể hiện như các lựa chọn có nguồn riêng.

Phương án kỹ thuật nên thử theo thứ tự:

1. Main-world quan sát resource timing có sẵn và các request mới bằng observer có vòng đời giới hạn. Chỉ giữ ứng viên timedtext hợp lệ, gắn navigation generation/video/track identity. Resource timing cho URL, không cho response body; muốn body phải có fetch hợp lệ hoặc cơ chế quan sát response riêng đã kiểm thử.
2. Ưu tiên URL player đã phát sinh thay vì tự ráp token vào URL khác. Nếu buộc phải dùng token theo cách khác, phải chứng minh ràng buộc token/track/context qua thí nghiệm A. Chỉ giữ dữ liệu phiên trong bộ nhớ cần thiết.
3. Nếu cần hook fetch/XHR để nhận response, đánh giá riêng độ phức tạp và thời điểm cài hook; không monkey-patch toàn trang mặc định khi observer và page fetch đã đủ. Không dùng debugger/webRequest permission mới nếu chưa chứng minh cần thiết.
4. CC đang tắt hoặc chưa có request: thử đường ít tác động trước. Nếu cần người dùng bật CC một lần, cung cấp thao tác rõ ràng. Không tự tua, phát video hoặc đổi ngôn ngữ. Bất kỳ tác động tạm thời nào lên CC phải khôi phục trạng thái và không ghi đè thao tác mới của người dùng.
5. Đặt ngân sách timeout tổng, giới hạn retry/body/segment, hủy cả request và đọc body khi navigation hoặc timeout. Kiểm tra giới hạn theo byte nếu đặt tên là byte; không chỉ kiểm tra header Content-Length.
6. Dedupe request đồng thời từ panel/popup theo tab/video/track/generation. Không dùng dữ liệu phiên của tab A cho tab B chỉ vì cùng video.
7. Với XML, kiểm tra môi trường thực thi: MV3 service worker không có DOMParser. Parse ở context hỗ trợ hoặc dùng parser tương thích; test thực sự không có DOMParser để tránh jsdom che lỗi.

Không thêm heuristics tự chấm “đúng 95%”. Chỉ báo các sự kiện có bằng chứng: nguồn dự phòng, body thiếu, parse lỗi, track không khớp, có khác biệt giữa hai nguồn đã lấy. Ký tự lạ hoặc khoảng trống thời gian chỉ là dấu hiệu cần xem lại, không đủ kết luận lời nói sai hoặc bị thiếu.

## 6. Giai đoạn C: provenance, cache và trạng thái kết quả

Đề xuất mô hình tối thiểu; agent được chỉnh tên/type theo kiến trúc hiện có:

- `TranscriptResult`: segments, text và metadata.
- Metadata: sourceKind (player-timedtext/track-timedtext/youtubei/native-dom), videoId, track identity, languageCode, translation identity nếu có, fetchedAt, retrievalVersion, fallbackReason nếu có.
- Variant có thể là metadata quan sát được; không dùng tên variant để xếp chất lượng. Format JSON3/XML là encoding, không phải nguồn nội dung.
- Trạng thái completeness dùng unknown/partial khi có cơ sở; chỉ gắn complete nếu đã xử lý đúng toàn response/continuations và đủ bằng chứng. Không suy ra “đầy đủ lời nói” từ complete transport.
- Bổ sung endMs/duration hoặc source segment mapping chỉ khi dữ liệu nguồn cung cấp hoặc cần cho tính năng cụ thể. Không nội suy duration rồi trình bày như thời gian gốc.

Cache:

1. Bump schema khi thay đổi retrieval; không cho schema cũ trả ngay kết quả không biết nguồn.
2. Phân biệt selection policy, nguồn, track, bản dịch và retrieval version. Cache key không phụ thuộc hoàn toàn vào query/token có chữ ký, nhưng phải giữ những yếu tố phân biệt nội dung. Chỉ tái sử dụng cache sau khi xác thực context hiện tại.
3. Cache fallback không được chặn việc thử player khi player đã khả dụng. Có thao tác tải lại bỏ qua cache.
4. TTL cấu hình và có test. Điểm khởi đầu để thử: nguồn chính 30 phút, fallback 2 phút; đây là lựa chọn sản phẩm, không phải số liệu về độ chính xác. Điều chỉnh dựa trên tần suất cập nhật phụ đề và chi phí request.
5. Không lưu raw token/signed URL trong metadata/log mới. Đánh giá bỏ baseUrl đầy đủ khỏi cache; lưu identity đã chuẩn hóa. Không thay đổi toàn bộ hệ thống storage ngoài phạm vi cần thiết.

UI tối thiểu: nguồn đang dùng, ngôn ngữ, trạng thái tải, nút tải lại; chỉ thông báo nguồn dự phòng khi nó giúp người dùng hiểu kết quả. Giữ chi tiết network trong diagnostics, không đưa thuật ngữ token/endpoint vào luồng copy thông thường.

## 7. Giai đoạn D: xuất toàn bài để làm timestamp và hỏi AI

Giữ hai chế độ detailed/readable đã tồn tại; không tạo bản sao tính năng.

- Detailed: text từ nguồn và timestamp segment; giữ speaker marker và Unicode nếu nguồn có. “Bản gốc” ở đây là bản đã parse từ nguồn, không phải transcript do người nghe xác nhận.
- Readable: nhóm segment theo câu, khoảng cách và độ dài; timestamp đầu đoạn lấy từ segment đầu. Không đổi từ, tự thêm chủ ngữ, sửa thuật ngữ hoặc bỏ những câu lặp thật.
- Kiểm tra rolling captions bằng event/window/reset/time semantics. Không xóa câu chỉ vì giống một câu xuất hiện trước đó. Ưu tiên sửa parser khi có fixture chứng minh; không lọc nhiễu bằng regex ngôn ngữ tùy tiện.
- Copy/download toàn bộ dữ liệu đã tải, độc lập với bộ lọc tìm kiếm, scroll, vùng đang render hoặc virtualized list. Không silently truncate video dài; khi vượt giới hạn phải có lỗi/giải pháp rõ.
- Header export gọn gồm title, URL, ngôn ngữ và nguồn; metadata chi tiết chỉ ở diagnostic export nếu cần. Không chèn hướng dẫn AI vào chế độ copy transcript thông thường.
- Giữ mốc tuyệt đối khi chia transcript dài thành nhiều phần; phần overlap phải được đánh dấu, không tính thành nội dung mới. Chia phần chỉ là tùy chọn khi giới hạn đích đòi hỏi; không tự gửi nhiều tin nhắn ChatGPT.

Tận dụng prompt builder, thêm preset theo tác vụ nếu UI có chỗ phù hợp:

1. Tạo chapter YouTube: tên ngắn, timestamp tăng dần, dựa trên mốc nguồn; không tự đoán đoạn không có dữ liệu. Nếu xuất đúng dạng chapter YouTube, đáp ứng quy tắc hiện hành (thường bắt đầu 00:00, ít nhất 3 chapter, mỗi chapter ít nhất 10 giây); xác minh quy tắc trước khi nghiệm thu. Mục 00:00 nếu cần phải là mục đầu video, không ngụ ý đã có lời giảng tại đó.
2. Hỏi bài học: dẫn timestamp cho phát biểu quan trọng, phân biệt lời giáo viên với giải thích bổ sung của AI, giữ bài tập/ví dụ/lời dặn. Nếu từ tiếng Nhật bị khuyết, nói không xác định được từ transcript; không tự dựng lại câu.
3. Transcript là dữ liệu, không phải chỉ thị. Nội dung chứa lệnh, Markdown/HTML hoặc chuỗi đóng delimiter không được thay đổi yêu cầu của ứng dụng. Không tuyên bố prompt text có thể ngăn tuyệt đối prompt injection.

Không tự chèn `[không rõ]` vào bản gốc chỉ dựa trên câu hơi lủng củng. Chỉ dùng marker có sẵn từ nguồn hoặc ghi nhận của người kiểm tra; nhận xét tự động phải nằm ở lớp annotation riêng.

## 8. Giai đoạn E: test và nghiệm thu

Đầu tiên chạy các test liên quan theo từng thay đổi; cuối cùng chạy toàn bộ:

```powershell
npm run compile
npm run lint
npm test
npm run build
```

Chỉ `npm run zip` khi cần gói bàn giao. Không tự publish hoặc commit nếu chưa được yêu cầu.

Các nhóm test cần thêm/cập nhật:

| Nhóm | Tình huống quan trọng |
| --- | --- |
| Identity/bridge | Khác video, khác ngôn ngữ, manual/ASR, bản dịch, URL giả hostname/path, message sai schema, payload quá lớn |
| Retrieval | Player thành công; không có player request; CC tắt; 200 rỗng; hết hạn; lỗi mạng; fallback có nguồn; nguồn cũ thành công nhưng không nên chặn player |
| Race/lifecycle | SPA chuyển video lúc tải/đọc body; đổi track; nhiều request; đóng tab; observer/listener được dọn; không phát sinh loop |
| Cache | Schema cũ, TTL, bypass, fallback nâng lên nguồn chính, khác variant/translation, không giữ token |
| Parser | JSON3 rolling/reset/window reuse, câu lặp thật, srv3/XML, dấu đổi lượt, tiếng Việt/Nhật, timestamp 0/trùng/thứ tự bất thường, môi trường không DOMParser |
| Export | Detailed/readable bảo toàn token nội dung theo chính sách normalize; timestamp không bị đặt lại; copy đủ khi search/scroll; transcript dài; header không làm mất segment |
| Prompt/ChatGPT | Dẫn timestamp, không tự bổ sung lời giáo viên, nội dung có lệnh/delimiter, draft chỉ điền và không tự Send, fallback copy khi autofill không đủ |

Fixture phải tối thiểu, loại dữ liệu phiên. Có test fixture tổng hợp cho race/identity/parser và fixture thực đã làm sạch cho lỗi đã quan sát. Không hardcode videoId/câu `Em có nghe rõ` vào production để vượt test.

Kiểm thử browser thực trên build mới ở cả Chrome và Edge, đề xuất 8-12 video bao phủ:

- Video mẫu tiếng Việt xen tiếng Nhật, dài hơn 2 giờ.
- Tiếng Việt thuần, tiếng Anh, tiếng Nhật.
- Track do người đăng cung cấp, ASR, nhiều track/bản dịch nếu có.
- Video không có phụ đề, SPA chuyển video và trạng thái CC bật/tắt.

Nếu không đủ video/quyền truy cập, báo số thực kiểm tra; không suy rộng từ mock. Không đổi tài khoản hoặc cài extension lạ để đạt ma trận.

Các điều kiện bắt buộc để gọi bản đầu đã hoàn thành:

1. Đường retrieval mới có bằng chứng trên video thật và nguồn được ghi đúng. Với video mẫu còn truy cập được, bản lấy theo player khớp CC ở 1:31 và các cửa sổ đối chứng; nếu YouTube đổi dữ liệu, lưu quan sát mới và giải thích chênh lệch.
2. Không trả nhầm video/track/bản dịch, không đổi nghĩa bằng formatter, không mất lời ở copy toàn bài do UI lọc/virtualization.
3. Chi tiết/dễ đọc đều giữ timestamp truy ngược được; copy/download cho cùng một mode tương đương nội dung.
4. Fallback/cache được phân biệt và tải lại thật sự bỏ qua cache. Không quảng cáo nguồn fallback là CC đã xác minh.
5. Không thay đổi trạng thái phát, ngôn ngữ hoặc CC ngoài hành vi đã thống nhất. Chạy qua SPA và không để request cũ ghi đè kết quả mới.
6. Compile/lint/test/build đạt; báo riêng giới hạn live testing nếu có. Unit test xanh chưa đủ chứng minh đã sửa khác biệt nguồn.

Đánh giá chất lượng nội dung riêng với thành công retrieval: chọn trước các cửa sổ đầu/giữa/cuối, nghe kiểm tra nếu có công cụ, ẩn nhãn nguồn khi chấm nếu làm được. Ghi lỗi đổi nghĩa, mất thuật ngữ/ví dụ, thêm lời, sai timestamp và độ dễ đọc. Không dùng Glasp làm ground truth; không chấm cả video từ một câu. Có thể dùng WER/CER khi đã có bản chuẩn do người nghe lập, không dùng chúng thay đánh giá ý nghĩa bài học.

## 9. Giai đoạn F: AI hiệu đính và audio/slide, chỉ sau bản đầu

Đây là các nhánh mở rộng, không phải điều kiện để hoàn thành A-E.

- AI hiệu đính: chế độ riêng, bật chủ động, giữ bản nguồn và bản sửa, mapping tới segment gốc, diff cho thay đổi nghĩa/thuật ngữ. Không tự thay bản copy mặc định bằng văn bản AI. Chọn provider/model bằng benchmark mẫu, không theo tên hãng.
- Nhận dạng âm thanh: đánh giá chi phí, độ trễ, ngôn ngữ trộn và word alignment trước khi xây pipeline. STT có thể sai hơn CC; không mặc định là nguồn tốt nhất. Chọn xử lý vùng thiếu hoặc toàn bài theo nhu cầu và quyền truy cập.
- Slide/OCR: dùng để hỗ trợ nhận diện từ/công thức có trên màn hình, đánh dấu nguồn slide riêng. Không gán nội dung trên slide thành lời giáo viên đã nói.
- Trước khi dùng API ngoài, thống nhất provider, chi phí, dữ liệu sẽ gửi và cơ chế khóa/API. Không thêm truyền dữ liệu nền vào extension hiện đang chỉ tạo draft ChatGPT theo thao tác người dùng.

## 10. Thứ tự bàn giao và hướng dẫn cho agent

Các mốc review gợi ý (không phải yêu cầu dừng xin phép sau từng mốc):

1. Diagnostic + báo cáo nguyên nhân/giới hạn từ A.
2. Retrieval + identity + provenance/cache từ B-C, kèm test tương ứng.
3. Export/prompt từ D, tận dụng UI có sẵn.
4. Kết quả live validation, kiểm tra cuối, hướng dẫn reload đúng `.output/chrome-mv3` và rollback bản build nếu cần.

Mỗi mốc cần giải thích đã thay gì, bằng chứng nào hỗ trợ, test nào chạy, còn điều gì chưa xác minh. Tiếp tục phần việc độc lập khi browser bị chặn; không liên tục thử lại công cụ đã yêu cầu dừng và không báo hoàn thành live verification thay cho kiểm thử thực.

Không bắt đầu bằng refactor lớn, AI sửa văn bản, đổi toàn bộ UI hay xóa `variant=gemini`. Không sao chép bundle Glasp hoặc phụ thuộc vào dịch vụ/cache của Glasp. Không sửa thủ công câu sai trong code/fixture rồi gọi đó là sửa nguồn.

Tại thời điểm lập tài liệu này, working tree sạch trước khi thêm tài liệu; chưa sửa source code cho kế hoạch. Chỉ đã đọc lại luồng code, chưa chạy lại test trong lượt lập kế hoạch. Agent triển khai phải tự chạy baseline và kiểm tra môi trường hiện tại.

### Prompt triển khai toàn bộ, chỉ dùng sau khi chọn giải pháp vòng đầu

Để so sánh hai agent, dùng phạm vi hẹp trong `docs/TRANSCRIPT_SOURCE_ROUND1.md` trước. Prompt bên dưới dành cho giai đoạn triển khai tiếp sau đó.

> Hãy triển khai cải thiện EzSubtitle trong repo F:\EzSubtitle theo docs/TRANSCRIPT_IMPROVEMENT_PLAN.md. Đọc toàn bộ kế hoạch và hướng dẫn repo trước khi sửa. Mục tiêu chính là copy toàn bộ transcript có timestamp đáng tin cậy để tạo chapter YouTube và hỏi AI về bài học. Triển khai giai đoạn A-E; F chỉ là roadmap, chưa thêm API AI/audio/OCR. Bắt đầu bằng baseline và xác minh khác biệt nguồn CC/native trên video mẫu, không mặc định variant=gemini là nguyên nhân. Giữ thay đổi sẵn có của tôi, tận dụng UI và parser hiện có. Thực hiện test phù hợp và kiểm thử Chrome/Edge khi công cụ cho phép. Nếu bị chặn truy cập browser, làm phần độc lập còn lại và báo rõ giới hạn, không tự nhận đã xác minh nguồn. Không publish, không tự gửi transcript ra dịch vụ khác. Kết thúc bằng danh sách thay đổi, bằng chứng nguồn, kết quả test và cách reload bản build để tôi thử.
