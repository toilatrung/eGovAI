# Kế hoạch v0.3: hoàn thiện trải nghiệm soạn thảo, trình duyệt và lõi agy

Ngày lập: 26/11/2026. Mốc hiện trạng: v0.2.0, 128/128 kiểm thử đạt, lõi `agy` 1.5.17 trên máy (bản mới nhất là 1.5.18, phát hành 26/11/2026).

## 1. Kết quả tự dùng thử

| # | Thử nghiệm | Kết quả |
|---|---|---|
| T1 | Gửi cho `agy` đúng lời dặn ứng dụng đang gửi, yêu cầu "Soạn công văn UBND phường gửi tổ dân phố về tổng vệ sinh cuối năm 2026" (stream-json) | Mất 21 giây và trả về văn bản đầy đủ, nhưng có `<br>` trong 3 ô bảng, 2 dòng `&nbsp;`, `&nbsp;&nbsp;` trong số ký hiệu, khoảng 10 chỗ trống `[Tên phường]`, `[...]/11/2026`, `[Họ và tên]`. Lời dẫn đầu ("Dưới đây là toàn văn…") và mục "Một số lưu ý nhỏ…" ở cuối nằm chung một khối với văn bản. |
| T2 | Chạy `agy acp` (giao thức ACP), hỏi giá vàng SJC | Hoạt động. Chữ trả về theo từng đoạn nhỏ (`agent_message_chunk`), có sự kiện `tool_call`/`tool_call_update` kèm `kind: "search"` và `title`, có `session_info_update` (tự đặt tiêu đề hội thoại), `usage_update` (mức dùng ngữ cảnh) và danh sách lệnh `/goal`, `/compact`, `/schedule`… |
| T3 | Xem cách tra cứu web chạy trong T2 | Mô hình dùng công cụ nội bộ `search_web` của lõi, không dùng `web_open` của eGovAI. Vì vậy tab Trình duyệt không hiện gì, và kết quả không kèm đường dẫn nguồn. |

## 1b. Test trực tiếp trên ứng dụng theo vai cán bộ (26/11/2026)

Cách test:
- Chạy bản dev từ mã v0.2.0, với dữ liệu thật của máy: tài khoản đã đăng nhập, hồ sơ đơn vị **đang bật nhưng để trống**.
- Dự án thử riêng: `Downloads\eGovAI-test-canbo`.
- Gõ và bấm như người dùng (điều khiển qua CDP), chụp màn hình từng bước.
- Mở tệp Word xuất ra bằng Microsoft Word.

| KB | Kịch bản cán bộ | Thời gian | Kết quả |
|---|---|---|---|
| 0 | Cài bản 0.2.0 từ `dist\eGovAI-Setup-0.2.0.exe` | | **Không chạy được.** Windows báo "An Application Control policy has blocked this file" (Smart App Control chặn bộ cài chưa ký). Máy vẫn ở bản 0.1.0. |
| 1 | "Soạn công văn UBND xã Thiệu Toán gửi các thôn về tổng vệ sinh đón Tết 2027, ra quân sáng CN 10/01/2027" | ~20 giây | Có văn bản đầy đủ. Lỗi: toàn văn hiện **2 lần** (chat và Tài liệu); `<br>` hiện nguyên ở cả hai nơi; Quốc hiệu xếp dọc; "ngày … tháng … năm 202…"; tab Tài liệu đặt tên bản nháp là **"Các thông tin còn thiếu c…"** (lấy nhầm tiêu đề mục cuối). |
| 2 | Xuất Word, mở bằng Word | | Tệp .docx chứa: lời dẫn "Dưới đây là dự thảo…", dòng `---` / `-------`, `<br>`, `**Nơi nhận:**` và `**CHỦ TỊCH**` hiện nguyên dấu sao, bảng Nơi nhận có kẻ viền, và cả mục "Các thông tin còn thiếu…". Không dùng được nếu không sửa tay. |
| 2b | "Chủ tịch là ông Lê Văn Nam, số 125/UBND-VP, ngày 02/01/2027, bổ sung mục kinh phí" | ~29 giây | Sửa đúng, bản nháp được thay bằng bản mới. Lỗi: **không còn bản cũ để so sánh**; chat **không tự cuộn** tới câu trả lời mới (nút "Xuống nội dung mới nhất" che mất dòng "Văn bản được viện dẫn"); vẫn còn `<br>`. |
| 3 | "Tra cứu mức lương cơ sở hiện hành, ghi rõ nguồn" | ~59 giây | AI tìm 3 lần bằng `search_web`. **Tab Trình duyệt trống trơn suốt quá trình.** Nguồn chỉ ghi tên miền (chinhphu.vn…), không có đường dẫn để kiểm chứng. Câu trả lời tra cứu bị **nhận nhầm là văn bản** nên chiếm tab Tài liệu. |
| 3b | "Mở Cổng DVC quốc gia, tìm thủ tục đăng ký khai sinh" | ~25 giây trước khi hỏi quyền, ~57 giây tổng | Trước khi hỏi quyền, AI mất 5 bước **"Đọc tệp C:\Users\…\.gemini\antigravity-cli\mcp\egovai-desktop\web_open…"** (đọc định nghĩa công cụ, hiện nguyên đường dẫn kỹ thuật). Sau khi phê duyệt, trình duyệt **có mở trang thật** nhưng bị chặn: "The requested URL was rejected". **Nguyên nhân:** User-Agent `… GoogleAI/0.2.0 … Electron/35.7.5`. Kiểm chứng bằng curl: UA này bị từ chối, còn UA Chrome thường thì trang trả 200. AI vẫn viết "đã tra cứu từ Cổng DVC" dù không vào được trang. Câu trả lời lại chiếm tab Tài liệu và **đẩy trình duyệt đi mất**. |
| 4 | Đính kèm `so-lieu-ho-ngheo-2026.xlsx` bằng `@`, nhờ lập báo cáo giảm nghèo | ~70 giây | **Số liệu và tỷ lệ chính xác 100%** (đã tính lại cả 8 thôn và dòng tổng). Lỗi: tên xã và người ký đã nói ở hội thoại trước **không được nhớ**, nên lại thành `[Tên xã]`, `[Tên huyện]`. Khối tiêu đề bị dồn thành một dòng "ỦY BAN NHÂN DÂN HUYỆN [TÊN HUYỆN] ỦY BAN NHÂN DÂN XÃ [TÊN XÃ]". AI không nhắc rằng chính quyền địa phương đã chuyển sang 2 cấp (không còn cấp huyện). |
| 5 | Câu hỏi nhanh: "Theo NĐ 30, cỡ chữ nội dung là bao nhiêu?" | 14 giây | Đúng (13–14) và không bị nhận nhầm là văn bản. |
| 6 | Soạn tờ trình ở hội thoại A, rồi sang hội thoại B hỏi việc khác | | Hai hội thoại chạy song song được. Lỗi: tờ trình soạn xong ở nền **không mở được trong tab Tài liệu** (tab vẫn hiện "BÁO CÁO" của hội thoại khác, tin nhắn không có nút "Mở trong Tài liệu"); không có thông báo khi việc nền xong. |

Điểm tốt: tốc độ 14–30 giây mỗi văn bản; đọc Excel và tính toán chính xác; có các chip "Văn bản được viện dẫn"; hộp phê duyệt mở trang web rõ ràng, tiếng Việt; trình duyệt tích hợp có hiển thị khi AI dùng `web_open`.

Lỗi mới, ngoài những gì đã biết ở mục 1 (đánh số để theo dõi):

| Mã | Lỗi | Mức |
|---|---|---|
| B1 | Bộ cài 0.2.0 chưa ký bị Smart App Control chặn, người dùng không cài được | **Chặn phát hành** |
| B2 | User-Agent của trình duyệt tích hợp có `Electron`/`GoogleAI` nên bị cổng nhà nước chặn | **Cao, sửa dễ** |
| B3 | Bản nháp Tài liệu dùng chung cho mọi hội thoại: hiện văn bản của hội thoại khác, không mở lại được văn bản cũ hay văn bản soạn ở nền | Cao |
| B4 | Câu trả lời tra cứu dài bị nhận nhầm là văn bản, chiếm tab Tài liệu và đẩy tab Trình duyệt đi | Cao |
| B5 | Tên bản nháp lấy nhầm tiêu đề cuối hoặc mục "1. …" | Trung bình |
| B6 | Chat không tự cuộn theo câu trả lời mới; nút "Xuống nội dung mới nhất" che nội dung | Trung bình |
| B7 | Các bước "Đọc tệp …\mcp\egovai-desktop\web_*" làm chậm khoảng 25 giây và hiện đường dẫn kỹ thuật | Trung bình |
| B8 | AI khẳng định "đã tra cứu" dù trang bị chặn (trả lời theo hiểu biết sẵn có) | Trung bình |
| B9 | Thông tin đã cho (tên xã, người ký, số hiệu) không được nhớ sang hội thoại sau; hồ sơ đơn vị đang bật nhưng để trống mà không ai nhắc | Trung bình |
| B10 | Sửa văn bản không giữ bản cũ | Thấp |
| B11 | Tab "Lịch chạy" ở bảng phải bị nút đóng (X) che một phần | Thấp |

## 1c. Góp ý bổ sung của chủ sản phẩm (26/11/2026)

| Mã | Vấn đề | Hướng xử lý |
|---|---|---|
| U1 | Danh sách mô hình và mức suy luận quá dài, người dùng phân vân không biết chọn gì | Thay hai ô "Mô hình" và "Mức độ" bằng **một ô "Chế độ AI" có 3 lựa chọn**: *Nhanh* (hỏi đáp, sửa câu chữ), *Cân bằng* (mặc định, soạn văn bản), *Chuyên sâu* (văn bản dài, nhiều căn cứ). Mỗi lựa chọn tự gán mô hình và mức suy luận phù hợp, lấy từ danh sách mô hình thật của lõi. Danh sách đầy đủ chuyển vào Cài đặt › Nâng cao. |
| U2 | Cán bộ soạn văn bản thường xuyên; cần giao nhiều văn bản theo quy trình đã lên sẵn | Thêm **tab "Kế hoạch"** ở bảng phải và **chế độ "Theo kế hoạch"** trong ô chat. Người dùng (hoặc AI, từ một yêu cầu tổng) lập danh sách văn bản cần soạn: tên, loại văn bản, yêu cầu riêng, thứ tự. Bấm **Chạy** thì AI soạn lần lượt từng văn bản; văn bản sau được dùng kết quả của văn bản trước (ví dụ Kế hoạch → Công văn triển khai → Báo cáo). Mỗi văn bản xong được lưu thành tệp Word và hiện trạng thái Chờ / Đang soạn / Xong / Lỗi. Có thể tạm dừng, sửa yêu cầu một bước, chạy lại một bước, và lưu thành **mẫu quy trình** để dùng lại. |
| U3 | Người dùng không biết Markdown | Ẩn Markdown khỏi mọi chỗ người dùng nhìn thấy. Bỏ nút tạo "Văn bản .md". Bản nháp luôn hiện dạng trang văn bản, chỉnh sửa trực tiếp trên trang. Mặc định lưu và xuất **Word (.docx)**. Lời dặn cho AI không nhắc "Markdown" khi nói với người dùng. Riêng tệp .md có sẵn trong dự án vẫn mở được. |

## 1d. Trạng thái triển khai (26/11/2026, chưa commit)

| Hạng mục | Trạng thái | Kiểm chứng trên app |
|---|---|---|
| B2 User-Agent trình duyệt | Xong | dichvucong.gov.vn mở bình thường |
| B3 Bản nháp theo hội thoại, nút "Mở trong Tài liệu" | Xong | Đổi hội thoại thì tab Tài liệu đổi theo |
| B4 Nhận diện văn bản chặt hơn, không chiếm tab Trình duyệt | Xong | Câu tra cứu lương cơ sở không còn bị nhận nhầm |
| B5 Tên bản nháp theo loại + trích yếu | Xong | "Công văn – Tổ chức tổng vệ sinh…" |
| B6 Tự cuộn khi vừa gửi | Xong | |
| B7 Ghi sẵn tham số `web_*` trong lời dặn | Xong (chỉ sửa lời dặn) | Chưa đo lại thời gian |
| B8 Nguồn có đường dẫn, nói rõ khi không vào được trang | Xong | Câu trả lời có URL chinhphu.vn |
| G1 Khối `egov-doc`, chat chỉ hiện thẻ văn bản | Xong | Chat còn 2–3 câu và thẻ văn bản |
| G2 Chuẩn hoá `<br>`/`&nbsp;`, bộ xuất Word NĐ 30 mới, tô vàng và điền nhanh chỗ trống, "Lưu Word" vào `Van-ban/`, "Mở bằng Word" | Xong | Mở bằng Word: Quốc hiệu và chữ ký không viền, chỗ trống tô vàng |
| U1 Chế độ AI: Nhanh / Cân bằng / Chuyên sâu | Xong | |
| U2 Chế độ "Theo kế hoạch" và tab Kế hoạch, 3 mẫu quy trình | Xong | 1 yêu cầu sinh 6 văn bản, khoảng 3 phút, đủ 6 tệp Word |
| U3 Bỏ tạo/xuất .md trên giao diện | Xong | |
| G3 Hiện lại `search_web`/`read_url_content` ở tab Trình duyệt, dòng "AI đang tìm…" | Xong | |
| B1 Ký số bộ cài, G3 con trỏ AI và dòng thời gian, G4 ACP, B9 nhớ hồ sơ, B10 lịch sử phiên bản | **Chưa làm** | |
| Nút "Tạm dừng" kế hoạch | Có mã, **chưa thử trên app** | |

## 2. Nguyên nhân từng vấn đề

### 2.1 "Đã soạn trong Tài liệu mà câu trả lời vẫn soạn luôn"
- Lời dặn mô hình ([agyAdapter.ts:36](../src/main/agent/agyAdapter.ts)) yêu cầu "trình bày toàn văn … ngay trong phản hồi".
- Bản nháp trực tiếp ([useAppStore.ts:861](../src/renderer/src/stores/useAppStore.ts)) chỉ sao chép nguyên `msg.content` sang tab Tài liệu. Chat vẫn hiển thị toàn bộ nội dung.
- Không có ranh giới giữa phần "văn bản" và phần "trao đổi", nên lời dẫn và ghi chú cũng lọt vào tài liệu và vào tệp Word xuất ra.

### 2.2 Ký tự lạ `<br>`, `&nbsp;`
- Mô hình dùng HTML để xuống dòng trong ô bảng, như khối Quốc hiệu và Nơi nhận/Chữ ký.
- `ReactMarkdown` không bật HTML nên hiện nguyên `<br>`.
- Bộ xuất Word ([documentService.ts:355](../src/main/services/documentService.ts)) tự tách dòng rất thô sơ:
  - không hiểu `<br>`, `&nbsp;`, chữ đậm hay nghiêng trong ô bảng (giữ nguyên `**`);
  - không hiểu danh sách đánh số, tiêu đề từ `####` trở xuống, hay `---`;
  - khối Quốc hiệu bị kẻ viền như bảng dữ liệu, sai thể thức NĐ 30.

### 2.3 Nhiều chỗ trống
- Hồ sơ đơn vị chỉ được gửi khi người dùng bật, mà phần lớn người dùng chưa điền.
- Không có quy tắc "điền từ hồ sơ, ngày hiện tại, và chỉ hỏi những gì còn thiếu".
- Giao diện không đánh dấu và không hỗ trợ điền các chỗ trống còn lại.

### 2.4 Trình duyệt không hiện quá trình tra cứu
- Các công cụ `web_*` của eGovAI có điều khiển `<webview>` thật, nhưng mô hình hầu như dùng `search_web` / `read_url_content` nội bộ của lõi (chạy ngầm).
- Khi `<webview>` chưa sẵn sàng, ứng dụng chuyển sang Playwright chạy ẩn ([inAppBrowserService.ts:107](../src/main/services/inAppBrowserService.ts)).
- Không có con trỏ hay vùng tô sáng cho biết AI đang bấm hoặc gõ vào đâu.

### 2.5 antigravity-cli
- **Đây chính là lõi `agy.exe` đang dùng**, không phải một lõi khác. Kho GitHub chỉ chứa README, CHANGELOG và bản phát hành; không có mã nguồn hay giấy phép mở. Vì vậy không có gì để "thay thế". Việc cần làm là **nâng phiên bản và dùng giao diện tích hợp tốt hơn**.
- "Con trỏ chuột" trong bản 1.5.18 là con trỏ soạn chữ trong ô nhập của giao diện dòng lệnh, **không phải** AI điều khiển chuột. Muốn AI có con trỏ hiển thị thì eGovAI phải tự làm (mục 3.4).
- "Multi work" trong lõi gồm subagent (mỗi agent một git worktree), `run_workflow` và `/swarm` (bản xem trước, tốn hạn mức). Những tính năng này hợp với lập trình hơn công việc văn phòng. Thứ có ích cho eGovAI là **chạy song song nhiều hội thoại hoặc nhiều việc** và **hiển thị subagent**.
- Giá trị thật nằm ở **ACP** (`agy acp`):
  - chữ stream theo từng đoạn;
  - yêu cầu cấp quyền và câu hỏi chuyển ra giao diện, nên không cần `--dangerously-skip-permissions`;
  - `session/load` và `session/resume` để mở lại hội thoại;
  - `session/cancel`;
  - lái hướng giữa lượt bằng cách gửi thêm prompt;
  - chế độ plan;
  - các lệnh `/goal`, `/compact`, `/schedule`.

## 3. Kế hoạch triển khai

Thứ tự ưu tiên: lỗi người dùng thấy hằng ngày làm trước, thay lõi làm sau.

### Giai đoạn 0: Sửa nhanh, phát hành v0.2.1 (1–2 ngày) [P0]
Đây là những lỗi người dùng thấy ngay mà sửa ít mã.
1. **B1: ký số bộ cài.** Hoàn tất luồng SignPath hoặc chứng thư (đang làm dở trong `.github/`, `.signpath/`, `installer/build-installer.ps1`). Trước khi phát hành, kiểm tra trên một máy bật Smart App Control.
2. **B2: User-Agent.** Đặt UA Chrome chuẩn cho partition `persist:egovai-browser` bằng `session.fromPartition(...).setUserAgent(...)`, bỏ `Electron/…` và `GoogleAI/…`. Rà lại các chỗ còn tên cũ "GoogleAI". Kiểm tra lại với dichvucong.gov.vn, vbpl.vn, thuvienphapluat.vn.
3. **B3: bản nháp theo hội thoại.**
   - Đổi `liveDraft` thành `liveDrafts[conversationId]`.
   - Khi đổi hội thoại thì đổi bản nháp hiển thị theo (hội thoại không có bản nháp thì hiện trang trống).
   - Thêm nút "Mở trong Tài liệu" trên mỗi tin nhắn có văn bản.
4. **B4: nhận diện văn bản chặt hơn.** Chỉ tự mở khi có dấu hiệu thể thức (Quốc hiệu, "Kính gửi", "Nơi nhận", số ký hiệu) hoặc người dùng chọn kỹ năng soạn thảo; không chỉ dựa vào độ dài hay tiêu đề `#`. Nếu người dùng đang ở tab Trình duyệt hoặc AI vừa dùng `web_*` thì **không tự chuyển tab**.
5. **B5: tên bản nháp.** Ưu tiên loại văn bản và trích yếu ("Công văn – V/v tổng vệ sinh…"), bỏ qua các tiêu đề như "Các thông tin còn thiếu", "Lưu ý".
6. **B6: tự cuộn.** Khi người dùng vừa gửi tin, chat tự cuộn theo câu trả lời mới. Nút "Xuống nội dung mới nhất" không được che nội dung (đặt nổi trên khung nhập, nền mờ).
7. **B8: trung thực về nguồn.** Thêm vào lời dặn: "Nếu không truy cập được trang thì nói rõ và ghi 'theo hiểu biết, cần kiểm chứng'; luôn kèm URL đầy đủ của nguồn".

### Giai đoạn 1: Tách văn bản khỏi chat (2 ngày) [P0]
1. **Giao thức khối tài liệu.** Đổi lời dặn: văn bản hoàn chỉnh phải nằm trong khối
   ```` ```egov-doc title="Công văn về việc …" ```` … ```` ``` ````.
   Lời dẫn và lưu ý viết ngoài khối, ngắn gọn, tối đa 2–3 câu.
2. **Bộ tách khi đang stream** (`utils/docStream.ts`), xử lý cả trường hợp khối bị cắt giữa chừng giữa hai đoạn chữ:
   - phần trong khối đi vào `liveDraft`;
   - phần ngoài khối giữ trong chat;
   - tin nhắn chat thay khối bằng **thẻ tài liệu** gồm tên văn bản, số từ, trạng thái "Đang soạn…/Hoàn tất" và các nút *Mở*, *Xuất Word*, *Sao chép*.
3. **Dự phòng** khi mô hình quên khối: nếu `looksLikeDocumentDraft` đúng, chat chỉ hiện 3 dòng đầu rồi thu gọn kèm "Xem toàn văn trong tab Tài liệu".
4. **Lưu bản nháp theo tin nhắn** (`message.documents[]`) để mở lại hội thoại cũ vẫn bấm thẻ ra được tài liệu. Bản nháp hiện tại chỉ giữ một `liveDraft` toàn cục.
5. Sửa văn bản: người dùng sửa trực tiếp trong tab Tài liệu, hoặc yêu cầu "sửa đoạn 2…" để mô hình trả về khối `egov-doc` mới thay bản cũ, có lịch sử phiên bản v1, v2.
6. Kiểm thử: bộ tách với khối bị cắt ngẫu nhiên, khối lồng `` ``` `` bên trong, nhiều tài liệu trong một câu trả lời.

### Giai đoạn 2: Chất lượng văn bản và thể thức (3 ngày) [P0]
1. **Chuẩn hóa nội dung** (`normalizeDraftMarkdown`) trước khi hiển thị và xuất:
   - `<br>` thành ngắt dòng;
   - bỏ `&nbsp;` và giải mã các thực thể HTML khác;
   - bỏ `---` thừa ở đầu và cuối.
   Lời dặn thêm: "Không dùng HTML/`&nbsp;`; xuống dòng trong ô bảng bằng ` \ `".
2. **Viết lại bộ xuất Word bằng cây mdast** (`remark-parse` + `remark-gfm`, đã có sẵn theo react-markdown):
   - chữ đậm và nghiêng ở mọi chỗ, kể cả trong ô bảng;
   - danh sách đánh số và nhiều cấp, tiêu đề từ h1 đến h6;
   - ngắt dòng trong ô bảng.
3. **Mẫu thể thức NĐ 30 thay vì dịch Markdown máy móc.** Mô hình trả thêm phần đầu YAML trong khối `egov-doc` (`loai`, `so_ky_hieu`, `trich_yeu`, `kinh_gui`, `noi_nhan`, `chuc_vu_ky`, `nguoi_ky`). Bộ xuất dựng:
   - khối Quốc hiệu – Tiêu ngữ 2 cột **không viền**, có gạch chân;
   - số ký hiệu và trích yếu "V/v";
   - địa danh, ngày tháng (in nghiêng);
   - Nơi nhận cỡ 12 và chữ ký theo vị trí chuẩn.
   Thân văn bản: Times New Roman 14, giãn dòng 1.15–1.3, thụt đầu dòng 1 cm, căn đều.
   Tab Tài liệu cũng hiển thị theo đúng mẫu này, giống bản sẽ in ra.
4. **Giảm chỗ trống**:
   - luôn gửi hồ sơ đơn vị nếu đã có dữ liệu (không bắt buộc bật công tắc);
   - thêm trường *ký hiệu viết tắt cơ quan*;
   - chèn sẵn ngày hiện tại;
   - quy tắc: "Điền từ hồ sơ; thông tin bắt buộc còn thiếu thì hỏi **một lần** bằng `desktop_ask_user` dạng biểu mẫu trước khi soạn; chỉ để `[…]` cho dữ liệu thật sự chưa biết".
   - Lần đầu soạn văn bản mà hồ sơ trống thì gợi ý mở biểu mẫu hồ sơ đơn vị (30 giây).
5. **B9: nhớ thông tin đơn vị.**
   - Khi người dùng cung cấp tên xã, người ký hay số hiệu trong chat, hỏi một lần "Lưu vào hồ sơ đơn vị?".
   - Nếu hồ sơ đang bật mà trống, hiện nhắc điền ngay trên ô chat.
   - Lời dặn nêu rõ mô hình chính quyền địa phương 2 cấp (không còn cấp huyện) để AI cảnh báo khi người dùng ghi "UBND huyện".
6. **B10: lịch sử phiên bản.** Mỗi lần sửa tạo v1, v2…, có nút so sánh và quay lại.
7. **Tô sáng chỗ trống còn lại** trong tab Tài liệu (nền vàng) và hiện thanh "Còn N chỗ cần điền". Bấm vào thì ra ô nhập để thay tất cả chỗ trùng tên cùng lúc. Khi xuất Word, cảnh báo nếu vẫn còn chỗ trống.
8. Kiểm thử: dùng văn bản thật lấy từ T1 làm mẫu chuẩn. Kiểm tra tệp `.docx` không còn `<br>`, `&nbsp;`, `**`, và khối đầu văn bản không có viền.

### Giai đoạn 2b: Đơn giản hoá cho cán bộ (U1, U3) (1 ngày) [P0]
1. Thêm ô **Chế độ AI** (Nhanh / Cân bằng / Chuyên sâu), ánh xạ sang mô hình và mức suy luận. Danh sách mô hình đầy đủ chuyển vào Cài đặt.
2. Bỏ nút "Văn bản .md" và mọi chữ "Markdown" trên giao diện. Bản nháp sửa trực tiếp trên trang (không phải ô soạn thô).

### Giai đoạn 2c: Chế độ và tab "Kế hoạch" (U2) (3 ngày) [P0]
1. Kiểu dữ liệu `DocPlan` gồm tên, mục tiêu chung và các bước. Mỗi bước có tiêu đề, loại văn bản, yêu cầu, trạng thái, tệp kết quả và mã tin nhắn. Kế hoạch lưu theo dự án.
2. Tab **Kế hoạch**:
   - tạo kế hoạch trống, hoặc nhờ AI lập từ một yêu cầu tổng (AI trả về danh sách bước dạng JSON);
   - thêm, sửa, xoá, sắp xếp lại các bước;
   - nút Chạy tất cả, Chạy bước này, Tạm dừng; thanh tiến độ.
3. Chế độ **Theo kế hoạch** trong ô chat: yêu cầu gửi đi được biến thành kế hoạch nhiều bước chờ người dùng duyệt, thay vì soạn ngay.
4. Bộ chạy: mỗi bước gửi một lượt trong cùng hội thoại của kế hoạch, kèm tóm tắt các bước trước. Văn bản trong khối `egov-doc` được lưu thành `.docx` vào thư mục `Ke-hoach/<tên kế hoạch>/` của dự án.
5. Mẫu quy trình có sẵn, ví dụ "Tổ chức sự kiện" (Kế hoạch → Công văn triển khai → Giấy mời → Báo cáo kết quả) và "Tiếp nhận văn bản chỉ đạo" (Kế hoạch triển khai → Công văn → Báo cáo). Người dùng có thể lưu kế hoạch của mình thành mẫu.

### Giai đoạn 3: Trình duyệt "nhìn thấy AI làm việc" (4 ngày) [P1]
1. **Hiện lại thao tác của công cụ nội bộ.** Khi có sự kiện `search_web` (từ ACP, `kind: search`), tab Trình duyệt tự mở trang tìm kiếm với từ khóa đó. Khi có `read_url_content`, tab mở đúng URL đó. Tab hiện nhãn "AI đang tra cứu…".
2. **Hướng mô hình dùng `web_*` khi cần thao tác thật** (đăng nhập cổng dịch vụ công, điền biểu mẫu). `search_web` giữ cho tra cứu nhanh. Thử cấu hình `permissions.deny` với `read_url_content` để buộc đọc trang qua `web_read_text` rồi đo tốc độ trước khi quyết định.
3. **Con trỏ AI và vùng tô sáng.** Chèn lớp phủ vào `<webview>`:
   - con trỏ có nhãn "eGovAI" trượt tới phần tử trước khi `web_click`;
   - khung tô sáng phần tử và hiệu ứng gợn sóng khi bấm;
   - `web_fill` gõ từng ký tự để người dùng nhìn thấy.
   Có tùy chọn tắt hiệu ứng để chạy nhanh.
4. **Dòng thời gian tra cứu** bên dưới thanh địa chỉ, ví dụ: Đã tìm "…" → Mở tuoitre.vn → Đọc 3.200 ký tự → Bấm "Tra cứu". Bấm vào một bước để quay lại trang đó.
5. **Trích nguồn trong câu trả lời.** Chat hiện các chip nguồn (tên miền và tiêu đề), bấm vào thì mở trong tab Trình duyệt.
6. **Quyền điều khiển.** Có nút "Tạm dừng AI / Tôi tự thao tác" và "Trả quyền cho AI". Khi người dùng bấm hoặc gõ vào webview thì AI tự dừng thao tác.
7. **B7: bớt bước "đọc định nghĩa công cụ".**
   - Ghi sẵn chữ ký các công cụ `web_*` trong lời dặn để mô hình không phải đọc tệp schema.
   - Trên giao diện, gom các bước đọc tệp trong thư mục `.gemini\antigravity-cli\mcp\` thành một dòng "Chuẩn bị công cụ duyệt web", không hiện đường dẫn.
8. **Danh sách trang tin cậy.** Mở và đọc trang `*.gov.vn`, `vbpl.vn`, `thuvienphapluat.vn` không cần hỏi quyền (đã có "Luôn cho phép" nhưng nên là mặc định cho thao tác chỉ đọc). Bấm, gõ, gửi biểu mẫu thì vẫn hỏi.
9. **Bỏ chế độ Playwright chạy ẩn cho hội thoại tương tác.** Luôn mở và chờ `<webview>` (giữ `<webview>` gắn sẵn khi bảng phụ đang đóng). Playwright chỉ dùng cho tác vụ lịch nền.

### Giai đoạn 4: Nâng lõi lên ACP (5–6 ngày) [P1]
1. Đóng gói `agy` **1.5.18**. Kiểm tra định kỳ bản mới trong Cài đặt (đọc `agy changelog`, nâng bằng `agy update` cho bản cài hệ thống, còn bản đóng gói thì cập nhật cùng eGovAI).
2. **`AcpAgyAdapter`** thay `stream-json`, dùng chung giao diện `AgyStreamEvent` để giao diện ít phải sửa:
   - `agent_message_chunk` thành `text_delta`, có phân biệt với `agent_thought_chunk` (suy nghĩ);
   - `tool_call`/`tool_call_update` thành `tool_update` (có sẵn `kind`, `title`, `status`);
   - `session/request_permission` hiện ở `InteractionModal`, nhờ đó **bỏ `--dangerously-skip-permissions`**;
   - `session_info_update` đặt tiêu đề hội thoại;
   - `usage_update` cho đồng hồ đo ngữ cảnh;
   - `session/cancel` cho nút Dừng;
   - gửi thêm prompt giữa lượt để người dùng chỉnh hướng khi AI đang làm.
   Giữ adapter `stream-json` làm dự phòng, chuyển qua lại bằng một cờ trong Cài đặt.
3. **Mở lại hội thoại bằng `session/load`** thay cho `--conversation`, để lịch sử công cụ cũng được tải lại.
4. **Hiển thị kế hoạch và subagent.** Danh sách bước (`update_steps`) hiện dưới dạng checklist trên ô chat. Subagent hiện thành thẻ lồng, ví dụ "Đã khởi chạy 3 tác vụ con" mở ra xem từng tác vụ. Lưu ý: chưa có tài liệu chính thức về các dạng sự kiện này, cần kiểm lại trên bản thật trước khi làm.
5. **Đa nhiệm (multi work) kiểu văn phòng:**
   - chạy song song tối đa N hội thoại, mỗi hội thoại một phiên ACP; hiện chỉ giữ 3 tiến trình, cần nâng lên và có hàng đợi;
   - thanh bên có huy hiệu Đang chạy / Chờ duyệt / Xong và thông báo Windows khi xong;
   - mục "Giao việc nền" để giao việc dài như "tổng hợp 20 công văn", người dùng vẫn chat việc khác trong lúc đó.
   `/swarm` chưa dùng vì còn là bản xem trước và tốn hạn mức.
6. Đưa lệnh `/goal`, `/compact`, `/schedule` lên menu `/` trong ô chat.
7. Kiểm thử: dựng một ACP server giả (NDJSON ghi sẵn) cho vitest, và một lần chạy với `agy` thật trước khi phát hành.

### Giai đoạn 5: Kiểm thử tổng thể và phát hành v0.3.0 (2 ngày)
- Chạy lại đúng 6 kịch bản ở mục 1b làm kiểm thử chấp nhận. Mỗi lỗi B1–B11 phải được xác nhận đã hết trên giao diện và trong tệp Word.
- Bộ kịch bản thử chạy với lõi thật (script `scripts/e2e-agy.mjs`): soạn công văn, tờ trình, báo cáo có bảng; tra cứu web; điền biểu mẫu web; 3 hội thoại chạy song song.
- Thử thủ công trên Windows 10 và Windows 11, theo hai trường hợp hồ sơ đơn vị trống và đầy đủ.
- Ghi chú phát hành `docs/releases/v0.3.0.md`.

## 4. Tiến độ và rủi ro

| Giai đoạn | Thời lượng | Có thể làm song song |
|---|---|---|
| 0. Sửa nhanh (v0.2.1) | 1–2 ngày | Ký số làm song song với phần còn lại |
| 1. Tách văn bản khỏi chat | 2 ngày | |
| 2. Chất lượng và thể thức | 3 ngày | Làm song song với 3 |
| 3. Trình duyệt hiển thị | 4 ngày | Làm song song với 2 |
| 4. ACP và đa nhiệm | 5–6 ngày | Sau giai đoạn 1 (cùng sửa luồng sự kiện) |
| 5. Kiểm thử và phát hành | 2 ngày | |

Tổng: khoảng 3 tuần nếu một người làm, khoảng 2 tuần nếu làm song song.

**Rủi ro:**
- Mô hình không luôn tuân thủ khối `egov-doc`. Giảm thiểu bằng cơ chế dự phòng 1.3 và thêm một ví dụ mẫu trong lời dặn.
- Dạng sự kiện ACP chưa có tài liệu đầy đủ và có thể đổi theo phiên bản. Giảm thiểu bằng cách giữ adapter stream-json, ghi lại phiên bản lõi đã kiểm, và kiểm thử với bản ghi thật.
- Hiện lại `search_web` mở thêm một trang tìm kiếm, tốn băng thông và có thể bị Google hiện CAPTCHA. Có thể chuyển sang trang tìm kiếm khác hoặc chỉ hiện danh sách kết quả.
