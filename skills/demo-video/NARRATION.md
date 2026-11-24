# Narration: spoken Vietnamese for demo and training videos

How professional Vietnamese product videos talk, distilled from the transcripts of 18 vendor
tutorials and demos (KiotViet, Sapo, MISA SME and AMIS, Base, Viettel Solutions, Getfly, FastWork,
1Office, an e-learning voice-over course). Use it when writing `say:` lines; check the result with
`demo-studio lint script.yaml --spoken`.

## Shape of a video

**Opening (under 20 s)**
1. Greeting and who is speaking: "Xin chào anh chị, em là Mi, bộ phận đào tạo của …" or the brand
   as speaker: "MISA xin hướng dẫn anh chị …", "Viettel giới thiệu đến quý khách …".
2. A hook, one of:
   - pain in the customer's words: "Cuối ngày muốn biết lời lỗ thế nào, tồn kho còn bao nhiêu cũng chịu."
   - stakes or a rule: "Theo Nghị định 70, hóa đơn sai phải lập điều chỉnh. Đừng quá lo lắng, …"
   - a question: "Có bao giờ bạn tự hỏi làm sao thu ngân siêu thị tính tiền nhanh vậy?"
3. The goal: "Mục tiêu của video này là giúp anh chị …" / "Sau video này, anh chị sẽ …"
4. The roadmap: "Anh chị làm theo hai bước. Bước một, … Bước hai, …" Reuse these names as chapters.

**Body, one beat per action:** signpost, location, action, result, why.
> "Bước hai, lập biên bản điều chỉnh. Tại phân hệ Hóa đơn điện tử, anh chị chọn Biên bản.
> Phần mềm tự trừ hai túi trong kho, để cuối ngày chị đối soát rành mạch."

**Close:** recap ("Như vậy, …" / "Vậy là … đã xong"), a wish ("Chúc anh chị thực hiện thành công"),
what next ("Hẹn gặp anh chị ở video tiếp theo: …", the hotline or help page).

Training videos: one task per video, 3–7 minutes, every step shown. Sales demos: outcome and pain
first, then three value points named as such ("Thứ nhất là tính linh hoạt. … Thứ hai …"), the
customer's own data and numbers, a clear next step at the end.

## Forms of address: pick one for the whole video

| Audience | Listener | Speaker |
|---|---|---|
| Staff training, accountants, operations (B2B) | anh chị | em (support staff), mình or tôi (trainer, expert) |
| Formal or regulated customers | quý khách | the brand name |
| Shop owners, consumers | bạn, các bạn | mình |
| Role-play scenes | each other: chị Lan / em, bác / cháu | |

Never "người dùng" in speech: that is documentation wording. `lint` flags mixed forms.

## Sentences

- 8–25 syllables, one idea, active voice, subject before verb. Split anything longer.
- **Location before action**, the natural Vietnamese order, and it matches the cursor: the pointer
  travels while the location is spoken and clicks on the verb.
  "Tại màn hình chính, anh chị chọn Quản lý kho."
- Name UI labels exactly as they appear, one or two per sentence. Never read a whole form: "nhập
  các thông tin bắt buộc, như nhà cung cấp và ngày nhập".
- Signposts: Đầu tiên, Tiếp theo, Sau đó, Cuối cùng; Bước một …; Thứ nhất … thứ hai …;
  "Vậy X là gì?" before a concept; "Ví dụ, …"; warnings start with "Lưu ý" or "Anh chị lưu ý giúp em".
- Confirm what happened: "Hệ thống hiển thị …", "ngay lập tức", "Vậy là đơn đã được tạo."
- End a step with its benefit: "… để cuối ngày chị đối soát rành mạch."
- Concrete sample data beats abstractions: "hai túi bột giặt, tổng 230.000đ", not "chọn sản phẩm".
- Particles "nhé", "ạ" close invitations and instructions ("Mời anh chị cùng theo dõi nhé"); at most
  one every three or four sentences. "ạ" goes with an "em" speaker.

## Written style to avoid (lint catches these)

| Written | Spoken |
|---|---|
| Tiến hành lưu | Bấm Lưu |
| Người dùng | anh chị / bạn |
| nhằm | để |
| được thực hiện bởi hệ thống | hệ thống tự … |
| như sau: | gồm ba bước |
| vân vân | two or three concrete examples |
| `;` and `( … )` | two sentences |
| click | bấm, nhấn |

Unscripted demos also fill with "thì", "cái", "ờ", "là mà"; scripted lines never need them.

## Numbers, codes and names

Write them the way they appear on screen. Captions keep the written form, and the voice reads the
spoken form:

| Written | The voice says |
|---|---|
| 230.000đ, 750k, 1,5 triệu đồng | hai trăm ba mươi nghìn đồng, bảy trăm năm mươi nghìn, một phẩy năm triệu đồng |
| 94%, 2,5% | chín mươi tư phần trăm, hai phẩy năm phần trăm |
| 24/11/2026, 14:30, 8h | ngày hai mươi tư tháng mười một năm …, mười bốn giờ ba mươi, tám giờ |
| DH-1021, 29C-123.45 | đê hát, một không hai một / hai chín xê, một hai ba bốn năm |
| 0912 345 678, 1900 6750 | digit by digit, in groups |
| KPI, TMS, PDF, HĐ, SĐT | cây pi ai, tê em ét, pi đi ép, hóa đơn, số điện thoại |
| kiotviet.vn/hotro | kiotviet chấm vê en gạch chéo hotro |

Brand names and in-house codes the voice gets wrong go in the codebase's
`.demo-studio/pronounce.yaml` (`{AcmeTMS: "ác mi tê em ét", LSP: "lờ ét pê"}`) or a script's
`pronounce:`. Listen with `demo-studio say "…"`. `voice: {normalize: false}` turns this off.

## Pace and pauses

The polished vendor tutorials run at 200–230 syllables a minute; course-style lessons at 150–170.
Edge HoaiMy at +0% measures about 193, so use `rate: "+8%"` for product tutorials. VieNeu Mai Anh is
about 229 at its default. After a click whose result the viewer must read, hold a beat
(`hold: 600`). Never talk over a page load: the load is trimmed anyway.

## Role-play format

KiotViet's 2026 series stages each tutorial as a visit. The support person arrives ("Em chào chị
Lan, đúng hẹn hôm nay em qua hướng dẫn chị …"). The owner states the pain in their own words. The
support person demonstrates, the owner reacts ("Nhanh và chuyên nghiệp quá em"), and the scene
closes on a next step. In demo-studio:

```yaml
voice: { provider: vieneu, name: "Mai Anh" }          # presenter
voices:
  chu_shop: { name: "Hải Đăng", label: "Anh Minh" }  # caption shows "Anh Minh: …"
steps:
  - as: chu_shop
    say: "Cuối ngày anh không biết đơn nào đã giao, cứ phải gọi từng tài xế."
  - say: "Dạ, anh nhìn ngay bảng Đơn hàng hôm nay nhé."
    circle: { text: "Đơn hàng hôm nay" }
```

Keep the customer to one or two short lines per scene, and keep the presenter driving the screen.

## Opening and closing lines to adapt

- "Xin chào anh chị. Trong video này, em hướng dẫn anh chị tạo đơn vận chuyển chỉ trong ba bước."
- "Mục tiêu của video là giúp anh chị nắm được … trước khi triển khai."
- "Như vậy, anh chị đã tạo xong đơn và giao cho tài xế. Chúc anh chị thực hiện thành công."
- "Ở video tiếp theo, mình sẽ cùng xem cách theo dõi chuyến xe theo thời gian thực. Hẹn gặp lại anh chị."
